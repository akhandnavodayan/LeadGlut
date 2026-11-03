import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { requireUser } from "../../../../lib/api-auth";
import Razorpay from "razorpay";
import { adminServices } from "../../../../lib/firebase-admin";
import { enforceRateLimit } from "../../../../lib/rate-limit";
import { recordSuspiciousActivity } from "../../../../lib/security-activity";

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const rate = enforceRateLimit(`payment-verify:${user.uid}`, 30, 60 * 60 * 1000);
    if (!rate.allowed) {
      await recordSuspiciousActivity(adminServices().db, user.uid, 5, "Repeated payment verification requests");
      return NextResponse.json(
        { error: "Payment verification rate limit reached." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfter) } },
      );
    }
    const body = await request.json() as { razorpay_order_id?: string; razorpay_payment_id?: string; razorpay_signature?: string };
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret || !body.razorpay_order_id || !body.razorpay_payment_id || !body.razorpay_signature) {
      return NextResponse.json({ error: "Incomplete payment verification request." }, { status: 400 });
    }
    const expected = crypto.createHmac("sha256", secret).update(`${body.razorpay_order_id}|${body.razorpay_payment_id}`).digest("hex");
    const received = Buffer.from(body.razorpay_signature);
    if (received.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(expected), received)) {
      await recordSuspiciousActivity(adminServices().db, user.uid, 8, "Invalid Razorpay payment signature");
      return NextResponse.json({ error: "Invalid payment signature." }, { status: 400 });
    }
    const paymentId = body.razorpay_payment_id;
    const orderId = body.razorpay_order_id;
    const razorpay = new Razorpay({ key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID!, key_secret: secret });
    const order = await razorpay.orders.fetch(orderId);
    if (order.notes?.firebaseUid !== user.uid) return NextResponse.json({ error: "Payment order does not belong to this user." }, { status: 403 });
    const payment = await razorpay.payments.fetch(paymentId);
    if (payment.order_id !== orderId || payment.status !== "captured") {
      return NextResponse.json({ error: "Payment has not been captured." }, { status: 400 });
    }
    const amount = Number(order.notes?.walletAmount);
    if (!Number.isInteger(amount) || amount < 1) return NextResponse.json({ error: "Invalid wallet amount in payment order." }, { status: 400 });
    const discount = Number(order.notes?.discount ?? 0);
    const expectedAmount = Math.max(100, (amount - discount) * 100);
    if (Number(order.amount) !== expectedAmount || Number(payment.amount) !== expectedAmount) {
      return NextResponse.json({ error: "Payment amount does not match the order." }, { status: 400 });
    }
    const { db } = adminServices();
    const ref = db.collection("users").doc(user.uid);
    const balance = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const paymentRef = ref.collection("transactions").doc(paymentId);
      const paymentSnapshot = await transaction.get(paymentRef);
      const current = Number(snapshot.data()?.walletBalance ?? 0);
      if (paymentSnapshot.exists) return current;
      const updated = current + amount;
      transaction.set(ref, { walletBalance: updated, updatedAt: new Date() }, { merge: true });
      transaction.set(paymentRef, {
        type: "topup",
        amount,
        discount,
        coupon: order.notes?.coupon || null,
        paymentId,
        orderId,
        createdAt: new Date(),
      });
      return updated;
    });
    return NextResponse.json({ balance });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to verify payment.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
