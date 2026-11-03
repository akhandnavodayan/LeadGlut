import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../../../../lib/api-auth";
import { adminServices } from "../../../../lib/firebase-admin";

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const { code } = await request.json() as { code?: string };
    const { db } = adminServices();
    const normalizedCode = code?.trim().toUpperCase();
    if (!normalizedCode) return NextResponse.json({ error: "Enter a coupon code." }, { status: 400 });
    const couponSnapshot = await db.collection("coupons").where("code", "==", normalizedCode).where("active", "==", true).limit(1).get();
    if (couponSnapshot.empty) {
      return NextResponse.json({ error: "Invalid coupon code." }, { status: 400 });
    }
    const couponRef = couponSnapshot.docs[0].ref;
    const coupon = couponSnapshot.docs[0].data();
    const maxUses = Number(coupon.maxUses ?? 0);
    if (maxUses > 0 && Number(coupon.uses ?? 0) >= maxUses) return NextResponse.json({ error: "This coupon has reached its usage limit." }, { status: 400 });
    const creditAmount = Number(coupon.creditAmount ?? 0);
    if (creditAmount > 0) {
      const userRef = db.collection("users").doc(user.uid);
      const redemptionRef = userRef.collection("transactions").doc(`coupon_${couponRef.id}`);
      const result = await db.runTransaction(async (transaction) => {
        const userSnapshot = await transaction.get(userRef);
        const redemptionSnapshot = await transaction.get(redemptionRef);
        const currentCouponSnapshot = await transaction.get(couponRef);
        const currentCoupon = currentCouponSnapshot.data();
        const currentUses = Number(currentCoupon?.uses ?? 0);
        if (redemptionSnapshot.exists) {
          return { balance: Number(userSnapshot.data()?.walletBalance ?? 0), alreadyRedeemed: true };
        }
        if (Number(currentCoupon?.maxUses ?? 0) > 0 && currentUses >= Number(currentCoupon?.maxUses)) {
          throw new Error("This coupon has reached its usage limit.");
        }
        const balance = Number(userSnapshot.data()?.walletBalance ?? 0) + creditAmount;
        transaction.set(userRef, { walletBalance: balance, updatedAt: new Date() }, { merge: true });
        transaction.set(redemptionRef, { type: "coupon", amount: creditAmount, coupon: normalizedCode, createdAt: new Date() });
        transaction.update(couponRef, { uses: currentUses + 1, updatedAt: new Date() });
        return { balance, alreadyRedeemed: false };
      });
      return NextResponse.json({
        balance: result.balance,
        creditAmount,
        message: result.alreadyRedeemed ? "This coupon has already been redeemed." : `₹${creditAmount} added to your wallet.`,
      }, { status: result.alreadyRedeemed ? 409 : 200 });
    }
    return NextResponse.json({ discountPercent: Number(coupon.discountPercent ?? 0), creditAmount: 0, message: "Coupon applied." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Coupon could not be redeemed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
