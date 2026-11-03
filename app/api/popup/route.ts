import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../../../lib/api-auth";
import { adminServices } from "../../../lib/firebase-admin";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const { db } = adminServices();
    const snapshot = await db.collection("popups").where("active", "==", true).limit(100).get();
    const dismissed = await db.collection("users").doc(user.uid).collection("dismissedPopups").get();
    const dismissedIds = new Set(dismissed.docs.map((item) => item.id));
    const popup = snapshot.docs
      .sort((a, b) => (b.data().createdAt?.toMillis?.() || 0) - (a.data().createdAt?.toMillis?.() || 0))
      .find((item) => !dismissedIds.has(item.id) && (!item.data().targetUserId || item.data().targetUserId === user.uid));
    return NextResponse.json({ popup: popup ? { id: popup.id, ...popup.data() } : null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Popup could not be loaded.";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const body = await request.json() as { popupId?: string };
    if (!body.popupId) return NextResponse.json({ error: "Popup id is required." }, { status: 400 });
    await adminServices().db.collection("users").doc(user.uid).collection("dismissedPopups").doc(body.popupId).set({ dismissedAt: new Date() });
    return NextResponse.json({ dismissed: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Popup could not be dismissed.";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
