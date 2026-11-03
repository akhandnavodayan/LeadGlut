import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../../../../lib/api-auth";
import { adminServices } from "../../../../lib/firebase-admin";

const defaults = {
  enabled: false,
  autoContact: false,
  random: false,
  dailyLimit: 10,
  category: "dental clinics",
  city: "Delhi",
};

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const { db } = adminServices();
    const snapshot = await db.collection("users").doc(user.uid).get();
    const data = snapshot.data() || {};
    const today = new Date().toISOString().slice(0, 10);
    return NextResponse.json({
      settings: {
        enabled: data.autoLeadEnabled ?? defaults.enabled,
        autoContact: data.autoLeadAutoContact ?? defaults.autoContact,
        random: data.autoLeadRandom ?? defaults.random,
        dailyLimit: Number(data.autoLeadDailyLimit ?? defaults.dailyLimit),
        category: data.autoLeadCategory || defaults.category,
        city: data.autoLeadCity || defaults.city,
      },
      dailyFound: data.autoLeadDay === today ? Number(data.autoLeadCount ?? 0) : 0,
      dailyContacted: data.contactDay === today ? Number(data.contactCount ?? 0) : 0,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Automation settings could not be loaded." }, { status: 401 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const body = await request.json().catch(() => ({})) as Partial<typeof defaults>;
    const dailyLimit = Number(body.dailyLimit);
    if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 20) {
      return NextResponse.json({ error: "Auto leads are limited to a maximum of 20 per day." }, { status: 400 });
    }
    const category = String(body.category || "").trim();
    const city = String(body.city || "").trim();
    if (!body.random && (!category || !city)) {
      return NextResponse.json({ error: "Enter a category and city, or enable random leads." }, { status: 400 });
    }
    const { db } = adminServices();
    await db.collection("users").doc(user.uid).set({
      autoLeadEnabled: Boolean(body.enabled),
      autoLeadAutoContact: Boolean(body.autoContact),
      autoLeadRandom: Boolean(body.random),
      autoLeadDailyLimit: dailyLimit,
      autoLeadCategory: category || defaults.category,
      autoLeadCity: city || defaults.city,
      updatedAt: new Date(),
    }, { merge: true });
    return NextResponse.json({
      settings: {
        enabled: Boolean(body.enabled),
        autoContact: Boolean(body.enabled) && Boolean(body.autoContact),
        random: Boolean(body.random),
        dailyLimit,
        category: category || defaults.category,
        city: city || defaults.city,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Automation settings could not be saved." }, { status: 400 });
  }
}
