"use client";

import { getMessaging, getToken, isSupported } from "firebase/messaging";
import { app, auth } from "./firebase";

export async function registerPushNotifications() {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    throw new Error("Push notifications are not supported in this browser.");
  }
  if (!auth.currentUser) throw new Error("Please sign in first.");
  if (!(await isSupported())) throw new Error("Push notifications are not supported here.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notification permission was not granted.");
  const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
  if (!vapidKey) throw new Error("Push notifications are not configured yet.");
  const token = await getToken(getMessaging(app), { vapidKey, serviceWorkerRegistration: registration });
  if (!token) throw new Error("Could not register this device for notifications.");
  const idToken = await auth.currentUser.getIdToken();
  const response = await fetch("/api/push/token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ token }),
  });
  const result = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(result.error || "Could not save notification settings.");
}
