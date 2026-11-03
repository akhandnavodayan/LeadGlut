import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../lib/api-auth";
import { adminServices } from "../../../lib/firebase-admin";
import { enforceRateLimit } from "../../../lib/rate-limit";

type AdminAction =
  | { action: "updateSettings"; welcomeBonus?: number; leadPrice?: number }
  | {
      action: "createCoupon";
      code?: string;
      discountPercent?: number;
      creditAmount?: number;
      maxUses?: number;
    }
  | { action: "toggleCoupon"; id?: string; active?: boolean }
  | {
      action: "createPopup";
      title?: string;
      header?: string;
      body?: string;
      footer?: string;
      imageUrl?: string;
      buttonText?: string;
      buttonUrl?: string;
      type?: string;
      duration?: number;
      backgroundColor?: string;
      accentColor?: string;
    }
  | {
      action: "updatePopup";
      id?: string;
      title?: string;
      header?: string;
      body?: string;
      footer?: string;
      imageUrl?: string;
      buttonText?: string;
      buttonUrl?: string;
      type?: string;
      duration?: number;
      backgroundColor?: string;
      accentColor?: string;
    }
  | { action: "togglePopup"; id?: string; active?: boolean }
  | { action: "deletePopup"; id?: string }
  | {
      action: "blockUser";
      uid?: string;
      mode?: "temporary" | "permanent" | "unblock";
      until?: string;
    }
  | { action: "deleteUser"; uid?: string }
  | { action: "promoCredit"; uid?: string; amount?: number; note?: string }
  | {
      action: "createUserPopup";
      uid?: string;
      title?: string;
      header?: string;
      body?: string;
      footer?: string;
      imageUrl?: string;
      buttonText?: string;
      buttonUrl?: string;
      type?: string;
      duration?: number;
      backgroundColor?: string;
      accentColor?: string;
    }
  | {
      action: "sendPushNotification";
      uid?: string;
      title?: string;
      body?: string;
      imageUrl?: string;
      buttonUrl?: string;
    }
  | { action: "importLeads"; leads?: Array<Record<string, unknown>> };

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function popupImage(value: unknown) {
  const image = String(value || "").trim();
  if (image.startsWith("data:image/") && image.length > 950000)
    throw new Error(
      "Image file is too large. Choose an image smaller than 700 KB.",
    );
  if (!image) return "";
  if (image.startsWith("data:image/")) return image;
  try {
    const url = new URL(image);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("invalid");
    return url.href;
  } catch {
    throw new Error("Image URL must use http or https.");
  }
}

function popupUrl(value: unknown) {
  const url = String(value || "").trim();
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("invalid");
    return parsed.href;
  } catch {
    throw new Error("Popup button URL must use http or https.");
  }
}

