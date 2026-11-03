"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User,
} from "firebase/auth";
import { auth } from "../../lib/firebase";
import { ActionFeedback } from "../../components/ActionFeedback";

function getTimeGreeting(hour = new Date().getHours()) {
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Good night";
}

type AdminData = {
  settings: {
    welcomeBonus: number;
    leadPrice: number;
    maintenance?: {
      fullWebsite: boolean;
      blockLogin: boolean;
      blockDashboard: boolean;
      blockNewUsers: boolean;
      message: string;
    };
  };
  coupons: Array<{
    id: string;
    code: string;
    discountPercent?: number;
    creditAmount?: number;
    uses?: number;
    maxUses?: number;
    active?: boolean;
  }>;
  leads: Array<Record<string, unknown> & { id: string }>;
  stats: {
    leads: number;
    users: number;
    coupons: number;
    walletBalance: number;
    todayTopup: number;
    activeUsers: number;
    inactiveWeek: number;
    inactiveMonth: number;
  };
  monthlyReport: Array<{
    month: string;
    topup: number;
    leadPurchases: number;
    promoCredits: number;
    newUsers: number;
  }>;
  contactMessages: Array<{
    id: string;
    name: string;
    email: string;
    subject: string;
    message: string;
    status?: string;
    createdAt?: unknown;
  }>;
  popups: Array<{
    id: string;
    title: string;
    header?: string;
    body: string;
    footer?: string;
    imageUrl?: string;
    buttonText?: string;
    buttonUrl?: string;
    duration?: number;
    backgroundColor?: string;
    accentColor?: string;
    type: string;
    active?: boolean;
  }>;
  users: Array<{
    uid: string;
    email: string;
    displayName: string;
    walletBalance: number;
    blockedUntil?: unknown;
    permanentlyBlocked?: boolean;
    history: Array<{
      id: string;
      type?: string;
      amount?: number;
      note?: string;
      createdAt?: { seconds?: number };
    }>;
  }>;
};

const emptyData: AdminData = {
  settings: { welcomeBonus: 10, leadPrice: 1 },
  coupons: [],
  leads: [],
  popups: [],
  users: [],
  stats: {
    leads: 0,
    users: 0,
    coupons: 0,
    walletBalance: 0,
    todayTopup: 0,
    activeUsers: 0,
    inactiveWeek: 0,
    inactiveMonth: 0,
  },
  monthlyReport: [],
  contactMessages: [],
};

