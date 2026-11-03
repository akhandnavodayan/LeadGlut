import { NextRequest, NextResponse } from "next/server";
import { sendWhatsAppMessage } from "../../../../lib/whatsapp-web";
import { requireUser } from "../../../../lib/api-auth";
import { adminServices } from "../../../../lib/firebase-admin";
import { enforceRateLimit } from "../../../../lib/rate-limit";
import { recordSuspiciousActivity } from "../../../../lib/security-activity";

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const rate = enforceRateLimit(`whatsapp:${user.uid}`, 20, 24 * 60 * 60 * 1000);
    if (!rate.allowed) {
      const activity = await recordSuspiciousActivity(adminServices().db, user.uid, 4, "Repeated WhatsApp messaging requests");
      if (activity.blocked) return NextResponse.json({ error: "This account is currently blocked." }, { status: 403 });
      return NextResponse.json(
        { error: "Daily WhatsApp contact limit of 20 leads has been reached." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfter) } },
      );
    }
    const { message, leadId } = await request.json() as { message?: string; leadId?: string };
    if (!message || message.length > 2000) return NextResponse.json({ error: "A message between 1 and 2,000 characters is required." }, { status: 400 });
    if (!leadId?.trim()) return NextResponse.json({ error: "A purchased lead is required." }, { status: 400 });
    const { db } = adminServices();
    const savedRef = db.collection("users").doc(user.uid).collection("savedLeads").doc(leadId.trim());
    const day = new Date().toISOString().slice(0, 10);
    const reservation = await db.runTransaction(async (transaction) => {
      const [savedSnapshot, userSnapshot] = await Promise.all([transaction.get(savedRef), transaction.get(db.collection("users").doc(user.uid))]);
      if (!savedSnapshot.exists || !savedSnapshot.data()?.purchasedAt) throw new Error("This lead must be purchased before contacting it.");
      const phone = String(savedSnapshot.data()?.phone || "");
      if (!/^[6-9]\d{9}$/.test(phone)) throw new Error("This lead does not have a valid WhatsApp number.");
      if (savedSnapshot.data()?.contactedAt) throw new Error("This lead has already been contacted.");
      if (savedSnapshot.data()?.contactInProgress) throw new Error("This lead is already being contacted.");
      const userData = userSnapshot.data() || {};
      const count = userData.contactDay === day ? Number(userData.contactCount ?? 0) : 0;
      if (count >= 20) throw new Error("Daily WhatsApp contact limit of 20 leads has been reached.");
      transaction.set(savedRef, { contactInProgress: true }, { merge: true });
      transaction.set(db.collection("users").doc(user.uid), { contactDay: day, contactCount: count + 1 }, { merge: true });
      return phone;
    });
    if (!reservation) throw new Error("Contact reservation failed.");
    try {
      await sendWhatsAppMessage(user.uid, reservation, message);
      await savedRef.set({ contactedAt: new Date(), contactInProgress: false }, { merge: true });
    } catch (error) {
      await db.runTransaction(async (transaction) => {
        const userRef = db.collection("users").doc(user.uid);
        const userSnapshot = await transaction.get(userRef);
        const userData = userSnapshot.data() || {};
        const count = userData.contactDay === day ? Math.max(0, Number(userData.contactCount ?? 1) - 1) : 0;
        transaction.set(savedRef, { contactInProgress: false }, { merge: true });
        transaction.set(userRef, { contactCount: count }, { merge: true });
      });
      throw error;
    }
    return NextResponse.json({ sent: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Message could not be sent.";
    console.error("WhatsApp send failed:", message);
    const status = message.includes("already been contacted") || message.includes("already being contacted")
      ? 409
      : message.includes("not registered") || message.includes("invalid")
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
