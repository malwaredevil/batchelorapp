import "./sentry";
import { mountApp } from "@workspace/web-core";
import App from "./App";
import "./index.css";

mountApp(App);

// ── Service worker + Web Push registration ──────────────────────────────────
// Runs after the React tree mounts so it never blocks initial paint.
// Gracefully no-ops in environments that don't support the APIs.
if (typeof window !== "undefined") {
  window.addEventListener("load", () => {
    registerServiceWorker().catch(() => {});
  });

  // MessengerNotification dispatches this event when the user grants permission.
  window.addEventListener("batchelor:push-permitted", () => {
    navigator.serviceWorker.ready
      .then((reg) => subscribeToPush(reg))
      .catch(() => {});
  });
}

async function registerServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

  let reg: ServiceWorkerRegistration;
  try {
    reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return;
  }

  // If the user has already granted permission, re-subscribe silently.
  // The permission prompt itself is shown from MessengerNotification.tsx so
  // it only appears after the user has seen the chat and has context.
  if ((Notification as typeof Notification).permission === "granted") {
    await subscribeToPush(reg).catch(() => {});
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const buf = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buf);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function subscribeToPush(
  reg?: ServiceWorkerRegistration,
): Promise<void> {
  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (!vapidKey) return;

  if (!reg) {
    if (!("serviceWorker" in navigator)) return;
    reg = await navigator.serviceWorker.ready;
  }

  const applicationServerKey = urlBase64ToUint8Array(vapidKey);
  const existing = await reg.pushManager.getSubscription();

  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    }));

  const subJson = sub.toJSON();
  await fetch("/api/messenger/push-subscribe", {
    // raw-fetch-ok — called outside React render (SW event listener); hooks not available here
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      endpoint: subJson.endpoint,
      keys: {
        p256dh: subJson.keys?.p256dh ?? "",
        auth: subJson.keys?.auth ?? "",
      },
    }),
  });
}
