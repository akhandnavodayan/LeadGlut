import crypto from "node:crypto";
import dns from "node:dns/promises";
import fs from "node:fs";
import net from "node:net";
import { NextRequest, NextResponse } from "next/server";
import puppeteer, { type Browser } from "puppeteer";
import { requireUser } from "../../../../lib/api-auth";
import { adminServices } from "../../../../lib/firebase-admin";
import { enforceRateLimit } from "../../../../lib/rate-limit";
import { recordSuspiciousActivity } from "../../../../lib/security-activity";

export const runtime = "nodejs";

type Search = { category: string; city: string; limit: number };
type DiscoveryJob = {
  id: string;
  userId: string;
  status: "running" | "complete" | "failed";
  mode: "manual" | "auto" | "configured";
  category: string;
  city: string;
  target: number;
  found: number;
  saved: number;
  warning?: string;
  error?: string;
  startedAt: string;
  finishedAt?: string;
};

const globalState = globalThis as typeof globalThis & {
  __leadDiscoveryJob?: DiscoveryJob;
};

const autoSearches: Array<Omit<Search, "limit">> = [
  { category: "dental clinics", city: "Delhi" },
  { category: "coaching institutes", city: "Mumbai" },
  { category: "real estate agencies", city: "Bengaluru" },
  { category: "gyms and fitness studios", city: "Hyderabad" },
  { category: "salons and spas", city: "Pune" },
  { category: "chartered accountants", city: "Kolkata" },
  { category: "restaurants", city: "Chennai" },
  { category: "interior designers", city: "Ahmedabad" },
  { category: "private schools", city: "Jaipur" },
  { category: "diagnostic laboratories", city: "Lucknow" },
  { category: "law firms", city: "Gurugram" },
  { category: "physiotherapy clinics", city: "Indore" },
];

const clean = (value: unknown) => String(value || "").replace(/\s+/g, " ").trim();
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

function publicUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (!url.hostname || isPrivateHostname(url.hostname)) return "";
    return url.href;
  } catch {
    return "";
  }
}

function isPrivateAddress(address: string) {
  if (net.isIPv4(address)) {
    const [first, second] = address.split(".").map(Number);
    return (
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      first === 0
    );
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith("::ffff:")) {
      const mapped = normalized.slice("::ffff:".length);
      if (net.isIPv4(mapped)) return isPrivateAddress(mapped);
    }
    return (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb")
    );
  }
  return true;
}

function isPrivateHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized === "metadata.google.internal" ||
    net.isIP(normalized) > 0 && isPrivateAddress(normalized)
  );
}

async function isSafePublicUrl(value: string) {
  const url = publicUrl(value);
  if (!url) return false;
  if (isPrivateHostname(new URL(url).hostname)) return false;
  try {
    const addresses = await dns.lookup(new URL(url).hostname, { all: true });
    return addresses.length > 0 && addresses.every(({ address }) => !isPrivateAddress(address));
  } catch {
    return false;
  }
}

function instagramProfile(value: string) {
  try {
    const url = new URL(value);
    if (!/^(www\.)?instagram\.com$/i.test(url.hostname)) return "";
    const handle = url.pathname.split("/").filter(Boolean)[0];
    return handle && !/^(accounts|explore|reels|stories|direct|about)$/i.test(handle)
      ? `https://www.instagram.com/${handle}/`
      : "";
  } catch {
    return "";
  }
}

