import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../../../../lib/api-auth";
import { adminServices } from "../../../../lib/firebase-admin";

const defaultLeadId = "akhand-sample";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const { db } = adminServices();
    const leadId = request.nextUrl.searchParams.get("leadId") || defaultLeadId;
    const leadSnapshot = await db.collection("leads").doc(leadId).get();
    const snapshot = await db.collection("users").doc(user.uid).collection("savedLeads").doc(leadId).get();
    const purchasedBy = leadSnapshot.data()?.purchasedBy;
    return NextResponse.json({
      purchased: snapshot.exists,
      available: !purchasedBy,
      lead: snapshot.exists ? snapshot.data() : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Saved leads could not be loaded.";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const { db } = adminServices();
    const settingsSnapshot = await db.collection("settings").doc("app").get();
    const leadPrice = Number(settingsSnapshot.data()?.leadPrice ?? 1);
    const body = await request.json().catch(() => ({})) as { leadId?: string };
    const leadId = body.leadId?.trim() || defaultLeadId;
    const leadRef = db.collection("leads").doc(leadId);
    const userRef = db.collection("users").doc(user.uid);
    const savedRef = userRef.collection("savedLeads").doc(leadId);
    const transactionRef = userRef.collection("transactions").doc(`lead_${leadId}`);
    let charged = true;

    await db.runTransaction(async (transaction) => {
      const [leadSnapshot, userSnapshot, savedSnapshot] = await Promise.all([
        transaction.get(leadRef),
        transaction.get(userRef),
        transaction.get(savedRef),
      ]);
      if (savedSnapshot.exists) {
        charged = false;
        return;
      }
      const existing = leadSnapshot.data();
      if (!leadSnapshot.exists || !existing) throw new Error("This lead is no longer available.");
      if (existing?.purchasedBy && existing.purchasedBy !== user.uid) {
        throw new Error("This lead has already been purchased.");
      }
      const balance = Number(userSnapshot.data()?.walletBalance ?? 0);
      if (balance < leadPrice) throw new Error(`Add at least ₹${leadPrice} to your wallet before purchasing this lead.`);
      const purchasedAt = new Date();
      const purchasedLead = {
        id: leadId,
        name: existing.businessName || existing.name || "Unnamed business",
        phone: existing.phone || null,
        work: [existing.category, existing.status].filter(Boolean).join(" · ") || "Business lead",
        location: existing.city || existing.address || "India",
        website: existing.website || null,
        email: existing.email || null,
        instagram: existing.instagram || null,
      };
      transaction.set(leadRef, { purchasedBy: user.uid, purchasedAt }, { merge: true });
      transaction.set(savedRef, { ...purchasedLead, purchasedAt }, { merge: true });
      transaction.set(userRef, { walletBalance: balance - leadPrice, updatedAt: purchasedAt }, { merge: true });
      transaction.set(transactionRef, {
        type: "lead_purchase",
        amount: -leadPrice,
        leadId,
        leadName: purchasedLead.name,
        createdAt: purchasedAt,
      });
      return purchasedLead;
    });
    const purchasedLead = await db.collection("users").doc(user.uid).collection("savedLeads").doc(leadId).get();
    return NextResponse.json({ purchased: true, charged, lead: purchasedLead.data() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lead could not be purchased.";
    return NextResponse.json({ error: message }, { status: message.includes("already") ? 409 : 400 });
  }
}
