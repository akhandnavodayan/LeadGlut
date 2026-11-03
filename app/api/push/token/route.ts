import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../../../../lib/api-auth";
import { adminServices } from "../../../../lib/firebase-admin";

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const body = await request.json() as { token?: string };
    const token = String(body.token || "").trim();
    if (token.length < 20 || token.length > 4096) {
      return NextResponse.json({ error: "Invalid notification token." }, { status: 400 });
    }
    const tokenId = Buffer.from(token).toString("base64url").slice(0, 100);
    await adminServices().db.collection("users").doc(user.uid).collection("pushTokens").doc(tokenId).set({
      token,
      updatedAt: new Date(),
      platform: "web",
    }, { merge: true });
    return NextResponse.json({ registered: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not register notifications." }, { status: 401 });
  }
}
