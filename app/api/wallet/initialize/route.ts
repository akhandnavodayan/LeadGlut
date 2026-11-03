import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../../../../lib/api-auth";
import { adminServices } from "../../../../lib/firebase-admin";

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const { db } = adminServices();
    const settingsSnapshot = await db.collection("settings").doc("app").get();
    const welcomeBonus = Number(settingsSnapshot.data()?.welcomeBonus ?? 10);
    const ref = db.collection("users").doc(user.uid);
    const initialization = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (snapshot.exists) {
        const profileUpdate: Record<string, unknown> = { updatedAt: new Date() };
        if (user.email) profileUpdate.email = user.email;
        if (user.name) profileUpdate.displayName = user.name;
        transaction.set(ref, profileUpdate, { merge: true });
        return {
          balance: Number(snapshot.data()?.walletBalance ?? 0),
          bonusGranted: Boolean(snapshot.data()?.bonusGranted),
          created: false,
        };
      }
      const now = new Date();
      transaction.set(ref, {
        email: user.email ?? null,
        displayName: user.name ?? null,
        walletBalance: welcomeBonus,
        bonusGranted: true,
        createdAt: now,
        updatedAt: now,
      });
      transaction.set(ref.collection("transactions").doc("welcome_bonus"), {
        type: "welcome_bonus",
        amount: welcomeBonus,
        createdAt: now,
      });
      return { balance: welcomeBonus, bonusGranted: true, created: true };
    });
    if (initialization.created) {
      return NextResponse.json({ balance: welcomeBonus, bonusGranted: true, history: [{ type: "welcome_bonus", amount: welcomeBonus }] });
    }
    const historySnapshot = await ref.collection("transactions").orderBy("createdAt", "desc").limit(20).get();
    return NextResponse.json({ balance: initialization.balance, bonusGranted: initialization.bonusGranted, history: historySnapshot.docs.map((item) => item.data()) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to initialize wallet.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
