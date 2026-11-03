"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const QRCode = require("qrcode");
const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { Client, LocalAuth } = require("whatsapp-web.js");

const port = Number(process.env.PORT) || 10000;
const apiKey = process.env.WHATSAPP_SERVER_API_KEY;
const authPath = path.resolve(
  process.env.WHATSAPP_AUTH_PATH || path.join(__dirname, ".wwebjs_auth"),
);
const allowedOrigins = (process.env.FRONTEND_ORIGINS || "https://www.webglut.me")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (!apiKey || apiKey.length < 32) {
  throw new Error("WHATSAPP_SERVER_API_KEY must be configured with at least 32 characters.");
}

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY
  ?.trim()
  .replace(/^"/, "")
  .replace(/"$/, "")
  .replace(/\\n/g, "\n")
  .replace(/\r\n/g, "\n")
  .trim();

if (!projectId || !clientEmail || !privateKey) {
  throw new Error("FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY are required.");
}

const firebaseApp =
  getApps()[0] ||
  initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
const firebaseAuth = getAuth(firebaseApp);
const clients = new Map();

fs.mkdirSync(authPath, { recursive: true });

function sessionClientId(uid) {
  const hash = crypto.createHash("sha256").update(uid).digest("hex").slice(0, 32);
  return `leadglut-${hash}`;
}

function sessionPath(uid) {
  return path.join(authPath, `session-${sessionClientId(uid)}`);
}

function getBearerToken(request) {
  const authorization = request.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim() || null;
}

async function authenticatedUid(request) {
  const token = getBearerToken(request);
  if (!token) {
    const error = new Error("Missing Firebase authorization token.");
    error.status = 401;
    throw error;
  }
  try {
    const decoded = await firebaseAuth.verifyIdToken(token);
    return decoded.uid;
  } catch (error) {
    const code = error?.code;
    console.warn(
      "WhatsApp Firebase token verification failed:",
      code || error?.name || "unknown error",
    );
    const verificationError = new Error(
      typeof code === "string" && code.startsWith("auth/")
        ? "Authentication failed."
        : "Firebase token verification is temporarily unavailable.",
    );
    verificationError.status =
      typeof code === "string" && code.startsWith("auth/") ? 401 : 503;
    throw verificationError;
  }
}

function createWhatsAppClient(uid) {
  const clientId = sessionClientId(uid);
  const runtime = {
    client: null,
    state: "starting",
    qrDataUrl: null,
    error: null,
    initialization: null,
  };
  const client = new Client({
    authStrategy: new LocalAuth({ clientId, dataPath: authPath }),
    puppeteer: {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
      ...(process.env.PUPPETEER_EXECUTABLE_PATH
        ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }
        : {}),
    },
  });

  runtime.client = client;
  clients.set(uid, runtime);

  client.on("qr", (qr) => {
    runtime.state = "qr";
    runtime.error = null;
    QRCode.toDataURL(qr)
      .then((dataUrl) => {
        runtime.qrDataUrl = dataUrl;
      })
      .catch((error) => {
        runtime.error = "Could not render the WhatsApp QR code.";
        console.error("WhatsApp QR rendering failed:", error);
      });
  });
  client.on("authenticated", () => {
    runtime.state = "connecting";
    runtime.qrDataUrl = null;
  });
  client.on("ready", () => {
    runtime.state = "connected";
    runtime.qrDataUrl = null;
    runtime.error = null;
    console.info(`WhatsApp session ready for ${clientId}.`);
  });
  client.on("auth_failure", (message) => {
    runtime.state = "disconnected";
    runtime.qrDataUrl = null;
    runtime.error = "WhatsApp authentication failed. Retry the connection.";
    console.error(`WhatsApp authentication failed for ${clientId}:`, message);
  });
  client.on("disconnected", (reason) => {
    runtime.state = "disconnected";
    runtime.qrDataUrl = null;
    runtime.error = "WhatsApp disconnected. Retry the connection.";
    console.warn(`WhatsApp disconnected for ${clientId}:`, reason);
  });

  runtime.initialization = client.initialize().catch((error) => {
    runtime.state = "disconnected";
    runtime.qrDataUrl = null;
    runtime.error = "WhatsApp could not start. Check the Render service logs and try again.";
    console.error(`WhatsApp initialization failed for ${clientId}:`, error);
  });

  return runtime;
}

async function resetWhatsAppClient(uid) {
  const runtime = clients.get(uid);
  if (!runtime) return;
  clients.delete(uid);
  try {
    await runtime.client.destroy();
  } catch (error) {
    console.warn("WhatsApp client shutdown failed:", error);
  }
}

function normalizeNumber(value) {
  const digits = value.replace(/\D/g, "").replace(/^0+/, "");
  if (/^[6-9]\d{9}$/.test(digits)) return `91${digits}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return digits;
  if (/^[1-9]\d{7,14}$/.test(digits)) return digits;
  return null;
}

function hasValidApiKey(request) {
  const supplied = Buffer.from(request.get("x-api-key") || "");
  const expected = Buffer.from(apiKey);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

const app = express();
app.disable("x-powered-by");
app.use((request, response, next) => {
  const origin = request.get("origin");
  if (origin && allowedOrigins.includes(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  } else if (origin) {
    return response.status(403).json({ error: "Origin is not allowed." });
  }
  if (request.method === "OPTIONS") return response.sendStatus(204);
  next();
});
app.use(express.json({ limit: "16kb" }));

app.get("/health", (_request, response) => {
  response.json({ ok: true });
});

app.get("/api/whatsapp/status", async (request, response) => {
  try {
    const uid = await authenticatedUid(request);
    if (request.query.retry === "1") {
      await resetWhatsAppClient(uid);
    }

    let runtime = clients.get(uid);
    const shouldRestore =
      request.query.restore === "1" && fs.existsSync(sessionPath(uid));
    if (
      request.query.start === "1" ||
      request.query.retry === "1" ||
      shouldRestore
    ) {
      runtime ||= createWhatsAppClient(uid);
    }

    runtime ||= {
      state: "disconnected",
      qrDataUrl: null,
      error: null,
    };

    const state = runtime.state;
    response.setHeader("Cache-Control", "no-store");
    return response.json({
      status:
        state === "connected"
          ? "connected"
          : state === "disconnected"
            ? "disconnected"
            : "connecting",
      state:
        state === "connected"
          ? "ready"
          : state === "qr"
            ? "qr"
            : state === "disconnected"
              ? "disconnected"
              : "starting",
      sessionExists: fs.existsSync(sessionPath(uid)),
      qrDataUrl: runtime.qrDataUrl || null,
      error: runtime.error || null,
    });
  } catch (error) {
    const status = Number(error?.status) || 500;
    return response.status(status).json({
      error:
        status === 401
          ? "Authentication failed."
          : status === 503
            ? "Firebase token verification is temporarily unavailable."
            : "WhatsApp status could not be loaded.",
    });
  }
});

app.post("/api/whatsapp/send", async (request, response) => {
  if (!hasValidApiKey(request)) {
    return response.status(401).json({ error: "Unauthorized." });
  }

  const { userId, number, message } = request.body || {};
  if (
    typeof userId !== "string" ||
    !userId ||
    typeof number !== "string" ||
    typeof message !== "string" ||
    !message.trim() ||
    message.length > 2000
  ) {
    return response.status(400).json({ error: "A userId, valid number, and message of 1–2,000 characters are required." });
  }

  const normalizedNumber = normalizeNumber(number);
  if (!normalizedNumber) {
    return response.status(400).json({ error: "The recipient number is invalid." });
  }

  const runtime = clients.get(userId);
  if (!runtime || runtime.state !== "connected") {
    return response.status(409).json({ error: "This user's WhatsApp session is not connected. Scan the QR code first." });
  }

  try {
    const recipient = await runtime.client.getNumberId(normalizedNumber);
    if (!recipient) {
      return response.status(400).json({ error: "This number is not registered on WhatsApp." });
    }
    const sent = await runtime.client.sendMessage(recipient._serialized, message.trim());
    return response.json({ sent: true, messageId: sent.id?._serialized || null });
  } catch (error) {
    console.error("WhatsApp message send failed:", error);
    return response.status(502).json({ error: "WhatsApp could not send the message. Please try again." });
  }
});

app.use((error, _request, response, _next) => {
  if (error instanceof SyntaxError && "body" in error) {
    return response.status(400).json({ error: "Request body must contain valid JSON." });
  }
  console.error("WhatsApp server request failed:", error);
  return response.status(500).json({ error: "Internal server error." });
});

const server = app.listen(port, "0.0.0.0", () => {
  console.info(`WhatsApp service listening on port ${port}.`);
  console.info(`WhatsApp LocalAuth data path: ${authPath}`);
});

async function shutdown(signal) {
  console.info(`${signal} received; closing WhatsApp sessions.`);
  server.close();
  await Promise.all(
    [...clients.values()].map((runtime) =>
      runtime.client.destroy().catch((error) => {
        console.warn("WhatsApp client shutdown failed:", error);
      }),
    ),
  );
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
