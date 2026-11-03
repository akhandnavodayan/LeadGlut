import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { adminServices } from "../../../../lib/firebase-admin";
import { enforceRateLimit } from "../../../../lib/rate-limit";

export const runtime = "nodejs";

const sender = "contact@webglut.in";
const genericMessage =
  "If an account exists for that email, the requested message is on its way. Check your inbox and spam folder.";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  const rate = enforceRateLimit(`auth-mail:${ip}`, 5, 60 * 60 * 1000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many email requests. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfter) },
      },
    );
  }

  let email = "";
  let type: unknown;
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object") {
      if ("email" in body && typeof body.email === "string") {
        email = body.email.trim().toLowerCase();
      }
      if ("type" in body) type = body.type;
    }
  } catch {
    return NextResponse.json(
      { error: "A valid email address and message type are required." },
      { status: 400 },
    );
  }

  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    (type !== "reset" && type !== "verify")
  ) {
    return NextResponse.json(
      { error: "A valid email address and message type are required." },
      { status: 400 },
    );
  }

  const password = process.env.ZOHO_APP_PASSWORD;
  if (!password) {
    console.error("Auth email is not configured: ZOHO_APP_PASSWORD is missing.");
    return NextResponse.json(
      { error: "Email delivery is temporarily unavailable. Please try again later." },
      { status: 503 },
    );
  }

  try {
    const auth = adminServices().auth;
    const firebaseLink =
      type === "reset"
        ? await auth.generatePasswordResetLink(email)
        : await auth.generateEmailVerificationLink(email);
    let actionLink = firebaseLink;

    if (type === "reset") {
      const oobCode = new URL(firebaseLink).searchParams.get("oobCode");
      if (!oobCode) throw new Error("Firebase did not return a password reset action code.");
      const resetUrl = new URL(
        "/reset-password",
        process.env.APP_URL || "https://www.webglut.me",
      );
      resetUrl.searchParams.set("oobCode", oobCode);
      actionLink = resetUrl.toString();
    }

    const safeActionLink = escapeHtml(actionLink);
    const isReset = type === "reset";
    const subject = isReset
      ? "🔐 Reset your LeadGlut password"
      : "✅ Verify your LeadGlut email";
    const buttonLabel = isReset ? "Reset Password" : "Verify Email";
    const actionDescription = isReset
      ? "We received a request to reset your password. Use the button below to choose a new one."
      : "Thanks for creating a LeadGlut account. Verify your email address using the button below.";
    const ignoreDescription = isReset
      ? "If you didn't ask to reset your password, you can safely ignore this email."
      : "If you didn't create a LeadGlut account, you can safely ignore this email.";

    const transporter = nodemailer.createTransport({
      host: "smtp.zoho.in",
      port: 465,
      secure: true,
      auth: { user: sender, pass: password },
    });

    await transporter.sendMail({
      from: `"LeadGlut" <${sender}>`,
      to: email,
      subject,
      text: `Hello,\n\n${actionDescription}\n\nIf the button isn't available, open this email in an HTML-capable email client. ${ignoreDescription}`,
      html: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 30px; border: 1px solid #eaeaea; border-radius: 12px; background-color: #ffffff;">
  <h2 style="color: #000000; font-size: 24px; font-weight: 800; margin: 0 0 20px; letter-spacing: -0.5px;">LeadGlut</h2>
  <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 24px;">Hello,<br><br>${actionDescription}</p>
  <a href="${safeActionLink}" style="display: inline-block; background-color: #1a1a1a; color: #ffffff; padding: 14px 28px; text-decoration: none; font-size: 15px; font-weight: 600; border-radius: 8px; margin-bottom: 24px;">${buttonLabel}</a>
  <p style="color: #666666; font-size: 14px; line-height: 1.5; margin: 0;">${ignoreDescription}</p>
</div>`,
    });

    return NextResponse.json({ message: genericMessage });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "auth/user-not-found" || error.code === "auth/invalid-email")
    ) {
      return NextResponse.json({ message: genericMessage });
    }

    console.error("Custom auth email failed:", error);
    return NextResponse.json(
      { error: "The email could not be sent. Please try again later." },
      { status: 500 },
    );
  }
}
