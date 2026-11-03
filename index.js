/**
 * Cloud Functions de Agenda de Trabajo.
 *
 * Se disparan solas cuando se crea o se reasigna una tarea, y le mandan al
 * responsable una notificación push de verdad (llega aunque tenga el
 * celular bloqueado o la app cerrada) más un registro en "notificaciones"
 * para el campanita dentro de la app.
 */

const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");

initializeApp();
const db = getFirestore();

// Mantiene los costos/recursos acotados; de sobra para el uso de un equipo
// pequeño.
setGlobalOptions({ region: "us-central1", maxInstances: 5 });

async function avisarAsignacion(tareaId, tarea, motivo) {
  const responsableUid = tarea.responsableUid;
  if (!responsableUid) return;
  // No te notificas a ti mismo si te creas una tarea propia.
  if (responsableUid === tarea.creadoPorUid && motivo === "nueva") return;

  const usuarioRef = db.collection("usuarios").doc(responsableUid);
  const usuarioSnap = await usuarioRef.get();
  if (!usuarioSnap.exists) return;
  const usuario = usuarioSnap.data();

  const titulo = motivo === "nueva" ? "Nueva tarea asignada" : "Te reasignaron una tarea";
  const cuerpo = `${tarea.titulo}${tarea.proyecto ? " · " + tarea.proyecto : ""}`;

  // 1) Registro en Firestore para la campanita dentro de la app (esto
  //    funciona siempre, incluso si el push falla o no dio permiso).
  await db.collection("notificaciones").add({
    paraUid: responsableUid,
    tareaId,
    tipo: motivo,
    titulo,
    cuerpo,
    leida: false,
    creadoEn: FieldValue.serverTimestamp(),
  });

  // 2) Push real por FCM, a todos los dispositivos que haya registrado esa
  //    persona (puede tener el celular y la compu, por ejemplo).
  const tokens = Array.isArray(usuario.fcmTokens) ? usuario.fcmTokens : [];
  if (tokens.length === 0) return;

  // Mensaje SOLO de datos (sin bloque "notification"): si mandáramos también
  // un "notification", el navegador mostraría SU PROPIO aviso automático
  // (con el ícono genérico de Firebase) ADEMÁS del que ya mostramos nosotros
  // a mano en sw.js → dos notificaciones iguales por cada tarea, una con
  // nuestro logo y otra con la "F" de Firebase. Mandando solo "data" queda
  // bajo nuestro control total y aparece una sola vez. (FCM exige que todos
  // los valores de "data" sean texto, por eso el String() en tareaId.)
  const respuesta = await getMessaging().sendEachForMulticast({
    tokens,
    data: { titulo, cuerpo, tareaId: String(tareaId) },
  });

  // Limpia tokens vencidos/desinstalados para no acumular basura ni
  // reintentos fallidos a futuro.
  const vencidos = [];
  respuesta.responses.forEach((r, i) => {
    if (!r.success && r.error && r.error.code === "messaging/registration-token-not-registered") {
      vencidos.push(tokens[i]);
    }
  });
  if (vencidos.length > 0) {
    await usuarioRef.update({ fcmTokens: FieldValue.arrayRemove(...vencidos) });
  }
}

exports.alCrearTarea = onDocumentCreated("tareas/{tareaId}", async (evento) => {
  const tarea = evento.data.data();
  await avisarAsignacion(evento.params.tareaId, tarea, "nueva");
});

exports.alReasignarTarea = onDocumentUpdated("tareas/{tareaId}", async (evento) => {
  const antes = evento.data.before.data();
  const despues = evento.data.after.data();
  if (antes.responsableUid !== despues.responsableUid) {
    await avisarAsignacion(evento.params.tareaId, despues, "reasignada");
  }
});