export default function AdminPage() {
  const [data, setData] = useState<AdminData>(emptyData);
  const [loginError, setLoginError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [importText, setImportText] = useState("");
  const [coupon, setCoupon] = useState({
    code: "",
    discountPercent: "10",
    creditAmount: "0",
    maxUses: "0",
  });
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [popup, setPopup] = useState({
    title: "",
    header: "",
    body: "",
    footer: "",
    imageUrl: "",
    buttonText: "",
    buttonUrl: "",
    duration: 0,
    backgroundColor: "#ffffff",
    accentColor: "#bbef75",
    type: "style-1",
  });
  const [editingPopupId, setEditingPopupId] = useState<string | null>(null);
  const [popupImageName, setPopupImageName] = useState("");
  const [maintenance, setMaintenance] = useState({
    fullWebsite: false,
    blockLogin: false,
    blockDashboard: false,
    blockNewUsers: false,
    message: "We are making a few improvements. Please check back soon.",
  });
  const [selectedUserId, setSelectedUserId] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [promoAmount, setPromoAmount] = useState("10");
  const [promoNote, setPromoNote] = useState("");
  const [userPopup, setUserPopup] = useState({
    title: "",
    header: "",
    body: "",
    footer: "",
    imageUrl: "",
    buttonText: "",
    buttonUrl: "",
    duration: 0,
    backgroundColor: "#ffffff",
    accentColor: "#bbef75",
    type: "style-1",
  });
  const [userPopupImageName, setUserPopupImageName] = useState("");
  const [pushNotification, setPushNotification] = useState({
    title: "",
    body: "",
    imageUrl: "",
    buttonUrl: "",
  });
  const [activeSection, setActiveSection] = useState("users");
  const [userModalTab, setUserModalTab] = useState<
    "access" | "promo" | "popup" | "history"
  >("access");

  const request = async (payload?: Record<string, unknown>, showFeedback = true) => {
    const user = auth.currentUser;
    if (!user) throw new Error("Please sign in as an admin.");
    if (showFeedback && payload) setActionFeedback("loading");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/admin", {
      method: payload ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(payload ? { "Content-Type": "application/json" } : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
      });
      const result = (await response.json()) as AdminData & {
      error?: string;
      message?: string;
      };
      if (!response.ok) throw new Error(result.error || "Admin request failed.");
      if (showFeedback && payload) {
        setActionFeedback("success");
        window.setTimeout(() => setActionFeedback("idle"), 1200);
      }
      return result;
    } catch (error) {
      if (showFeedback && payload) {
        setActionFeedback("error");
        window.setTimeout(() => setActionFeedback("idle"), 1800);
      }
      throw error;
    }
  };

  const loadData = async () => {
    try {
      const loaded = (await request(undefined, false)) as AdminData;
      setData(loaded);
      if (loaded.settings.maintenance)
        setMaintenance(loaded.settings.maintenance);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Admin data could not be loaded.";
      setLoginError(message);
      if (message === "Admin access is required.") {
        await signOut(auth);
        setAuthUser(null);
      }
      return false;
    }
    return true;
  };

  useEffect(() => {
    const section = new URLSearchParams(window.location.search).get("section");
    if (
      section &&
      ["users", "reports", "messages", "maintenance", "wallet", "coupons", "popups", "leads"].includes(
        section,
      )
    )
      setActiveSection(section);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setAuthReady(false);
      if (!user) {
        setAuthUser(null);
        setAuthReady(true);
        return;
      }
      const allowed = await loadData();
      if (allowed) setAuthUser(user);
      setAuthReady(true);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const button = (event.target as HTMLElement).closest("button");
      if (!button || button.disabled) return;
      button.classList.remove("button-click-feedback");
      void button.offsetWidth;
      button.classList.add("button-click-feedback");
      window.setTimeout(
        () => button.classList.remove("button-click-feedback"),
        520,
      );
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setLoginError("");
    setActionFeedback("loading");
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth, provider);
      setLoginError("");
      await loadData();
      setActionFeedback("success");
      window.setTimeout(() => setActionFeedback("idle"), 1200);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
      setLoginError(
        code === "auth/popup-closed-by-user"
          ? "Sign-in was cancelled."
          : error instanceof Error
            ? error.message
            : "Google sign-in failed.",
      );
      setActionFeedback("error");
      window.setTimeout(() => setActionFeedback("idle"), 1800);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");
    try {
      const result = await request({
        action: "updateSettings",
        ...data.settings,
      });
      setData((current) => ({ ...current, settings: result.settings! }));
      setMessage("Settings saved.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Settings could not be saved.",
      );
    }
  };

  const saveMaintenance = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");
    setActionFeedback("loading");
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Please sign in as an admin.");
      const response = await fetch("/api/maintenance", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(maintenance),
      });
      const result = (await response.json()) as {
        maintenance?: typeof maintenance;
        error?: string;
      };
      if (!response.ok)
        throw new Error(
          result.error || "Maintenance settings could not be saved.",
        );
      if (result.maintenance) setMaintenance(result.maintenance);
      setMessage("Maintenance settings saved.");
      setActionFeedback("success");
      window.setTimeout(() => setActionFeedback("idle"), 1200);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Maintenance settings could not be saved.",
      );
      setActionFeedback("error");
      window.setTimeout(() => setActionFeedback("idle"), 1800);
    }
  };

  const userAction = async (
    payload: Record<string, unknown>,
    success: string,
  ) => {
    setMessage("");
    try {
      await request(payload);
      await loadData();
      setMessage(success);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "User action failed.",
      );
    }
  };

  const sendPromo = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await userAction(
      {
        action: "promoCredit",
        uid: selectedUserId,
        amount: Number(promoAmount),
        note: promoNote,
      },
      "Promo cash added.",
    );
    setPromoNote("");
  };

  const sendUserPopup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await userAction(
      { action: "createUserPopup", uid: selectedUserId, ...userPopup },
      "Personal popup sent.",
    );
    setUserPopup({
      title: "",
      header: "",
      body: "",
      footer: "",
      imageUrl: "",
      buttonText: "",
      buttonUrl: "",
      duration: 0,
      backgroundColor: "#ffffff",
      accentColor: "#bbef75",
      type: "style-1",
    });
  };

  const sendPushNotification = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await userAction(
      {
        action: "sendPushNotification",
        ...(selectedUserId ? { uid: selectedUserId } : {}),
        ...pushNotification,
      },
      selectedUserId ? "Push notification sent." : "Push notification broadcast sent.",
    );
    setPushNotification({ title: "", body: "", imageUrl: "", buttonUrl: "" });
  };

  const createCoupon = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");
    try {
      await request({
        action: "createCoupon",
        ...coupon,
        discountPercent: Number(coupon.discountPercent),
        creditAmount: Number(coupon.creditAmount),
        maxUses: Number(coupon.maxUses),
      });
      setCoupon({
        code: "",
        discountPercent: "10",
        creditAmount: "0",
        maxUses: "0",
      });
      await loadData();
      setMessage("Coupon created.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Coupon could not be created.",
      );
    }
  };

  const importLeads = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");
    try {
      const leads = JSON.parse(importText) as Array<Record<string, unknown>>;
      const result = await request({ action: "importLeads", leads });
      setImportText("");
      await loadData();
      setMessage(result.message || "Leads imported.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Paste a valid JSON array of leads.",
      );
    }
  };

  const createPopup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");
    try {
      await request({
        action: editingPopupId ? "updatePopup" : "createPopup",
        ...(editingPopupId ? { id: editingPopupId } : {}),
        ...popup,
      });
      setPopup({
        title: "",
        header: "",
        body: "",
        footer: "",
        imageUrl: "",
        buttonText: "",
        buttonUrl: "",
        duration: 0,
        backgroundColor: "#ffffff",
        accentColor: "#bbef75",
        type: "style-1",
      });
      setPopupImageName("");
      setEditingPopupId(null);
      await loadData();
      setMessage(editingPopupId ? "Popup updated." : "Popup sent to users.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Popup could not be saved.",
      );
    }
  };

  const chooseImage = (file: File | undefined, target: "global" | "user") => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setMessage("Please choose an image file.");
      return;
    }
    if (file.size > 700 * 1024) {
      setMessage("Image must be smaller than 700 KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      if (target === "global") {
        setPopup((current) => ({
          ...current,
          imageUrl: reader.result as string,
        }));
        setPopupImageName(file.name);
      } else {
        setUserPopup((current) => ({
          ...current,
          imageUrl: reader.result as string,
        }));
        setUserPopupImageName(file.name);
      }
    };
    reader.readAsDataURL(file);
  };

  const editPopup = (item: AdminData["popups"][number]) => {
    setEditingPopupId(item.id);
    setPopup({
      title: item.title,
      header: item.header || "",
      body: item.body,
      footer: item.footer || "",
      imageUrl: item.imageUrl || "",
      buttonText: item.buttonText || "",
      buttonUrl: item.buttonUrl || "",
      duration: item.duration || 0,
      backgroundColor: item.backgroundColor || "#ffffff",
      accentColor: item.accentColor || "#bbef75",
      type: item.type,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const deletePopup = async (id: string) => {
    if (!window.confirm("Delete this popup permanently?")) return;
    try {
      await request({ action: "deletePopup", id });
      await loadData();
      setMessage("Popup deleted.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Popup could not be deleted.",
      );
    }
  };

  if (!authReady) {
    return (
      <main className="admin-login">
        <ActionFeedback state={actionFeedback} />
        <div className="admin-login-card">
          <div className="logo">
            <span className="logo-mark">L</span>
            <span>leadglut</span>
          </div>
          <p>Checking admin session...</p>
        </div>
      </main>
    );
  }

  if (!authUser) {
    return (
      <main className="admin-login">
        <ActionFeedback state={actionFeedback} />
        <div className="admin-login-card">
          <div className="logo">
            <span className="logo-mark">L</span>
            <span>leadglut</span>
          </div>
          <span className="panel-kicker">Admin console</span>
          <h1>Manage your growth engine.</h1>
          <p>
            Sign in with an email listed in <code>ADMIN_EMAILS</code>.
          </p>
          <form onSubmit={login}>
            <button className="primary-button full" disabled={loading}>
              {loading ? "Connecting to Google..." : "Continue with Google"} <span>→</span>
            </button>
          </form>
          {loginError && <p className="admin-error">{loginError}</p>}
        </div>
      </main>
    );
  }

  const visibleUsers = data.users.filter((user) =>
    `${user.displayName} ${user.email}`
      .toLowerCase()
      .includes(userSearch.toLowerCase()),
  );
  const selectedUser = data.users.find((user) => user.uid === selectedUserId);
  const openSection = (section: string) => {
    setActiveSection(section);
    window.history.pushState({}, "", `/admin?section=${section}`);
  };

  return (
    <main className="admin-page">
      <ActionFeedback state={actionFeedback} />
      <header className="admin-header">
        <div className="logo">
          <span className="logo-mark">L</span>
          <span>
            leadglut <small>admin</small>
          </span>
        </div>
        <button className="text-button" onClick={() => signOut(auth)}>
          Sign out
        </button>
      </header>
      <div className="admin-content">
        <div className="admin-heading">
          <div>
            <span className="panel-kicker">Control centre</span>
            <h1>{getTimeGreeting()}, admin.</h1>
            <p>
              Manage pricing, rewards, coupons and your lead library from one
              place.
            </p>
          </div>
          <span className="admin-status">● System live</span>
        </div>
        <nav className="admin-section-menu" aria-label="Admin sections">
          {[
            ["users", "Users"],
            ["reports", "Reports"],
            ["messages", "Messages"],
            ["maintenance", "Maintenance"],
            ["wallet", "Wallet & pricing"],
            ["coupons", "Coupons"],
            ["push", "Push notifications"],
            ["popups", "Popups"],
            ["leads", "Lead library"],
          ].map(([section, label]) => (
            <button
              type="button"
              className={activeSection === section ? "active" : ""}
              key={section}
              onClick={() => openSection(section)}
            >
              {label}
            </button>
          ))}
        </nav>
        {message && <div className="admin-message">{message}</div>}
        {loginError && (
          <div className="admin-error admin-message">{loginError}</div>
        )}
        <div className="admin-stats">
          <div>
            <small>Total leads</small>
            <strong>{data.stats.leads}</strong>
          </div>
          <div>
            <small>Users</small>
            <strong>{data.stats.users}</strong>
          </div>
          <div>
            <small>Coupons</small>
            <strong>{data.stats.coupons}</strong>
          </div>
          <div>
            <small>Today&apos;s top-up</small>
            <strong>₹{data.stats.todayTopup.toLocaleString("en-IN")}</strong>
          </div>
          <div>
            <small>Total wallet balance</small>
            <strong>₹{data.stats.walletBalance.toLocaleString("en-IN")}</strong>
          </div>
          <div>
            <small>Active in 7 days</small>
            <strong>{data.stats.activeUsers}</strong>
          </div>
          <div>
            <small>Inactive 7 days</small>
            <strong>{data.stats.inactiveWeek}</strong>
          </div>
          <div>
            <small>Inactive 30 days</small>
            <strong>{data.stats.inactiveMonth}</strong>
          </div>
        </div>
        {activeSection === "push" && (
          <section
            className={
              activeSection === "push"
                ? "admin-card admin-wide"
                : "admin-card admin-wide admin-screen-hidden"
            }
          >
            <span className="panel-kicker">Browser push</span>
            <h2>Send a push notification</h2>
            <p className="admin-help">
              Users must enable notifications from the bell button in their dashboard.
              {selectedUserId ? " The selected user will receive this message." : " Without a selected user, all enabled devices will receive it."}
            </p>
            <form onSubmit={sendPushNotification} className="settings-form">
              <label>
                Notification title
                <input
                  required
                  maxLength={120}
                  value={pushNotification.title}
                  onChange={(event) => setPushNotification({ ...pushNotification, title: event.target.value })}
                />
              </label>
              <label>
                Message
                <textarea
                  required
                  maxLength={500}
                  value={pushNotification.body}
                  onChange={(event) => setPushNotification({ ...pushNotification, body: event.target.value })}
                />
              </label>
              <label>
                Image URL (optional)
                <input
                  type="url"
                  value={pushNotification.imageUrl}
                  onChange={(event) => setPushNotification({ ...pushNotification, imageUrl: event.target.value })}
                />
              </label>
              <label>
                Open link (optional)
                <input
                  type="url"
                  value={pushNotification.buttonUrl}
                  onChange={(event) => setPushNotification({ ...pushNotification, buttonUrl: event.target.value })}
                />
              </label>
              <button className="primary-button" type="submit">
                Send push notification <span>→</span>
              </button>
            </form>
          </section>
        )}
        {activeSection === "reports" && (
          <section className="admin-report-page">
            <div className="admin-report-hero">
              <div>
                <span className="panel-kicker">Analytics centre</span>
                <h2>Business reports</h2>
                <p>Track revenue, user activity and growth from one clear view.</p>
              </div>
              <div className="report-period">Last 12 months</div>
            </div>
            <div className="report-summary-grid">
              <div className="report-summary-card"><small>Today&apos;s top-ups</small><strong>₹{data.stats.todayTopup.toLocaleString("en-IN")}</strong><span>Successful payments today</span></div>
              <div className="report-summary-card"><small>Wallet money</small><strong>₹{data.stats.walletBalance.toLocaleString("en-IN")}</strong><span>Across all user wallets</span></div>
              <div className="report-summary-card"><small>Active users</small><strong>{data.stats.activeUsers}</strong><span>Seen in the last 7 days</span></div>
              <div className="report-summary-card"><small>Monthly top-ups</small><strong>₹{data.monthlyReport.reduce((sum, item) => sum + item.topup, 0).toLocaleString("en-IN")}</strong><span>Rolling 12-month total</span></div>
            </div>
            <div className="report-visual-grid">
              <div className="admin-card report-chart-card">
                <span className="panel-kicker">User activity</span>
                <h3>Engagement split</h3>
                <div className="report-pie-row">
                  <div className="report-pie" style={{ background: `conic-gradient(#82ad63 0 ${(data.stats.activeUsers / Math.max(data.stats.users, 1)) * 100}%, #e8b56b ${(data.stats.activeUsers / Math.max(data.stats.users, 1)) * 100}% ${((data.stats.activeUsers + data.stats.inactiveWeek) / Math.max(data.stats.users, 1)) * 100}%, #d9e2d7 0)` }}><span>{data.stats.users}</span></div>
                  <div className="report-legend"><span><i className="legend-active" /> Active <b>{data.stats.activeUsers}</b></span><span><i className="legend-week" /> Inactive 7d <b>{data.stats.inactiveWeek}</b></span><span><i className="legend-month" /> Inactive 30d <b>{data.stats.inactiveMonth}</b></span></div>
                </div>
              </div>
              <div className="admin-card report-chart-card">
                <span className="panel-kicker">Revenue</span>
                <h3>Top-up performance</h3>
                <div className="report-bars">
                  {data.monthlyReport.map((item) => {
                    const maxTopup = Math.max(...data.monthlyReport.map((entry) => entry.topup), 1);
                    return <div className="report-bar-item" key={item.month}><div className="report-bar-track"><span style={{ height: `${Math.max(4, (item.topup / maxTopup) * 100)}%` }} /></div><small>{new Date(`${item.month}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short" })}</small></div>;
                  })}
                </div>
                <div className="report-chart-total">₹{data.monthlyReport.reduce((sum, item) => sum + item.topup, 0).toLocaleString("en-IN")} <small>total top-ups</small></div>
              </div>
            </div>
            <div className="admin-card admin-report-card">
              <div className="report-table-heading"><div><span className="panel-kicker">Detailed report</span><h3>Monthly business summary</h3></div><span className="report-record-count">{data.monthlyReport.length} months</span></div>
              <div className="admin-report-table-wrap">
                <table className="admin-report-table">
                  <thead><tr><th>Month</th><th>Top-ups</th><th>New users</th><th>Lead purchases</th><th>Promo credits</th></tr></thead>
                  <tbody>{data.monthlyReport.map((report) => <tr key={report.month}><td><strong>{new Date(`${report.month}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</strong></td><td className="report-money">₹{report.topup.toLocaleString("en-IN")}</td><td>{report.newUsers}</td><td>{report.leadPurchases}</td><td>₹{report.promoCredits.toLocaleString("en-IN")}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          </section>
        )}
        {activeSection === "messages" && (
          <section className="admin-card admin-wide contact-messages-card">
            <div className="report-table-heading">
              <div><span className="panel-kicker">Inbox</span><h2>Contact messages</h2><p className="admin-help">Messages submitted from the public contact page.</p></div>
              <span className="report-record-count">{data.contactMessages.length} messages</span>
            </div>
            <div className="contact-message-list">
              {data.contactMessages.map((item) => (
                <article className="contact-message-item" key={item.id}>
                  <div className="contact-message-meta">
                    <div><strong>{item.name}</strong><a href={`mailto:${item.email}`}>{item.email}</a></div>
                    <small>{item.createdAt && typeof item.createdAt === "object" && "seconds" in item.createdAt ? new Date(Number(item.createdAt.seconds) * 1000).toLocaleString("en-IN") : "Recently"}</small>
                  </div>
                  <h3>{item.subject}</h3>
                  <p>{item.message}</p>
                </article>
              ))}
              {!data.contactMessages.length && <p className="admin-help">No contact messages yet.</p>}
            </div>
          </section>
        )}
        <div
          className={
            activeSection === "wallet" || activeSection === "coupons"
              ? "admin-grid"
              : "admin-grid admin-screen-hidden"
          }
        >
          <section
            className={
              activeSection === "wallet"
                ? "admin-card"
                : "admin-card admin-screen-hidden"
            }
            id="wallet"
          >
            <span className="panel-kicker">Revenue rules</span>
            <h2>Wallet settings</h2>
            <form onSubmit={saveSettings}>
              <label>
                Welcome bonus (₹)
                <input
                  type="number"
                  min="0"
                  value={data.settings.welcomeBonus}
                  onChange={(event) =>
                    setData({
                      ...data,
                      settings: {
                        ...data.settings,
                        welcomeBonus: Number(event.target.value),
                      },
                    })
                  }
                />
              </label>
              <label>
                Price per lead (₹)
                <input
                  type="number"
                  min="1"
                  value={data.settings.leadPrice}
                  onChange={(event) =>
                    setData({
                      ...data,
                      settings: {
                        ...data.settings,
                        leadPrice: Number(event.target.value),
                      },
                    })
                  }
                />
              </label>
              <button className="primary-button">
                Save settings <span>→</span>
              </button>
            </form>
          </section>
          <section
            className={
              activeSection === "coupons"
                ? "admin-card"
                : "admin-card admin-screen-hidden"
            }
            id="coupons"
          >
            <span className="panel-kicker">Promotions</span>
            <h2>Create coupon</h2>
            <form onSubmit={createCoupon} className="admin-form-grid">
              <label>
                Code
                <input
                  required
                  value={coupon.code}
                  onChange={(event) =>
                    setCoupon({ ...coupon, code: event.target.value })
                  }
                  placeholder="WELCOME20"
                />
              </label>
              <label>
                Discount %
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={coupon.discountPercent}
                  onChange={(event) =>
                    setCoupon({
                      ...coupon,
                      discountPercent: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                Credit ₹
                <input
                  type="number"
                  min="0"
                  value={coupon.creditAmount}
                  onChange={(event) =>
                    setCoupon({ ...coupon, creditAmount: event.target.value })
                  }
                />
              </label>
              <label>
                Max uses
                <input
                  type="number"
                  min="0"
                  value={coupon.maxUses}
                  onChange={(event) =>
                    setCoupon({ ...coupon, maxUses: event.target.value })
                  }
                />
              </label>
              <button className="primary-button">
                Create coupon <span>→</span>
              </button>
            </form>
          </section>{" "}
        </div>
        <section
          className={
            activeSection === "users"
              ? "admin-card admin-wide user-management-card"
              : "admin-card admin-wide user-management-card admin-screen-hidden"
          }
          id="users"
        >
          <span className="panel-kicker">User management</span>
          <h2>Users and wallet activity</h2>
          <p className="admin-help">
            View email, balance and recent top-up/transaction history. Actions
            apply immediately.
          </p>
          <input
            className="admin-user-search"
            placeholder="Search name or email"
            value={userSearch}
            onChange={(event) => setUserSearch(event.target.value)}
          />
          <div className="admin-user-list">
            {visibleUsers.map((user) => (
              <article className={"admin-user-row"} key={user.uid}>
                <div>
                  <strong>{user.displayName || "Unnamed user"}</strong>
                  <small>{user.email || "Email unavailable"}</small>
                  <small>
                    Balance: ₹{user.walletBalance.toLocaleString("en-IN")} ·{" "}
                    {user.permanentlyBlocked
                      ? "Permanently blocked"
                      : user.blockedUntil
                        ? "Temporarily blocked"
                        : "Active"}
                  </small>
                </div>
                <button
                  type="button"
                  className="text-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setUserModalTab("access");
                    setSelectedUserId(user.uid);
                  }}
                >
                  Manage
                </button>
              </article>
            ))}
            {!visibleUsers.length && (
              <p className="admin-help">No users found.</p>
            )}
          </div>
          {selectedUser && (
            <div
              className="admin-user-modal-backdrop"
              onClick={() => setSelectedUserId("")}
            >
              <div
                className="admin-user-detail"
                role="dialog"
                aria-modal="true"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="admin-user-modal-header">
                  <div className="admin-user-avatar">
                    {(selectedUser.displayName || selectedUser.email || "U")
                      .slice(0, 2)
                      .toUpperCase()}
                  </div>
                  <div>
                    <span className="panel-kicker">User controls</span>
                    <h3>{selectedUser.displayName || "Unnamed user"}</h3>
                    <p className="admin-user-email">
                      {selectedUser.email || "Email unavailable"}
                    </p>
                  </div>
                  <span
                    className={
                      selectedUser.permanentlyBlocked ||
                      selectedUser.blockedUntil
                        ? "admin-user-status blocked"
                        : "admin-user-status"
                    }
                  >
                    {selectedUser.permanentlyBlocked
                      ? "Blocked"
                      : selectedUser.blockedUntil
                        ? "Temp blocked"
                        : "Active"}
                  </span>
                </div>
                <button
                  type="button"
                  className="close-button"
                  onClick={() => setSelectedUserId("")}
                >
                  ×
                </button>
                <div className="admin-user-balance">
                  <span>Current wallet balance</span>
                  <strong>
                    ₹{selectedUser.walletBalance.toLocaleString("en-IN")}
                  </strong>
                </div>
                <nav
                  className="admin-user-tabs"
                  aria-label="User management sections"
                >
                  <button
                    type="button"
                    className={userModalTab === "access" ? "active" : ""}
                    onClick={() => setUserModalTab("access")}
                  >
                    Account access
                  </button>
                  <button
                    type="button"
                    className={userModalTab === "promo" ? "active" : ""}
                    onClick={() => setUserModalTab("promo")}
                  >
                    Promo cash
                  </button>
                  <button
                    type="button"
                    className={userModalTab === "popup" ? "active" : ""}
                    onClick={() => setUserModalTab("popup")}
                  >
                    Personal popup
                  </button>
                  <button
                    type="button"
                    className={userModalTab === "history" ? "active" : ""}
                    onClick={() => setUserModalTab("history")}
                  >
                    Account history
                  </button>
                </nav>
                <div
                  className={
                    userModalTab === "access"
                      ? "admin-tab-panel"
                      : "admin-tab-panel admin-tab-panel-hidden"
                  }
                >
                  <h4 className="admin-modal-section-title">Account access</h4>
                  <div className="admin-user-actions">
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        void userAction(
                          {
                            action: "blockUser",
                            uid: selectedUser.uid,
                            mode: selectedUser.permanentlyBlocked
                              ? "unblock"
                              : "permanent",
                          },
                          selectedUser.permanentlyBlocked
                            ? "User unblocked."
                            : "User permanently blocked.",
                        )
                      }
                    >
                      {selectedUser.permanentlyBlocked
                        ? "Unblock"
                        : "Permanent block"}
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        void userAction(
                          {
                            action: "blockUser",
                            uid: selectedUser.uid,
                            mode: selectedUser.blockedUntil
                              ? "unblock"
                              : "temporary",
                          },
                          selectedUser.blockedUntil
                            ? "User unblocked."
                            : "User temporarily blocked for 24 hours.",
                        )
                      }
                    >
                      {selectedUser.blockedUntil
                        ? "Remove temp block"
                        : "Temp block 24h"}
                    </button>
                    <button
                      type="button"
                      className="coupon-off coupon-action"
                      onClick={() => {
                        if (
                          window.confirm(
                            "Delete this user and their account permanently?",
                          )
                        )
                          void userAction(
                            { action: "deleteUser", uid: selectedUser.uid },
                            "User deleted.",
                          );
                      }}
                    >
                      Delete user
                    </button>
                  </div>
                </div>
                <div
                  className={
                    userModalTab === "promo"
                      ? "admin-tab-panel"
                      : "admin-tab-panel admin-tab-panel-hidden"
                  }
                >
                  <h4 className="admin-modal-section-title">Send promo cash</h4>
                  <form
                    className="admin-form-grid admin-modal-form"
                    onSubmit={sendPromo}
                  >
                    <label>
                      Promo cash (₹)
                      <input
                        type="number"
                        min="1"
                        max="100000"
                        value={promoAmount}
                        onChange={(event) => setPromoAmount(event.target.value)}
                      />
                    </label>
                    <label>
                      Promo note
                      <input
                        value={promoNote}
                        onChange={(event) => setPromoNote(event.target.value)}
                        placeholder="Special offer"
                      />
                    </label>
                    <button className="primary-button">
                      Send promo cash <span>→</span>
                    </button>
                  </form>
                </div>
                <div
                  className={
                    userModalTab === "popup"
                      ? "admin-tab-panel"
                      : "admin-tab-panel admin-tab-panel-hidden"
                  }
                >
                  <h4 className="admin-modal-section-title">
                    Send personal popup
                  </h4>
                  <form
                    className="personal-popup-composer"
                    onSubmit={sendUserPopup}
                  >
                    <div className="personal-popup-intro">
                      <span className="personal-popup-icon">✦</span>
                      <div>
                        <strong>Message this user directly</strong>
                        <small>
                          It will appear the next time they open LeadGlut.
                        </small>
                      </div>
                    </div>
                    <div className="personal-popup-layout">
                      <div className="personal-popup-fields">
                        <label>
                          Choose a look
                          <div className="popup-style-grid">
                            {Array.from({ length: 10 }, (_, index) => (
                              <button
                                type="button"
                                className={
                                  userPopup.type === `style-${index + 1}`
                                    ? "popup-style-option active"
                                    : "popup-style-option"
                                }
                                key={index}
                                onClick={() =>
                                  setUserPopup({
                                    ...userPopup,
                                    type: `style-${index + 1}`,
                                  })
                                }
                              >
                                <span
                                  className={`popup-style-swatch style-${index + 1}`}
                                ></span>
                                <small>{index + 1}</small>
                              </button>
                            ))}
                          </div>
                        </label>
                        <label>
                          Popup title
                          <input
                            required
                            value={userPopup.title}
                            onChange={(event) =>
                              setUserPopup({
                                ...userPopup,
                                title: event.target.value,
                              })
                            }
                            placeholder="A special update for you"
                          />
                        </label>
                        <label>
                          Message
                          <textarea
                            required
                            value={userPopup.body}
                            onChange={(event) =>
                              setUserPopup({
                                ...userPopup,
                                body: event.target.value,
                              })
                            }
                            placeholder="Write a short message..."
                          />
                        </label>
                        <div className="personal-popup-extra-grid">
                          <label>
                            Header{" "}
                            <input
                              value={userPopup.header}
                              onChange={(event) =>
                                setUserPopup({
                                  ...userPopup,
                                  header: event.target.value,
                                })
                              }
                              placeholder="Optional"
                            />
                          </label>
                          <label>
                            Footer{" "}
                            <input
                              value={userPopup.footer}
                              onChange={(event) =>
                                setUserPopup({
                                  ...userPopup,
                                  footer: event.target.value,
                                })
                              }
                              placeholder="Optional"
                            />
                          </label>
                        </div>
                        <label className="image-file-picker">
                          Image file
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(event) =>
                              chooseImage(event.target.files?.[0], "user")
                            }
                          />
                          <small>
                            {userPopupImageName || "Optional · max 700 KB"}
                          </small>
                        </label>
                        <div className="personal-popup-extra-grid">
                          <label>
                            Button text{" "}
                            <input
                              value={userPopup.buttonText}
                              onChange={(event) =>
                                setUserPopup({
                                  ...userPopup,
                                  buttonText: event.target.value,
                                })
                              }
                              placeholder="Optional"
                            />
                          </label>
                          <label>
                            Button URL{" "}
                            <input
                              value={userPopup.buttonUrl}
                              onChange={(event) =>
                                setUserPopup({
                                  ...userPopup,
                                  buttonUrl: event.target.value,
                                })
                              }
                              placeholder="https://..."
                            />
                          </label>
                        </div>
                      </div>
                      <div className="personal-popup-preview">
                        <span className="panel-kicker">Live preview</span>
                        <div
                          className={`personal-preview-card ${userPopup.type}`}
                        >
                          {userPopup.imageUrl && (
                            <img
                              className="broadcast-preview-image"
                              src={userPopup.imageUrl}
                              alt=""
                            />
                          )}
                          <span className="preview-popup-kicker">
                            {userPopup.header || "LeadGlut"}
                          </span>
                          <h5>{userPopup.title || "Your popup title"}</h5>
                          <p>
                            {userPopup.body || "Your message will appear here."}
                          </p>
                          {userPopup.buttonText && (
                            <button type="button">
                              {userPopup.buttonText}
                            </button>
                          )}
                          <small>
                            {userPopup.footer || "Personal message"}
                          </small>
                        </div>
                      </div>
                    </div>
                    <button className="primary-button personal-popup-submit">
                      Send personal popup <span>→</span>
                    </button>
                  </form>
                </div>
                <div
                  className={
                    userModalTab === "history"
                      ? "admin-tab-panel"
                      : "admin-tab-panel admin-tab-panel-hidden"
                  }
                >
                  <h4 className="admin-modal-section-title">
                    Recent account history
                  </h4>
                  <div className="admin-user-history">
                    {selectedUser.history.map((item) => (
                      <div key={item.id}>
                        <strong>{item.type || "Transaction"}</strong>
                        <span>
                          {item.note || ""} · ₹
                          {Number(item.amount || 0).toLocaleString("en-IN")}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
        <section
          className={
            activeSection === "maintenance"
              ? "admin-card admin-wide maintenance-card"
              : "admin-card admin-wide maintenance-card admin-screen-hidden"
          }
          id="maintenance"
        >
          <span className="panel-kicker">Site controls</span>
          <h2>Maintenance mode</h2>
          <p className="admin-help">
            Choose which parts of the site should be temporarily unavailable.
          </p>
          <form onSubmit={saveMaintenance}>
            <label className="toggle-row">
              <span>
                <strong>Full website</strong>
                <small>
                  Show maintenance page instead of the public landing page.
                </small>
              </span>
              <input
                type="checkbox"
                checked={maintenance.fullWebsite}
                onChange={(event) =>
                  setMaintenance({
                    ...maintenance,
                    fullWebsite: event.target.checked,
                  })
                }
              />
            </label>
            <label className="toggle-row">
              <span>
                <strong>Block dashboard</strong>
                <small>
                  Keep landing page available but prevent signed-in users from
                  opening the dashboard.
                </small>
              </span>
              <input
                type="checkbox"
                checked={maintenance.blockDashboard}
                onChange={(event) =>
                  setMaintenance({
                    ...maintenance,
                    blockDashboard: event.target.checked,
                  })
                }
              />
            </label>
            <label className="toggle-row">
              <span>
                <strong>Block login</strong>
                <small>Stop existing users from signing in.</small>
              </span>
              <input
                type="checkbox"
                checked={maintenance.blockLogin}
                onChange={(event) =>
                  setMaintenance({
                    ...maintenance,
                    blockLogin: event.target.checked,
                  })
                }
              />
            </label>
            <label className="toggle-row">
              <span>
                <strong>Block new users</strong>
                <small>
                  Keep existing login available but stop new account creation.
                </small>
              </span>
              <input
                type="checkbox"
                checked={maintenance.blockNewUsers}
                onChange={(event) =>
                  setMaintenance({
                    ...maintenance,
                    blockNewUsers: event.target.checked,
                  })
                }
              />
            </label>
            <label>
              Maintenance message
              <textarea
                value={maintenance.message}
                onChange={(event) =>
                  setMaintenance({
                    ...maintenance,
                    message: event.target.value,
                  })
                }
              />
            </label>
            <button className="primary-button">
              Save maintenance settings <span>→</span>
            </button>
          </form>
        </section>{" "}
        <section
          className={
            activeSection === "popups"
              ? "admin-card admin-wide popup-admin-card"
              : "admin-card admin-wide popup-admin-card admin-screen-hidden"
          }
          id="popups"
        >
          <span className="panel-kicker">Popup broadcaster</span>{" "}
          <h2>{editingPopupId ? "Edit popup" : "Send a popup"}</h2>
          <p className="admin-help">
            Choose one of 10 looks. Image URL, header, footer and button are
            optional.
          </p>
          <form onSubmit={createPopup} className="broadcast-popup-composer">
            <div className="personal-popup-intro">
              <span className="personal-popup-icon">✦</span>
              <div>
                <strong>Broadcast to your users</strong>
                <small>
                  Design the message once and preview it before sending.
                </small>
              </div>
            </div>
            <div className="personal-popup-layout">
              <div className="personal-popup-fields">
                <label>
                  Choose a look
                  <div className="popup-style-grid">
                    {Array.from({ length: 10 }, (_, index) => (
                      <button
                        type="button"
                        className={
                          popup.type === `style-${index + 1}`
                            ? "popup-style-option active"
                            : "popup-style-option"
                        }
                        key={index}
                        onClick={() =>
                          setPopup({ ...popup, type: `style-${index + 1}` })
                        }
                      >
                        <span
                          className={`popup-style-swatch style-${index + 1}`}
                        ></span>
                        <small>{index + 1}</small>
                      </button>
                    ))}
                  </div>
                </label>
                <label>
                  Title
                  <input
                    required
                    value={popup.title}
                    onChange={(event) =>
                      setPopup({ ...popup, title: event.target.value })
                    }
                    placeholder="Important update"
                  />
                </label>
                <label>
                  Header
                  <input
                    value={popup.header}
                    onChange={(event) =>
                      setPopup({ ...popup, header: event.target.value })
                    }
                  />
                </label>
                <label>
                  Footer
                  <input
                    value={popup.footer}
                    onChange={(event) =>
                      setPopup({ ...popup, footer: event.target.value })
                    }
                  />
                </label>
                <div className="image-source-picker">
                  <label>
                    <span>Image URL</span>
                    <input
                      value={
                        popup.imageUrl.startsWith("data:image/")
                          ? ""
                          : popup.imageUrl
                      }
                      onChange={(event) =>
                        setPopup({ ...popup, imageUrl: event.target.value })
                      }
                      placeholder="https://..."
                    />
                  </label>
                  <span className="image-or">OR</span>
                  <label className="image-file-picker">
                    <span>Choose image file</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(event) =>
                        chooseImage(event.target.files?.[0], "global")
                      }
                    />
                    <small>
                      {popupImageName || "PNG, JPG or WebP · max 700 KB"}
                    </small>
                  </label>
                </div>
                <label>
                  Button text
                  <input
                    value={popup.buttonText}
                    onChange={(event) =>
                      setPopup({ ...popup, buttonText: event.target.value })
                    }
                    placeholder="Learn more"
                  />
                </label>
                <label>
                  Button URL
                  <input
                    value={popup.buttonUrl}
                    onChange={(event) =>
                      setPopup({ ...popup, buttonUrl: event.target.value })
                    }
                    placeholder="https://..."
                  />
                </label>
                <div className="notification-style-grid">
                  <label>Auto-close timer (seconds)<input type="number" min="0" max="60" value={popup.duration} onChange={(event) => setPopup({ ...popup, duration: Number(event.target.value) })} /><small>0 keeps it open until dismissed.</small></label>
                  <label>Card colour<input type="color" value={popup.backgroundColor} onChange={(event) => setPopup({ ...popup, backgroundColor: event.target.value })} /></label>
                  <label>Accent colour<input type="color" value={popup.accentColor} onChange={(event) => setPopup({ ...popup, accentColor: event.target.value })} /></label>
                </div>
                <label className="admin-wide-label">
                  Message
                  <textarea
                    required
                    value={popup.body}
                    onChange={(event) =>
                      setPopup({ ...popup, body: event.target.value })
                    }
                  />
                </label>{" "}
                <div className="personal-popup-extra-grid">
                  <label>
                    Button text
                    <input
                      value={popup.buttonText}
                      onChange={(event) =>
                        setPopup({ ...popup, buttonText: event.target.value })
                      }
                      placeholder="Optional"
                    />
                  </label>
                  <label>
                    Button URL
                    <input
                      value={popup.buttonUrl}
                      onChange={(event) =>
                        setPopup({ ...popup, buttonUrl: event.target.value })
                      }
                      placeholder="https://..."
                    />
                  </label>
                </div>
              </div>
              <div className="personal-popup-preview">
                <span className="panel-kicker">Live preview</span>
                <div className={`personal-preview-card ${popup.type}`} style={{ backgroundColor: popup.backgroundColor, borderColor: popup.accentColor }}>
                  {popup.imageUrl && (
                    <img
                      className="broadcast-preview-image"
                      src={popup.imageUrl}
                      alt=""
                    />
                  )}
                  <span className="preview-popup-kicker">
                    {popup.header || "LeadGlut"}
                  </span>
                  <h5>{popup.title || "Your popup title"}</h5>
                  <p>{popup.body || "Your message will appear here."}</p>
                  {popup.buttonText && (
                    <button type="button" style={{ backgroundColor: popup.accentColor }}>{popup.buttonText}</button>
                  )}
                  <small>{popup.footer || "Broadcast message"}</small>
                </div>
              </div>
            </div>
            <div className="broadcast-popup-actions">
              <button className="primary-button">
                {editingPopupId ? "Update popup" : "Send popup"} <span>→</span>
              </button>
              {editingPopupId && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setEditingPopupId(null);
                    setPopup({
                      title: "",
                      header: "",
                      body: "",
                      footer: "",
                      imageUrl: "",
                      buttonText: "",
                      buttonUrl: "",
                      duration: 0,
                      backgroundColor: "#ffffff",
                      accentColor: "#bbef75",
                      type: "style-1",
                    });
                  }}
                >
                  Cancel edit
                </button>
              )}
            </div>
          </form>
        </section>{" "}
        <section
          className={
            activeSection === "popups"
              ? "admin-card admin-wide popup-history-card"
              : "admin-card admin-wide popup-history-card admin-screen-hidden"
          }
          id="popup-history"
        >
          <span className="panel-kicker">Popup history</span>
          <h2>Sent popups</h2>
          <div className="admin-table">
            {data.popups.length ? (
              data.popups.map((item) => (
                <div key={item.id}>
                  <strong>{item.title}</strong>
                  <span>{item.type}</span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => editPopup(item)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="coupon-off coupon-action"
                    onClick={() => void deletePopup(item.id)}
                  >
                    Delete
                  </button>
                </div>
              ))
            ) : (
              <p className="admin-help">No popups sent yet.</p>
            )}
          </div>
        </section>
        <section
          className={
            activeSection === "leads"
              ? "admin-card admin-wide"
              : "admin-card admin-wide admin-screen-hidden"
          }
          id="leads"
        >
          <span className="panel-kicker">Lead library</span>
          <h2>Import leads</h2>
          <p className="admin-help">
            Paste a JSON array with fields like <code>businessName</code>,{" "}
            <code>phone</code>, <code>city</code>, <code>category</code> and{" "}
            <code>website</code>.
          </p>
          <form onSubmit={importLeads}>
            <textarea
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              placeholder={
                '[{"businessName":"Acme Studio","phone":"+91...","city":"Delhi","category":"SaaS"}]'
              }
            />
            <button className="primary-button">
              Import leads <span>→</span>
            </button>
          </form>
        </section>
        <section
          className={
            activeSection === "coupons"
              ? "admin-card admin-wide"
              : "admin-card admin-wide admin-screen-hidden"
          }
        >
          <span className="panel-kicker">Active promotions</span>
          <h2>Coupons</h2>
          <div className="admin-table">
            {data.coupons.length ? (
              data.coupons.map((item) => (
                <div key={item.id}>
                  <strong>{item.code}</strong>
                  <span>
                    {item.creditAmount
                      ? `₹${item.creditAmount} credit`
                      : `${item.discountPercent || 0}% off`}{" "}
                    · {item.uses || 0}/{item.maxUses || "∞"} uses
                  </span>
                  <button
                    type="button"
                    className={
                      item.active
                        ? "coupon-active coupon-action"
                        : "coupon-off coupon-action"
                    }
                    onClick={async () => {
                      try {
                        await request({
                          action: "toggleCoupon",
                          id: item.id,
                          active: !item.active,
                        });
                        await loadData();
                      } catch (error) {
                        setMessage(
                          error instanceof Error
                            ? error.message
                            : "Coupon could not be updated.",
                        );
                      }
                    }}
                  >
                    {item.active ? "Active" : "Off"}
                  </button>
                </div>
              ))
            ) : (
              <p className="admin-help">No coupons created yet.</p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
