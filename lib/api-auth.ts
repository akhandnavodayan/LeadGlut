import { NextRequest } from "next/server";
import { adminServices } from "./firebase-admin";
import { enforceRateLimit } from "./rate-limit";
import { recordSuspiciousActivity } from "./security-activity";

export function isAdminEmail(email: string | null | undefined) {
  const allowedEmails = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return Boolean(email && allowedEmails.includes(email.toLowerCase()));
}

export async function requireUser(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new Error("Missing Firebase authorization token.");
  }
  const token = authorization.slice("Bearer ".length);
  const { auth, db } = adminServices();
  const user = await auth.verifyIdToken(token);
  const requestRate = enforceRateLimit(`user-request:${user.uid}`, 300, 10 * 60 * 1000);
  if (!requestRate.allowed) {
    const activity = await recordSuspiciousActivity(db, user.uid, 5, "Excessive authenticated request rate");
    if (activity.blocked) throw new Error("This account is currently blocked.");
    throw new Error("Too many requests. Please try again later.");
  }
  const snapshot = await db.collection("users").doc(user.uid).get();
  const data = snapshot.data() || {};
  const blockedUntil = data.blockedUntil?.toDate
    ? data.blockedUntil.toDate()
    : data.blockedUntil
      ? new Date(data.blockedUntil)
      : null;
  if (
    Boolean(data.permanentlyBlocked) ||
    Boolean(blockedUntil && blockedUntil.getTime() > Date.now())
  ) {
    throw new Error("This account is currently blocked.");
  }
  const lastActiveAt = data.lastActiveAt?.toDate
    ? data.lastActiveAt.toDate()
    : data.lastActiveAt
      ? new Date(data.lastActiveAt)
      : null;
  if (snapshot.exists && (!lastActiveAt || Date.now() - lastActiveAt.getTime() >= 5 * 60 * 1000)) {
    await db.collection("users").doc(user.uid).set({ lastActiveAt: new Date() }, { merge: true });
  }
  return user;
}

export async function requireAdmin(request: NextRequest) {
  const user = await requireUser(request);
  if (!isAdminEmail(user.email)) {
    throw new Error("Admin access is required.");
  }
  return user;
}
