import { NextRequest, NextResponse } from "next/server";
import { adminServices } from "../../../../lib/firebase-admin";
import { isAdminEmail } from "../../../../lib/api-auth";

export async function GET(request: NextRequest) {
  try {
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Missing Firebase authorization token." }, { status: 401 });
    }
    const { auth, db } = adminServices();
    const user = await auth.verifyIdToken(authorization.slice("Bearer ".length));
    const data = (await db.collection("users").doc(user.uid).get()).data() || {};
    const blockedUntil = data.blockedUntil?.toDate ? data.blockedUntil.toDate() : data.blockedUntil ? new Date(data.blockedUntil) : null;
    const blocked = Boolean(data.permanentlyBlocked) || Boolean(blockedUntil && blockedUntil.getTime() > Date.now());
    return NextResponse.json({
      blocked,
      permanentlyBlocked: Boolean(data.permanentlyBlocked),
      blockedUntil: blockedUntil?.toISOString() || null,
      isAdmin: isAdminEmail(user.email),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Account status could not be loaded." }, { status: 401 });
  }
}