async function findPublicContacts(browser: Browser, website: string) {
  const url = publicUrl(website);
  if (!url || !(await isSafePublicUrl(url))) return { email: null, instagram: null };
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  try {
    await page.setRequestInterception(true);
    page.on("request", async (request) => {
      if (await isSafePublicUrl(request.url())) {
        await request.continue();
      } else {
        await request.abort("blockedbyclient");
      }
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    const contacts = await page.$$eval("a", (links) => links.map((link) => ({
      href: (link as HTMLAnchorElement).href,
      text: link.textContent || "",
    })));
    const instagram = contacts.map((contact) => contact.href)
      .map(instagramProfile)
      .find(Boolean) || null;
    const email = contacts.map((contact) => contact.href.replace(/^mailto:/i, ""))
      .map((value) => value.match(emailPattern)?.[0] || "")
      .find(Boolean)
      || (await page.evaluate(() => document.body?.innerText || "")).match(emailPattern)?.[0]
      || null;
    return { email, instagram };
  } catch {
    return { email: null, instagram: null };
  } finally {
    await page.close().catch(() => undefined);
  }
}

function getChromePath() {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    process.env.CHROME_EXECUTABLE_PATH || "",
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

function setJob(update: Partial<DiscoveryJob>) {
  if (globalState.__leadDiscoveryJob) {
    globalState.__leadDiscoveryJob = { ...globalState.__leadDiscoveryJob, ...update };
  }
}

function indianMobileNumber(value: unknown) {
  const digits = clean(value).replace(/\D/g, "");
  const mobile = digits.startsWith("91") && digits.length === 12
    ? digits.slice(2)
    : digits.startsWith("0") && digits.length === 11
      ? digits.slice(1)
      : digits;
  return /^[6-9]\d{9}$/.test(mobile) ? mobile : null;
}

async function runSearch(search: Search, job: DiscoveryJob, browser: Browser, leadPrice: number, automation?: { dailyLimit: number; day: string }) {
  const { db } = adminServices();
  const userRef = db.collection("users").doc(job.userId);
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  try {
    await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(`${search.category} in ${search.city}`)}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    const linkSelector = 'a[href*="/maps/place/"], a[href*="/maps?cid="]';
    await page.waitForSelector('a[href*="/maps/place/"], [role="feed"]', { timeout: 25000 });
    const places = new Map<string, string>();
    const candidateLimit = Math.min(100, Math.max(search.limit * 3, search.limit + 10));
    let unchanged = 0;
    for (let attempt = 0; attempt < 45 && places.size < candidateLimit && unchanged < 7; attempt += 1) {
      const links = await page.$$eval(linkSelector, (items) => items.map((item) => ({
        href: (item as HTMLAnchorElement).href,
        label: item.getAttribute("aria-label") || item.textContent || "",
      })));
      const previousSize = places.size;
      for (const link of links) {
        try {
          const url = new URL(link.href);
          if (url.pathname.includes("/maps/place/") || url.searchParams.has("cid")) {
            url.search = "";
            places.set(url.href, clean(link.label));
          }
        } catch {
          // Ignore malformed links returned by Maps.
        }
      }
      unchanged = previousSize === places.size ? unchanged + 1 : 0;
      if (places.size >= candidateLimit) break;
      await page.evaluate(() => {
        const feed = document.querySelector<HTMLElement>('[role="feed"]');
        feed?.scrollBy(0, 900);
        window.scrollBy(0, window.innerHeight);
      });
      await new Promise((resolve) => setTimeout(resolve, 1400));
    }

    for (const [url, label] of [...places.entries()].slice(0, candidateLimit)) {
      if (job.found >= job.target) break;
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
        await new Promise((resolve) => setTimeout(resolve, 900));
        const details = await page.evaluate(() => {
          const text = (selector: string) => document.querySelector<HTMLElement>(selector)?.innerText || "";
          return {
            name: text("h1"),
            phone: text('button[data-item-id^="phone:"], a[href^="tel:"]'),
            address: text('button[data-item-id="address"]'),
            website: document.querySelector<HTMLAnchorElement>('a[data-item-id="authority"]')?.href || "",
            instagram: [...document.querySelectorAll<HTMLAnchorElement>('a[href*="instagram.com"]')].map((link) => link.href)[0] || "",
          };
        });
        const name = clean(details.name) || label;
        if (!name || /^(results|google maps)$/i.test(name)) continue;
        const phone = indianMobileNumber(details.phone);
        if (!phone) continue;
        const websiteContacts = await findPublicContacts(browser, details.website);
        const instagram = websiteContacts.instagram || instagramProfile(details.instagram) || null;
        const email = websiteContacts.email;
        const id = crypto.createHash("sha256").update(`${name.toLowerCase()}|${search.city.toLowerCase()}`).digest("hex");
        const lead = {
          id,
          businessName: name,
          phone,
          address: clean(details.address),
          website: clean(details.website),
          email,
          instagram,
          category: search.category,
          city: search.city,
          source: "google_maps",
          status: "scraped",
          updatedAt: new Date(),
        };
        const ref = db.collection("leads").doc(id);
        const savedRef = userRef.collection("savedLeads").doc(id);
        const transactionResult = await db.runTransaction(async (transaction) => {
          const [existing, saved, user] = await Promise.all([
            transaction.get(ref),
            transaction.get(savedRef),
            transaction.get(userRef),
          ]);
          if (saved.exists) return { found: false, saved: false };
          if (existing.data()?.purchasedBy && existing.data()?.purchasedBy !== job.userId) {
            return { found: false, saved: false };
          }
          const balance = Number(user.data()?.walletBalance ?? 0);
          if (balance < leadPrice) throw new Error(`Wallet balance is insufficient for the next lead (₹${leadPrice}).`);
          if (automation) {
            const count = user.data()?.autoLeadDay === automation.day ? Number(user.data()?.autoLeadCount ?? 0) : 0;
            if (count >= automation.dailyLimit) return { found: false, saved: false };
          }
          const purchasedAt = new Date();
          const savedLead = {
            id,
            name,
            phone,
            work: [search.category, "Public listing"].join(" · "),
            location: clean(details.address) || search.city,
            website: clean(details.website) || null,
            email,
            instagram,
            category: search.category,
            status: "scraped",
            source: "google_maps",
            purchasedAt,
          };
          transaction.set(ref, { ...lead, purchasedBy: job.userId, purchasedAt }, { merge: true });
          transaction.set(savedRef, savedLead);
          transaction.set(userRef, { walletBalance: balance - leadPrice, updatedAt: purchasedAt }, { merge: true });
          if (automation) {
            const count = user.data()?.autoLeadDay === automation.day ? Number(user.data()?.autoLeadCount ?? 0) : 0;
            transaction.set(userRef, { autoLeadDay: automation.day, autoLeadCount: count + 1 }, { merge: true });
          }
          transaction.set(userRef.collection("transactions").doc(`lead_${id}`), {
            type: "lead_purchase",
            amount: -leadPrice,
            leadId: id,
            leadName: name,
            createdAt: purchasedAt,
          });
          return { found: true, saved: true };
        });
        if (!transactionResult.found) continue;
        job.found += 1;
        if (transactionResult.saved) job.saved += 1;
        setJob({ found: job.found, saved: job.saved, category: search.category, city: search.city });
      } catch (error) {
        job.warning = `${job.warning || ""} ${nameForError(error)}`.trim();
        setJob({ warning: job.warning });
      }
    }
    if (places.size === 0) {
      throw new Error(`No business listings were returned for "${search.category} in ${search.city}".`);
    }
  } finally {
    await page.close().catch(() => undefined);
  }
}

function nameForError(error: unknown) {
  return error instanceof Error ? error.message : "A business listing could not be read.";
}

async function runDiscovery(job: DiscoveryJob, searches: Search[], leadPrice: number, automation?: { dailyLimit: number; day: string }) {
  let browser: Browser | undefined;
  try {
    const executablePath = getChromePath();
    browser = await puppeteer.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
      args: ["--disable-gpu"],
    });
    for (const search of searches) {
      if (job.found >= job.target) break;
      await runSearch({ ...search, limit: Math.min(search.limit, job.target - job.found) }, job, browser, leadPrice, automation);
    }
    if (job.found === 0) {
      setJob({
        status: "failed",
        error: job.warning || "No new business leads were found. Try a more specific category and city.",
        finishedAt: new Date().toISOString(),
        found: 0,
        saved: 0,
      });
      return;
    }
    setJob({ status: "complete", finishedAt: new Date().toISOString(), found: job.found, saved: job.saved, warning: job.warning });
  } catch (error) {
    setJob({ status: "failed", error: nameForError(error), finishedAt: new Date().toISOString() });
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const job = globalState.__leadDiscoveryJob;
    return NextResponse.json({ job: job?.userId === user.uid ? job : null });
  } catch (error) {
    return NextResponse.json({ error: nameForError(error) }, { status: 401 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const rate = enforceRateLimit(`discover:${user.uid}`, 6, 60 * 60 * 1000);
    if (!rate.allowed) {
      const activity = await recordSuspiciousActivity(adminServices().db, user.uid, 4, "Repeated lead discovery requests");
      if (activity.blocked) return NextResponse.json({ error: "This account is currently blocked." }, { status: 403 });
      return NextResponse.json(
        { error: "Discovery rate limit reached. Try again later." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfter) } },
      );
    }
    const body = await request.json().catch(() => ({})) as {
      category?: string;
      city?: string;
      limit?: number;
      mode?: "manual" | "auto" | "configured";
    };
    const mode = body.mode === "auto" ? "auto" : body.mode === "configured" ? "configured" : "manual";
    let limit = Number(body.limit);
    const max = mode === "auto" || mode === "configured" ? 1000 : 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > max) {
      return NextResponse.json({ error: `Choose between 1 and ${max} leads.` }, { status: 400 });
    }
    if (globalState.__leadDiscoveryJob?.status === "running") {
      return NextResponse.json({ error: "A lead discovery search is already running." }, { status: 409 });
    }
    if (mode === "manual" && (!body.category?.trim() || !body.city?.trim())) {
      return NextResponse.json({ error: "Enter a business category and city." }, { status: 400 });
    }
    const { db } = adminServices();
    const settingsSnapshot = await db.collection("settings").doc("app").get();
    const configuredLeadPrice = Number(settingsSnapshot.data()?.leadPrice ?? 1);
    const leadPrice = Number.isFinite(configuredLeadPrice) && configuredLeadPrice > 0 ? configuredLeadPrice : 1;
    const userSnapshot = await db.collection("users").doc(user.uid).get();
    const userData = userSnapshot.data() || {};
    const balance = Number(userData.walletBalance ?? 0);
    let searches: Search[];
    let automation: { dailyLimit: number; day: string } | undefined;
    if (mode === "configured") {
      if (userData.autoLeadEnabled !== true) {
        return NextResponse.json({
          error: "Automatic lead finding is disabled. Enable it from Auto leads settings first.",
          code: "AUTOMATION_DISABLED",
        }, { status: 403 });
      }
      const dailyLimit = Math.min(20, Number(userData.autoLeadDailyLimit ?? 10));
      const day = new Date().toISOString().slice(0, 10);
      const dailyFound = userData.autoLeadDay === day ? Number(userData.autoLeadCount ?? 0) : 0;
      const available = Math.min(limit, dailyLimit - dailyFound, Math.floor(balance / leadPrice));
      if (available < 1) {
        return NextResponse.json({ error: dailyFound >= dailyLimit ? "Daily auto-lead limit is already reached." : "Wallet balance is insufficient for auto leads.", code: "AUTOMATION_LIMIT", balance }, { status: 402 });
      }
      const selected = userData.autoLeadRandom
        ? autoSearches[Math.floor(Math.random() * autoSearches.length)]
        : { category: String(userData.autoLeadCategory || "dental clinics"), city: String(userData.autoLeadCity || "Delhi") };
      searches = [{ ...selected, limit: available }];
      automation = { dailyLimit, day };
      limit = available;
    } else {
      searches = mode === "auto"
        ? autoSearches.map((search) => ({ ...search, limit: Math.min(12, limit) }))
        : [{ category: body.category!.trim(), city: body.city!.trim(), limit }];
    }
    if (balance < limit * leadPrice) {
      return NextResponse.json({
        error: `Insufficient balance. ₹${limit * leadPrice} is required for ${limit} leads, but your wallet has ₹${balance}.`,
        code: "INSUFFICIENT_BALANCE",
        balance,
        required: limit * leadPrice,
      }, { status: 402 });
    }
    const job: DiscoveryJob = {
      id: crypto.randomUUID(),
      userId: user.uid,
      status: "running",
      mode,
      category: mode === "auto" ? "Across India" : mode === "configured" ? (userData.autoLeadRandom ? "Random businesses" : String(userData.autoLeadCategory || "Configured category")) : body.category!.trim(),
      city: mode === "auto" ? "Multiple cities" : mode === "configured" ? (userData.autoLeadRandom ? "Random locations" : String(userData.autoLeadCity || "Configured city")) : body.city!.trim(),
      target: limit,
      found: 0,
      saved: 0,
      startedAt: new Date().toISOString(),
    };
    globalState.__leadDiscoveryJob = job;
    void runDiscovery(job, searches, leadPrice, automation);
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: nameForError(error) }, { status: 401 });
  }
}
