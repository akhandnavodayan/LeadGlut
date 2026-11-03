import type { Firestore } from "firebase-admin/firestore";

const WINDOW_MS = 15 * 60 * 1000;
const TEMP_BLOCK_MS = 60 * 60 * 1000;

export async function recordSuspiciousActivity(
  db: Firestore,
  uid: string,
  score: number,
  reason: string,
) {
  const ref = db.collection("users").doc(uid);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data() || {};
    if (data.permanentlyBlocked) return { blocked: true, permanent: true };
    const now = Date.now();
    const started = data.securityWindowStartedAt?.toDate
      ? data.securityWindowStartedAt.toDate().getTime()
      : Number(data.securityWindowStartedAt || 0);
    const inWindow = started > 0 && now - started < WINDOW_MS;
    const currentScore = inWindow ? Number(data.securityScore || 0) : 0;
    const currentStrikes = inWindow ? Number(data.securityStrikes || 0) : 0;
    const nextScore = currentScore + score;
    const nextStrikes = currentStrikes + 1;
    const permanentlyBlock = nextScore >= 15 || (score >= 8 && nextStrikes >= 2);
    const update = permanentlyBlock
      ? {
          permanentlyBlocked: true,
          blockedUntil: null,
          securityScore: nextScore,
          securityStrikes: nextStrikes,
          securityWindowStartedAt: new Date(inWindow ? started : now),
          lastSecurityEvent: reason,
          lastSecurityEventAt: new Date(),
        }
      : nextScore >= 6
        ? {
            blockedUntil: new Date(now + TEMP_BLOCK_MS),
            securityScore: nextScore,
            securityStrikes: nextStrikes,
            securityWindowStartedAt: new Date(inWindow ? started : now),
            lastSecurityEvent: reason,
            lastSecurityEventAt: new Date(),
          }
        : {
            securityScore: nextScore,
            securityStrikes: nextStrikes,
            securityWindowStartedAt: new Date(inWindow ? started : now),
            lastSecurityEvent: reason,
            lastSecurityEventAt: new Date(),
          };
    transaction.set(ref, update, { merge: true });
    return { blocked: permanentlyBlock || nextScore >= 6, permanent: permanentlyBlock };
  });
}
