import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import QRCode from "qrcode";
import { getWhatsAppSessionPath, getWhatsAppState, resetWhatsAppRuntime, startWhatsAppInBackground } from "../../../../lib/whatsapp-web";
import { requireUser } from "../../../../lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const sessionPath = getWhatsAppSessionPath(user.uid);
    const shouldRestore = request.nextUrl.searchParams.get("restore") === "1"
      && fs.existsSync(sessionPath);
    if (request.nextUrl.searchParams.get("retry") === "1") {
      await resetWhatsAppRuntime(user.uid);
    }
    if (request.nextUrl.searchParams.get("start") === "1" || shouldRestore) {
      startWhatsAppInBackground(user.uid);
    }
    const status = getWhatsAppState(user.uid);
    return NextResponse.json({
      state: status.state,
      sessionExists: fs.existsSync(sessionPath),
      qrDataUrl: status.qr ? await QRCode.toDataURL(status.qr) : null,
      error: status.error,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "WhatsApp could not start." }, { status: 500 });
  }
}
