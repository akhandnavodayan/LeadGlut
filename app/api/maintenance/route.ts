import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../lib/api-auth";
import { adminServices } from "../../../lib/firebase-admin";

export type MaintenanceSettings = {
  fullWebsite: boolean;
  blockLogin: boolean;
  blockDashboard: boolean;
  blockNewUsers: boolean;
  message: string;
};

const defaults: MaintenanceSettings = {
  fullWebsite: false,
  blockLogin: false,
  blockDashboard: false,
  blockNewUsers: false,
  message: "We are making a few improvements. Please check back soon.",
};

export async function GET() {
  try {
    const { db } = adminServices();
    const data = (await db.collection("settings").doc("app").get()).data() || {};
    return NextResponse.json({ maintenance: { ...defaults, ...(data.maintenance || {}) } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Maintenance status could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    const body = await request.json() as Partial<MaintenanceSettings>;
    const maintenance = {
      fullWebsite: Boolean(body.fullWebsite),
      blockLogin: Boolean(body.blockLogin),
      blockDashboard: Boolean(body.blockDashboard),
      blockNewUsers: Boolean(body.blockNewUsers),
      message: String(body.message || defaults.message).trim().slice(0, 300) || defaults.message,
    };
    const { db } = adminServices();
    await db.collection("settings").doc("app").set({ maintenance, updatedAt: new Date(), updatedBy: admin.email }, { merge: true });
    return NextResponse.json({ message: "Maintenance settings saved.", maintenance });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Maintenance settings could not be saved.";
    return NextResponse.json({ error: message }, { status: message === "Admin access is required." ? 403 : 400 });
  }
}
