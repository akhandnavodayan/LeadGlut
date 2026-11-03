importScripts("https://www.gstatic.com/firebasejs/13.1.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/13.1.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyB8aUvgg2TgnQD5K4LYzg-r7-RUH5g0LFY",
  authDomain: "leadglut.firebaseapp.com",
  projectId: "leadglut",
  storageBucket: "leadglut.firebasestorage.app",
  messagingSenderId: "746172814704",
  appId: "1:746172814704:web:776a2d6cd4c4ed043e2bb5",
});

firebase.messaging().onBackgroundMessage((payload) => {
  const notification = payload.notification || {};
  self.registration.showNotification(notification.title || "LeadGlut", {
    body: notification.body || "",
    icon: notification.icon || "/icon-192.png",
    image: notification.image,
    data: { url: payload.data?.url || "/" },
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(clients.openWindow(url));
});