function popupColor(value: unknown, fallback: string) {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function popupDuration(value: unknown) {
  const duration = Number(value);
  return Number.isInteger(duration) && duration >= 0 && duration <= 60 ? duration : 0;
}

function text(value: unknown, maxLength: number) {
  return String(value || "").trim().slice(0, maxLength);
}

function protectAdminTarget(uid: string, adminUid: string) {
  if (uid === adminUid) throw new Error("You cannot modify your own admin account.");
}

function dateValue(value: unknown) {
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate() as Date;
  }
  const date = value ? new Date(value as string | number | Date) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    const rate = enforceRateLimit(`admin:${admin.uid}`, 120, 60 * 60 * 1000);
    if (!rate.allowed) return NextResponse.json({ error: "Admin request rate limit reached." }, { status: 429 });
    const { auth, db, messaging } = adminServices();
    const [
      settingsSnapshot,
      couponsSnapshot,
      leadsSnapshot,
      usersSnapshot,
      popupsSnapshot,
        contactMessagesSnapshot,
        transactionSnapshot,
    ] = await Promise.all([
      db.collection("settings").doc("app").get(),
      db.collection("coupons").orderBy("createdAt", "desc").limit(100).get(),
      db.collection("leads").get(),
      db.collection("users").get(),
      db.collection("popups").orderBy("createdAt", "desc").limit(100).get(),
      db.collection("contactMessages").orderBy("createdAt", "desc").limit(200).get(),
      // Avoid a collection-group field index requirement; the report applies
      // its one-year window after reading the transaction records.
      db.collectionGroup("transactions").get(),
    ]);
    const now = Date.now();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const weekStart = now - 7 * 24 * 60 * 60 * 1000;
    const monthStart = now - 30 * 24 * 60 * 60 * 1000;
    const reportStart = new Date(new Date().getFullYear(), new Date().getMonth() - 11, 1);
    const transactions = transactionSnapshot.docs
      .map((item) => item.data())
      .filter((transaction) => {
        const createdAt = dateValue(transaction.createdAt);
        return createdAt && createdAt >= reportStart;
      });
    const topupAmount = (transaction: Record<string, unknown>) =>
      transaction.type === "topup" ? Math.max(0, Number(transaction.amount ?? 0)) : 0;
    const todayTopup = transactions
      .filter((transaction) => (dateValue(transaction.createdAt)?.getTime() ?? 0) >= todayStart.getTime())
      .reduce((total, transaction) => total + topupAmount(transaction), 0);
    const monthlyReport = Array.from({ length: 12 }, (_, index) => {
      const date = new Date(new Date().getFullYear(), new Date().getMonth() - 11 + index, 1);
      const next = new Date(date.getFullYear(), date.getMonth() + 1, 1);
      const monthTransactions = transactions.filter((transaction) => {
        const createdAt = dateValue(transaction.createdAt);
        return createdAt && createdAt >= date && createdAt < next;
      });
      return {
        month: date.toISOString().slice(0, 7),
        topup: monthTransactions.reduce((total, transaction) => total + topupAmount(transaction), 0),
        leadPurchases: monthTransactions.filter((transaction) => transaction.type === "lead_purchase").length,
        promoCredits: monthTransactions.filter((transaction) => transaction.type === "admin_promo").reduce((total, transaction) => total + Math.max(0, Number(transaction.amount ?? 0)), 0),
        newUsers: usersSnapshot.docs.filter((user) => {
          const createdAt = dateValue(user.data().createdAt);
          return createdAt && createdAt >= date && createdAt < next;
        }).length,
      };
    });
    const users = await Promise.all(
      usersSnapshot.docs.map(async (item) => {
        const history = await item.ref
          .collection("transactions")
          .orderBy("createdAt", "desc")
          .limit(20)
          .get();
        const user = item.data();
        let authUser;
        try {
          authUser = await auth.getUser(item.id);
        } catch (error) {
          const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
          if (code !== "auth/user-not-found") {
            console.error("Failed to load Firebase Auth profile", { uid: item.id, error });
          }
          authUser = null;
        }
        const displayName =
          authUser?.displayName ||
          user.displayName ||
          user.name ||
          authUser?.email?.split("@")[0] ||
          user.email?.split("@")[0] ||
          `User ${item.id.slice(0, 6)}`;
        if (displayName !== user.displayName || (authUser?.email && authUser.email !== user.email)) {
          await item.ref.set({
            displayName,
            email: authUser?.email || user.email || null,
            updatedAt: new Date(),
          }, { merge: true });
        }
        return {
          uid: item.id,
          email: authUser?.email || user.email || "",
          displayName,
          walletBalance: Number(user.walletBalance ?? 0),
          lastActiveAt: user.lastActiveAt || user.updatedAt || user.createdAt || null,
          createdAt: user.createdAt || null,
          blockedUntil: user.blockedUntil || null,
          permanentlyBlocked: Boolean(user.permanentlyBlocked),
          history: history.docs.map((transaction) => ({
            id: transaction.id,
            ...transaction.data(),
          })),
        };
      }),
    );
    return NextResponse.json({
      settings: {
        welcomeBonus: 10,
        leadPrice: 1,
        ...(settingsSnapshot.data() || {}),
      },
      coupons: couponsSnapshot.docs.map((item) => ({
        id: item.id,
        ...item.data(),
      })),
      leads: leadsSnapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .slice(0, 20),
      popups: popupsSnapshot.docs.map((item) => ({
        id: item.id,
        ...item.data(),
      })),
      contactMessages: contactMessagesSnapshot.docs.map((item) => ({
        id: item.id,
        ...item.data(),
      })),
      stats: {
        leads: leadsSnapshot.size,
        users: usersSnapshot.size,
        coupons: couponsSnapshot.size,
        walletBalance: usersSnapshot.docs.reduce((total, item) => total + Math.max(0, Number(item.data().walletBalance ?? 0)), 0),
        todayTopup,
        activeUsers: usersSnapshot.docs.filter((item) => (dateValue(item.data().lastActiveAt || item.data().updatedAt)?.getTime() ?? 0) >= weekStart).length,
        inactiveWeek: usersSnapshot.docs.filter((item) => {
          const active = dateValue(item.data().lastActiveAt || item.data().updatedAt || item.data().createdAt)?.getTime() ?? 0;
          return active < weekStart;
        }).length,
        inactiveMonth: usersSnapshot.docs.filter((item) => {
          const active = dateValue(item.data().lastActiveAt || item.data().updatedAt || item.data().createdAt)?.getTime() ?? 0;
          return active < monthStart;
        }).length,
      },
      monthlyReport,
      users,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Admin data could not be loaded.";
    return NextResponse.json(
      { error: message },
      { status: message === "Admin access is required." ? 403 : 401 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    const rate = enforceRateLimit(`admin:${admin.uid}`, 120, 60 * 60 * 1000);
    if (!rate.allowed) return NextResponse.json({ error: "Admin request rate limit reached." }, { status: 429 });
    const body = (await request.json()) as AdminAction;
    const { db, messaging } = adminServices();
    const now = new Date();

    if (body.action === "updateSettings") {
      const welcomeBonus = numberValue(body.welcomeBonus, 10);
      const leadPrice = numberValue(body.leadPrice, 1);
      if (welcomeBonus < 0 || leadPrice <= 0)
        throw new Error(
          "Bonus must be 0 or more and lead price must be positive.",
        );
      await db
        .collection("settings")
        .doc("app")
        .set(
          { welcomeBonus, leadPrice, updatedAt: now, updatedBy: admin.email },
          { merge: true },
        );
      return NextResponse.json({
        message: "Settings saved.",
        settings: { welcomeBonus, leadPrice },
      });
    }

    if (body.action === "createCoupon") {
      const code = body.code?.trim().toUpperCase();
      const discountPercent = numberValue(body.discountPercent);
      const creditAmount = numberValue(body.creditAmount);
      const maxUses = numberValue(body.maxUses, 0);
      if (
        !code ||
        !/^[A-Z0-9_-]{3,32}$/.test(code) ||
        (discountPercent <= 0 && creditAmount <= 0) ||
        !Number.isInteger(discountPercent) ||
        !Number.isInteger(creditAmount) ||
        discountPercent > 100 ||
        discountPercent < 0 ||
        creditAmount < 0 ||
        !Number.isInteger(maxUses) ||
        maxUses < 0
      ) {
        throw new Error("Enter a code and a valid discount or credit amount.");
      }
      const ref = await db
        .collection("coupons")
        .add({
          code,
          discountPercent,
          creditAmount,
          maxUses,
          uses: 0,
          active: true,
          createdAt: now,
          createdBy: admin.email,
        });
      return NextResponse.json({ message: "Coupon created.", id: ref.id });
    }

    if (body.action === "toggleCoupon") {
      if (!body.id) throw new Error("Coupon id is required.");
      await db
        .collection("coupons")
        .doc(body.id)
        .update({ active: Boolean(body.active), updatedAt: now });
      return NextResponse.json({ message: "Coupon updated." });
    }

    if (body.action === "createPopup") {
      const title = body.title?.trim();
      const header = body.header?.trim();
      const popupBody = body.body?.trim();
      const type = body.type?.trim();
      if (
        !title ||
        !popupBody ||
        !type ||
        !/^(style-[1-9]|style-10)$/.test(type)
      ) {
        throw new Error(
          "Popup title, message and one of the 10 popup styles are required.",
        );
      }
      const ref = await db.collection("popups").add({
        title,
        header: header || "",
        body: popupBody,
        footer: body.footer?.trim() || "",
        imageUrl: popupImage(body.imageUrl),
        buttonText: text(body.buttonText, 100),
        buttonUrl: popupUrl(body.buttonUrl),
        duration: popupDuration(body.duration),
        backgroundColor: popupColor(body.backgroundColor, "#ffffff"),
        accentColor: popupColor(body.accentColor, "#bbef75"),
        type,
        active: true,
        createdAt: now,
        createdBy: admin.email,
      });
      return NextResponse.json({ message: "Popup sent to users.", id: ref.id });
    }

    if (body.action === "togglePopup") {
      if (!body.id) throw new Error("Popup id is required.");
      await db
        .collection("popups")
        .doc(body.id)
        .update({ active: Boolean(body.active), updatedAt: now });
      return NextResponse.json({ message: "Popup updated." });
    }

    if (body.action === "updatePopup") {
      const title = body.title?.trim();
      const popupBody = body.body?.trim();
      const type = body.type?.trim();
      if (
        !body.id ||
        !title ||
        !popupBody ||
        !type ||
        !/^(style-[1-9]|style-10)$/.test(type)
      ) {
        throw new Error(
          "Popup id, title, message and a valid style are required.",
        );
      }
      await db
        .collection("popups")
        .doc(body.id)
        .update({
          title,
          header: body.header?.trim() || "",
          body: popupBody,
          footer: body.footer?.trim() || "",
          imageUrl: popupImage(body.imageUrl),
          buttonText: text(body.buttonText, 100),
          buttonUrl: popupUrl(body.buttonUrl),
          duration: popupDuration(body.duration),
          backgroundColor: popupColor(body.backgroundColor, "#ffffff"),
          accentColor: popupColor(body.accentColor, "#bbef75"),
          type,
          updatedAt: now,
          updatedBy: admin.email,
        });
      return NextResponse.json({ message: "Popup updated." });
    }

    if (body.action === "deletePopup") {
      if (!body.id) throw new Error("Popup id is required.");
      await db.collection("popups").doc(body.id).delete();
      return NextResponse.json({ message: "Popup deleted." });
    }

    if (body.action === "blockUser") {
      if (!body.uid) throw new Error("User id is required.");
      protectAdminTarget(body.uid, admin.uid);
      const target = await adminServices().auth.getUser(body.uid);
      const allowedEmails = (process.env.ADMIN_EMAILS || "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
      if (target.email && allowedEmails.includes(target.email.toLowerCase())) throw new Error("Admin accounts cannot be blocked here.");
      const update =
        body.mode === "permanent"
          ? { permanentlyBlocked: true, blockedUntil: null }
          : body.mode === "temporary"
            ? {
                permanentlyBlocked: false,
                blockedUntil: (() => {
                  const until = body.until ? new Date(body.until) : new Date(Date.now() + 24 * 60 * 60 * 1000);
                  if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) throw new Error("Temporary block must end in the future.");
                  return until;
                })(),
              }
            : { permanentlyBlocked: false, blockedUntil: null };
      await db
        .collection("users")
        .doc(body.uid)
        .set({ ...update, updatedAt: now }, { merge: true });
      return NextResponse.json({
        message:
          body.mode === "unblock" ? "User unblocked." : "User access updated.",
      });
    }

    if (body.action === "deleteUser") {
      if (!body.uid) throw new Error("User id is required.");
      protectAdminTarget(body.uid, admin.uid);
      const target = await adminServices().auth.getUser(body.uid);
      const allowedEmails = (process.env.ADMIN_EMAILS || "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
      if (target.email && allowedEmails.includes(target.email.toLowerCase())) throw new Error("Admin accounts cannot be deleted here.");
      await db.recursiveDelete(db.collection("users").doc(body.uid));
      await adminServices()
        .auth.deleteUser(body.uid)
        .catch((error: unknown) => {
          const code =
            error && typeof error === "object" && "code" in error
              ? String(error.code)
              : "";
          if (code !== "auth/user-not-found") throw error;
        });
      return NextResponse.json({ message: "User deleted." });
    }

    if (body.action === "promoCredit") {
      const amount = numberValue(body.amount);
      if (!body.uid || !Number.isInteger(amount) || amount <= 0 || amount > 100000)
        throw new Error("Enter a promo amount between ₹1 and ₹100000.");
      const note = text(body.note, 500) || "Admin promotional credit";
      const userRef = db.collection("users").doc(body.uid);
      const transactionRef = userRef
        .collection("transactions")
        .doc(`promo_${Date.now()}`);
      await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(userRef);
        const balance = Number(snapshot.data()?.walletBalance ?? 0) + amount;
        transaction.set(
          userRef,
          { walletBalance: balance, updatedAt: now },
          { merge: true },
        );
        transaction.set(transactionRef, {
          type: "admin_promo",
          amount,
          note,
          createdAt: now,
          createdBy: admin.email,
        });
      });
      return NextResponse.json({ message: "Promo cash added." });
    }

    if (body.action === "createUserPopup") {
      const title = body.title?.trim();
      const popupBody = body.body?.trim();
      const type = body.type?.trim();
      if (
        !body.uid ||
        !title ||
        !popupBody ||
        !type ||
        !/^(style-[1-9]|style-10)$/.test(type)
      )
        throw new Error("User, title, message and a valid style are required.");
      const ref = await db
        .collection("popups")
        .add({
          targetUserId: body.uid,
          title,
          header: body.header?.trim() || "",
          body: popupBody,
          footer: body.footer?.trim() || "",
          imageUrl: popupImage(body.imageUrl),
          buttonText: text(body.buttonText, 100),
          buttonUrl: popupUrl(body.buttonUrl),
          duration: popupDuration(body.duration),
          backgroundColor: popupColor(body.backgroundColor, "#ffffff"),
          accentColor: popupColor(body.accentColor, "#bbef75"),
          type,
          active: true,
          createdAt: now,
          createdBy: admin.email,
        });
      return NextResponse.json({ message: "Personal popup sent.", id: ref.id });
    }

    if (body.action === "sendPushNotification") {
      const title = text(body.title, 120);
      const pushBody = text(body.body, 500);
      if (!title || !pushBody) throw new Error("Notification title and message are required.");
      const imageUrl = body.imageUrl ? popupImage(body.imageUrl) : "";
      const buttonUrl = body.buttonUrl ? popupUrl(body.buttonUrl) : "";
      const userSnapshots = body.uid
        ? [{ id: body.uid }]
        : (await db.collection("users").get()).docs;
      const tokens: string[] = [];
      for (const user of userSnapshots) {
        const tokenSnapshot = await db.collection("users").doc(user.id).collection("pushTokens").get();
        tokenSnapshot.docs.forEach((tokenDoc) => {
          const token = tokenDoc.data().token;
          if (typeof token === "string" && token) tokens.push(token);
        });
      }
      let sent = 0;
      let failed = 0;
      for (let index = 0; index < tokens.length; index += 500) {
        const response = await messaging.sendEachForMulticast({
          tokens: tokens.slice(index, index + 500),
          notification: { title, body: pushBody, ...(imageUrl ? { imageUrl } : {}) },
          data: { url: buttonUrl || "/" },
          webpush: {
            fcmOptions: buttonUrl ? { link: buttonUrl } : undefined,
          },
        });
        sent += response.successCount;
        failed += response.failureCount;
      }
      return NextResponse.json({ message: `Push notification sent to ${sent} device${sent === 1 ? "" : "s"}.`, sent, failed });
    }

    if (body.action === "importLeads") {
      const leads = body.leads
        ?.filter((lead) => lead && typeof lead === "object")
        .slice(0, 500);
      if (!leads?.length) throw new Error("Add at least one lead to import.");
      const batch = db.batch();
      leads.forEach((lead) => {
        const ref = db.collection("leads").doc();
        const source = lead as Record<string, unknown>;
        const imported = Object.fromEntries(
          ["businessName", "name", "phone", "address", "city", "category", "status", "website", "email", "instagram"]
            .filter((key) => source[key] !== undefined)
            .map((key) => [key, text(source[key], 500)]),
        );
        batch.set(ref, { ...imported, importedAt: now, importedBy: admin.email, status: text(source.status, 100) || "imported" });
      });
      await batch.commit();
      return NextResponse.json({ message: `${leads.length} leads imported.` });
    }

    throw new Error("Unknown admin action.");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Admin action failed.";
    const status = message === "Admin access is required." ? 403
      : message === "Missing Firebase authorization token." || message.includes("auth/") ? 401
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
