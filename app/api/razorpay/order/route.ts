import { NextRequest, NextResponse } from "next/server";
import Razorpay from "razorpay";
import { requireUser } from "../../../../lib/api-auth";
import { adminServices } from "../../../../lib/firebase-admin";

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const { amount, couponCode } = await request.json() as { amount?: number; couponCode?: string };
    if (!amount || !Number.isInteger(amount) || amount < 1 || amount > 10000) {
      return NextResponse.json({ error: "Top-up must be between ₹1 and ₹10,000." }, { status: 400 });
    }
    const { db } = adminServices();
    const normalizedCoupon = couponCode?.trim().toUpperCase();
    const couponSnapshot = normalizedCoupon
      ? await db.collection("coupons").where("code", "==", normalizedCoupon).where("active", "==", true).limit(1).get()
      : null;
    const couponDoc = couponSnapshot && !couponSnapshot.empty ? couponSnapshot.docs[0] : null;
    const coupon = couponDoc?.data() || null;
    const maxUses = Number(coupon?.maxUses ?? 0);
    if (coupon && maxUses > 0 && Number(coupon.uses ?? 0) >= maxUses) {
      return NextResponse.json({ error: "This coupon has reached its usage limit." }, { status: 400 });
    }
    const couponApplied = Boolean(coupon);
    const discount = coupon ? Math.floor(amount * Number(coupon.discountPercent ?? 0) / 100) : 0;
    const payableAmount = Math.max(1, amount - discount);
    const keyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      return NextResponse.json({ error: "Razorpay is not configured on the server." }, { status: 503 });
    }
    const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
    const receipt = `leadglut_${user.uid.slice(0, 12)}_${Date.now()}`;
    const order = await razorpay.orders.create({
      amount: payableAmount * 100,
      currency: "INR",
      receipt,
      notes: {
        firebaseUid: user.uid,
        walletAmount: String(amount),
        discount: String(discount),
        coupon: couponApplied ? normalizedCoupon || "" : "",
        couponId: couponDoc?.id || "",
      },
    });
    if (couponDoc) {
      try {
        await db.runTransaction(async (transaction) => {
          const currentSnapshot = await transaction.get(couponDoc.ref);
          const current = currentSnapshot.data() || {};
          const uses = Number(current.uses ?? 0);
          const maxUses = Number(current.maxUses ?? 0);
          if (!current.active || (maxUses > 0 && uses >= maxUses)) {
            throw new Error("This coupon has reached its usage limit.");
          }
          transaction.update(couponDoc.ref, { uses: uses + 1, updatedAt: new Date() });
        });
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "This coupon is no longer available." }, { status: 400 });
      }
    }
    return NextResponse.json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId, walletAmount: amount, discount, payableAmount });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create payment order.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
