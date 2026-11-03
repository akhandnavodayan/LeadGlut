import { NextRequest, NextResponse } from "next/server";
import { adminServices } from "../../../lib/firebase-admin";
import { enforceRateLimit } from "../../../lib/rate-limit";

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "unknown";
  const rate = enforceRateLimit(`contact:${ip}`, 5, 60 * 60 * 1000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many messages. Please try again later." }, { status: 429 });
  }
  try {
    const body = await request.json() as { name?: string; email?: string; subject?: string; message?: string };
    const name = String(body.name || "").trim().slice(0, 100);
    const email = String(body.email || "").trim().toLowerCase().slice(0, 254);
    const subject = String(body.subject || "").trim().slice(0, 160);
    const message = String(body.message || "").trim().slice(0, 4000);
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !subject || !message) {
      return NextResponse.json({ error: "Please complete all fields with a valid email address." }, { status: 400 });
    }
    await adminServices().db.collection("contactMessages").add({
      name,
      email,
      subject,
      message,
      status: "new",
      createdAt: new Date(),
      source: "contact_page",
    });
    return NextResponse.json({ sent: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Message could not be sent." }, { status: 400 });
  }
}
