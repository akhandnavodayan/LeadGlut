import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { getWhatsAppState, hasWhatsAppSession, resetWhatsAppRuntime, startWhatsAppInBackground } from "../../../../lib/whatsapp-web";
import { requireUser } from "../../../../lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    if (process.env.VERCEL) {
      return NextResponse.json({
        state: "disconnected",
        sessionExists: false,
        qrDataUrl: null,
        error: "WhatsApp QR sessions require a persistent server. Vercel serverless storage is not writable or persistent.",
      }, { status: 503 });
    }
    const shouldRestore = request.nextUrl.searchParams.get("restore") === "1"
      && await hasWhatsAppSession(user.uid);
    if (request.nextUrl.searchParams.get("retry") === "1") {
      await resetWhatsAppRuntime(user.uid);
    }
    if (request.nextUrl.searchParams.get("start") === "1" || shouldRestore) {
      startWhatsAppInBackground(user.uid);
    }
    const status = getWhatsAppState(user.uid);
    return NextResponse.json({
      state: status.state,
      sessionExists: shouldRestore,
      qrDataUrl: status.qr ? await QRCode.toDataURL(status.qr) : null,
      error: status.error,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "WhatsApp could not start." }, { status: 500 });
  }
}
