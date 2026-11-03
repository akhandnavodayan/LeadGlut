import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "../../../lib/api-auth";
import { adminServices } from "../../../lib/firebase-admin";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const { db } = adminServices();
    if (request.nextUrl.searchParams.get("saved") === "1") {
      const savedSnapshot = await db.collection("users").doc(user.uid).collection("savedLeads").limit(250).get();
      return NextResponse.json({
        leads: savedSnapshot.docs.map((document) => {
          const lead = document.data() as Record<string, any>;
          return {
            id: document.id,
            name: lead.name || lead.businessName || "Unnamed business",
            phone: null,
            work: lead.work || [lead.category, lead.status].filter(Boolean).join(" · ") || "Business lead",
            location: lead.location || lead.city || lead.address || "India",
            website: lead.website || null,
            email: lead.email || null,
            instagram: lead.instagram || null,
            category: lead.category || null,
            status: lead.status || null,
            contactedAt: lead.contactedAt || null,
          };
        }),
      });
    }
    const snapshot = await db.collection("leads").limit(250).get();
    const leads = snapshot.docs
      .map((document) => ({ id: document.id, ...document.data() } as Record<string, any>))
      .filter((lead) => !lead.purchasedBy)
      .map((lead) => ({
        id: lead.id,
        name: lead.businessName || lead.name || "Unnamed business",
        phone: lead.phone || null,
        category: lead.category || null,
        status: lead.status || null,
        work: [lead.category, lead.status].filter(Boolean).join(" · ") || "Business lead",
        location: lead.city || lead.address || "India",
        website: null,
        email: null,
        instagram: null,
        contactedAt: lead.contactedAt || null,
      }));
    return NextResponse.json({ leads });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Leads could not be loaded.";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
