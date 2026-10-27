// Service worker de Agenda de Trabajo.
//
// Hace dos cosas en un solo archivo (para no pelearse por el "scope" con un
// segundo service worker):
//  1) Permite instalar la app como PWA, cacheando SOLO archivos estáticos
//     (iconos, manifest). El HTML, app.js y los datos de Firestore NUNCA se
//     cachean aquí, para que nadie vea información vieja sin darse cuenta.
//  2) Recibe las notificaciones push de Firebase Cloud Messaging cuando la
//     app está cerrada o en segundo plano (igual que un mensaje de WhatsApp).

/* ===================== CONFIGURACIÓN (edita esto) =====================
   Pega aquí EXACTAMENTE el mismo firebaseConfig que ya pegaste en
   index.html (Firebase Console → Configuración del proyecto → Tus apps →
   ícono Web). Este archivo es un archivo aparte que el navegador ejecuta
   por su cuenta (no puede "leer" el de index.html), así que el mismo
   bloque hay que pegarlo también aquí para que las notificaciones push
   funcionen con la app cerrada o en segundo plano. */
const firebaseConfig = {
  apiKey: "AIzaSyDVa8QNEY7wQNwkmit_NrmksQkfm-k6jYs",
  authDomain: "agenda-trabajo-75f2f.firebaseapp.com",
  projectId: "agenda-trabajo-75f2f",
  storageBucket: "agenda-trabajo-75f2f.firebasestorage.app",
  messagingSenderId: "860734172074",
  appId: "1:860734172074:web:e9110f67e3f1089a16d9d3"

};
/* ======================================================================= */

const CACHE = "agenda-estaticos-v1";
const ESTATICOS = ["icono-192.png", "icono-512.png", "icono-180.png", "manifest.webmanifest"];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ESTATICOS)).catch(() => {}));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const esEstatico = ESTATICOS.some((f) => url.pathname.endsWith(f));
  if (!esEstatico) return; // todo lo demás (HTML, app.js, Firestore...) va directo a la red
  e.respondWith(caches.match(e.request).then((cacheada) => cacheada || fetch(e.request)));
});

// ---------- Firebase Cloud Messaging (push en 2do plano) ----------
// Antes esta configuración se leía de la URL con la que app.js registraba
// este archivo (sw.js?config=...). Eso causaba un problema real: como el
// texto del archivo sw.js era siempre el mismo (la URL no cuenta como parte
// del archivo), el navegador podía decidir que "no hay nada nuevo que
// activar" y se quedaba usando una copia vieja de este worker que nunca
// llegó a inicializar Firebase. Por eso ahora el firebaseConfig vive aquí
// mismo, fijo en el archivo, para que el worker SIEMPRE tenga lo que
// necesita apenas el navegador lo instala.
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

if (firebaseConfig.apiKey && firebaseConfig.apiKey !== "PEGAR_AQUI") {
  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();
  // El mensaje llega como "data" pura (ver functions/index.js), no como
  // "notification", justamente para que el navegador NO muestre un aviso
  // automático por su cuenta — así solo aparece el que mostramos aquí.
  messaging.onBackgroundMessage((payload) => {
    const titulo = payload.data?.titulo || "Agenda de Trabajo";
    self.registration.showNotification(titulo, {
      body: payload.data?.cuerpo || "",
      icon: "icono-192.png",
      badge: "icono-192.png",
    });
  });
}

self.addEventListener("notificationclick", (evento) => {
  evento.notification.close();
  evento.waitUntil(
    self.clients.matchAll({ type: "window" }).then((lista) => {
      for (const c of lista) if ("focus" in c) return c.focus();
      if (self.clients.openWindow) return self.clients.openWindow("./");
    })
  );
});
