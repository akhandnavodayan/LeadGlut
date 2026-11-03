import path from "node:path";
import type { Client as WhatsAppClient } from "whatsapp-web.js";

// Avoid incompatible optional native websocket modules in server environments.
process.env.WS_NO_BUFFER_UTIL ??= "1";
process.env.WS_NO_UTF_8_VALIDATE ??= "1";

const { Client, LocalAuth } = require("whatsapp-web.js") as typeof import("whatsapp-web.js");

type WhatsAppState = "starting" | "qr" | "authenticated" | "ready" | "disconnected";

type WhatsAppRuntime = {
  client?: WhatsAppClient;
  state: WhatsAppState;
  latestQr: string | null;
  startPromise?: Promise<void>;
  initializationError: string | null;
  lastInitializationFailure: number;
};

const runtimeHost = globalThis as typeof globalThis & {
  __leadglutWhatsAppRuntimes?: Map<string, WhatsAppRuntime>;
};
const runtimes = runtimeHost.__leadglutWhatsAppRuntimes ?? new Map<string, WhatsAppRuntime>();
runtimeHost.__leadglutWhatsAppRuntimes = runtimes;
const retryCooldownMs = 30_000;
const initializationTimeoutMs = 30_000;

function getRuntime(userId: string) {
  let runtime = runtimes.get(userId);
  if (!runtime) {
    runtime = {
      state: "disconnected",
      latestQr: null,
      initializationError: null,
      lastInitializationFailure: 0,
    };
    runtimes.set(userId, runtime);
  }
  return runtime;
}

function getSessionId(userId: string) {
  return userId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function getWhatsAppSessionPath(userId: string) {
  return path.join(process.cwd(), ".wwebjs_auth", `session-leadglut-${getSessionId(userId)}`);
}

async function initializeClient(client: WhatsAppClient) {
  await Promise.race([
    client.initialize(),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("WhatsApp connection timed out. Please try again.")), initializationTimeoutMs);
    }),
  ]);
}

function getClient(userId: string, runtime: WhatsAppRuntime) {
  if (runtime.client) return runtime.client;

  const sessionId = getSessionId(userId);
  runtime.client = new Client({
    authStrategy: new LocalAuth({
      clientId: `leadglut-${sessionId}`,
      dataPath: path.join(process.cwd(), ".wwebjs_auth"),
    }),
    puppeteer: { headless: true },
  });
  runtime.client.on("qr", (qr) => {
    runtime.latestQr = qr;
    runtime.state = "qr";
  });
  runtime.client.on("authenticated", () => {
    runtime.latestQr = null;
    runtime.state = "authenticated";
  });
  runtime.client.on("ready", () => {
    runtime.latestQr = null;
    runtime.state = "ready";
    runtime.initializationError = null;
    runtime.lastInitializationFailure = 0;
  });
  runtime.client.on("disconnected", (reason) => {
    runtime.latestQr = null;
    runtime.state = "disconnected";
    runtime.startPromise = undefined;
    runtime.initializationError = reason ? `WhatsApp disconnected: ${reason}` : "WhatsApp disconnected before it was ready.";
    runtime.lastInitializationFailure = Date.now();
  });
  runtime.client.on("auth_failure", (message) => {
    runtime.latestQr = null;
    runtime.state = "disconnected";
    runtime.startPromise = undefined;
    runtime.initializationError = message ? `WhatsApp authentication failed: ${message}` : "WhatsApp authentication failed.";
    runtime.lastInitializationFailure = Date.now();
  });
  return runtime.client;
}

export async function startWhatsApp(userId: string) {
  const runtime = getRuntime(userId);
  if (runtime.state === "ready" || runtime.state === "qr" || runtime.state === "starting" || runtime.state === "authenticated") return;
  if (runtime.initializationError && Date.now() - runtime.lastInitializationFailure < retryCooldownMs) {
    throw new Error(runtime.initializationError);
  }
  if (!runtime.startPromise) {
    runtime.state = "starting";
    const client = getClient(userId, runtime);
    runtime.startPromise = initializeClient(client).catch((error: unknown) => {
      runtime.state = "disconnected";
      runtime.initializationError = error instanceof Error ? error.message : "WhatsApp initialization failed.";
      runtime.lastInitializationFailure = Date.now();
      runtime.startPromise = undefined;
      runtime.client = undefined;
      void client.destroy().catch(() => undefined);
      throw error;
    });
  }
  await runtime.startPromise;
}

export function startWhatsAppInBackground(userId: string) {
  const runtime = getRuntime(userId);
  if (runtime.state === "ready" || runtime.state === "qr" || runtime.state === "starting" || runtime.state === "authenticated") return;
  if (runtime.initializationError && Date.now() - runtime.lastInitializationFailure < retryCooldownMs) return;
  runtime.state = "starting";
  const client = getClient(userId, runtime);
  runtime.startPromise = initializeClient(client).catch((error: unknown) => {
    runtime.state = "disconnected";
    runtime.initializationError = error instanceof Error ? error.message : "WhatsApp initialization failed.";
    runtime.lastInitializationFailure = Date.now();
    runtime.startPromise = undefined;
    runtime.client = undefined;
    void client.destroy().catch(() => undefined);
    console.error("WhatsApp initialization failed:", runtime.initializationError);
  });
}

export function getWhatsAppState(userId: string) {
  const runtime = getRuntime(userId);
  return { state: runtime.state, qr: runtime.latestQr, error: runtime.initializationError };
}

export async function resetWhatsAppRuntime(userId: string) {
  const runtime = getRuntime(userId);
  const client = runtime.client;
  runtime.client = undefined;
  runtime.startPromise = undefined;
  runtime.latestQr = null;
  runtime.initializationError = null;
  runtime.lastInitializationFailure = 0;
  runtime.state = "disconnected";
  if (client) await client.destroy().catch(() => undefined);
}

export async function sendWhatsAppMessage(userId: string, phone: string, message: string) {
  await startWhatsApp(userId);
  const runtime = getRuntime(userId);
  if (runtime.state !== "ready") throw new Error("WhatsApp is not connected. Scan the real WhatsApp QR first.");
  const digits = phone.replace(/\D/g, "").replace(/^0+/, "");
  const normalized = digits.length === 10
    ? `91${digits}`
    : digits.startsWith("91") && digits.length === 12
      ? digits
      : digits;
  if (!/^91[6-9]\d{9}$/.test(normalized)) throw new Error("Lead phone number is invalid. Use a valid Indian mobile number.");
  const client = getClient(userId, runtime);
  const numberId = await client.getNumberId(normalized);
  if (!numberId) throw new Error("This lead number is not registered on WhatsApp.");
  await client.sendMessage(numberId._serialized, message);
}
