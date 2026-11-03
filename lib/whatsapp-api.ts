import { auth } from "./firebase";

export type WhatsAppStatus = {
  status?: "disconnected" | "connecting" | "connected";
  state?: "disconnected" | "starting" | "qr" | "ready";
  sessionExists?: boolean;
  qrDataUrl?: string | null;
  error?: string | null;
};

type StatusOptions = {
  restore?: boolean;
  start?: boolean;
  retry?: boolean;
};

function serviceUrl() {
  const value = process.env.NEXT_PUBLIC_WHATSAPP_SERVER_URL?.trim();
  if (!value) {
    throw new Error("WhatsApp service is not configured.");
  }
  return value.replace(/\/+$/, "");
}

export async function fetchWhatsAppStatus(
  options: StatusOptions = {},
): Promise<WhatsAppStatus> {
  const user = auth.currentUser;
  if (!user) throw new Error("Please sign in again before connecting WhatsApp.");
  const url = new URL(`${serviceUrl()}/api/whatsapp/status`);
  if (options.restore) url.searchParams.set("restore", "1");
  if (options.start) url.searchParams.set("start", "1");
  if (options.retry) url.searchParams.set("retry", "1");

  const response = await fetch(url, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
  });
  let result: WhatsAppStatus;
  try {
    result = (await response.json()) as WhatsAppStatus;
  } catch {
    throw new Error("WhatsApp service returned an invalid response.");
  }
  if (!response.ok) {
    throw new Error(result.error || "WhatsApp status could not be loaded.");
  }
  return result;
}

export async function sendWhatsAppMessage(leadId: string, message: string) {
  const user = auth.currentUser;
  if (!user) throw new Error("Please sign in again before contacting a lead.");
  const response = await fetch("/api/whatsapp/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await user.getIdToken()}`,
    },
    body: JSON.stringify({ message, leadId }),
  });
  let result: { sent?: boolean; error?: string };
  try {
    result = (await response.json()) as { sent?: boolean; error?: string };
  } catch {
    throw new Error("WhatsApp service returned an invalid response.");
  }
  if (!response.ok) {
    const error = new Error(result.error || "WhatsApp message could not be sent.");
    if (response.status === 409) error.name = "ConflictError";
    throw error;
  }
  return result;
}
