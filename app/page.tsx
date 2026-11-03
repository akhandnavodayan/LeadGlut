"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Script from "next/script";
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  reload,
  setPersistence,
  signInWithPopup,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
} from "firebase/auth";
import { auth } from "../lib/firebase";
import { OverviewPage } from "../components/pages/OverviewPage";
import { FindLeadsPage } from "../components/pages/FindLeadsPage";
import { SavedLeadsPage } from "../components/pages/SavedLeadsPage";
import { WalletPage } from "../components/pages/WalletPage";
import { SettingsPage } from "../components/pages/SettingsPage";
import { LandingPage } from "../components/pages/LandingPage";
import { AutoShowcase } from "../components/pages/AutoShowcase";
import { ActionFeedback } from "../components/ActionFeedback";
import { registerPushNotifications } from "../lib/push-notifications";
import { sendCustomAuthEmail } from "../lib/custom-auth-email";
import { fetchWhatsAppStatus } from "../lib/whatsapp-api";

type View = "landing" | "dashboard";
type Lead = {
  id: string;
  name: string;
  phone?: string | null;
  work?: string;
  location?: string;
  website?: string | null;
  email?: string | null;
  instagram?: string | null;
  category?: string;
  status?: string;
  contactedAt?: unknown;
};
type Popup = {
  id: string;
  type: string;
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
};
type AutoLeadSettings = {
  enabled: boolean;
  autoContact: boolean;
  random: boolean;
  dailyLimit: number;
  category: string;
  city: string;
};
type MaintenanceSettings = {
  fullWebsite: boolean;
  blockLogin: boolean;
  blockDashboard: boolean;
  blockNewUsers: boolean;
  message: string;
};
type DiscoveryJob = {
  status: "running" | "complete" | "failed";
  mode: "manual" | "auto";
  category: string;
  city: string;
  target: number;
  found: number;
  saved: number;
  error?: string;
  warning?: string;
};

const WHATSAPP_SIGNATURE = "Powered by LeadGlut";
const DEFAULT_WHATSAPP_TEMPLATE =
  "Hi <Name>, I would love to connect and understand how we can help <B_Name> in <Location>.";

function removeLegacyAttribution(template: string) {
  return template
    .replace(/I found your profile through LeadGlut\.?/gi, "")
    .replace(/Powered by LeadGlut\.?/gi, "")
    .trim();
}

function renderWhatsAppTemplate(template: string, lead: Lead) {
  const values: Record<string, string> = {
    Number: lead.phone || "",
    Name: lead.name,
    B_Name: lead.name,
    Location: lead.location || "",
    Loacatio: lead.location || "",
  };
  const message = removeLegacyAttribution(template).replace(
    /<(Number|Name|B_Name|Location|Loacatio)>/g,
    (_, key: string) => values[key] ?? "",
  );
  return `${message}${message ? "\n\n" : ""}${WHATSAPP_SIGNATURE}`;
}

type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  handler: (response: {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  }) => void;
  theme: { color: string };
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open: () => void };
  }
}

const navItems = ["Overview", "Find leads", "Saved leads", "Wallet"];

function historyLabel(type: string) {
  if (type === "welcome_bonus") return "Welcome bonus";
  if (type === "coupon") return "Coupon credit";
  if (type === "lead_purchase") return "Lead purchased";
  return "Wallet top-up";
}

function getTimeGreeting(hour = new Date().getHours()) {
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Good night";
}

function Logo() {
  return (
    <div className="logo" aria-label="LeadGlut home">
      <span className="logo-mark">L</span>
      <span>leadglut</span>
    </div>
  );
}

export default function Home() {
  const [view, setView] = useState<View>("landing");
  const [authReady, setAuthReady] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<
    "signin" | "signup" | "reset" | "verify"
  >("signup");
  const [activeNav, setActiveNav] = useState("Overview");
  const [leadCount, setLeadCount] = useState(25);
  const [balance, setBalance] = useState(0);
  const [walletReady, setWalletReady] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [userName, setUserName] = useState("Akhand");
  const [authError, setAuthError] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [blockedAccount, setBlockedAccount] = useState<{ permanent: boolean; until: string | null } | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState(500);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponMessage, setCouponMessage] = useState("");
  const [couponApplied, setCouponApplied] = useState(false);
  const [walletHistory, setWalletHistory] = useState<
    Array<{
      type: string;
      amount: number;
      leadName?: string;
      createdAt?: { seconds?: number };
    }>
  >([]);
  const [whatsappLead, setWhatsappLead] = useState<string | null>(null);
  const [whatsappConnected, setWhatsappConnected] = useState(false);
  const [whatsappStatusReady, setWhatsappStatusReady] = useState(false);
  const [whatsappConnectOpen, setWhatsappConnectOpen] = useState(false);
  const [contactedLeads, setContactedLeads] = useState<string[]>([]);
  const [whatsappQr, setWhatsappQr] = useState<string | null>(null);
  const [whatsappState, setWhatsappState] = useState("disconnected");
  const [whatsappError, setWhatsappError] = useState("");
  const [contactingLead, setContactingLead] = useState<string | null>(null);
  const [whatsappConnecting, setWhatsappConnecting] = useState(false);
  const [instagramConnectOpen, setInstagramConnectOpen] = useState(false);
  const [whatsappTemplate, setWhatsappTemplate] = useState(
    DEFAULT_WHATSAPP_TEMPLATE,
  );
  const [settingsMessage, setSettingsMessage] = useState("");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [savedLeads, setSavedLeads] = useState<Lead[]>([]);
  const [unlockingLeadId, setUnlockingLeadId] = useState<string | null>(null);
  const [unlockedLeadIds, setUnlockedLeadIds] = useState<string[]>([]);
  const [leadSearch, setLeadSearch] = useState("");
  const [leadCategory, setLeadCategory] = useState("All industries");
  const [leadLocation, setLeadLocation] = useState("All locations");
  const [discoveryCategory, setDiscoveryCategory] = useState("");
  const [discoveryCity, setDiscoveryCity] = useState("");
  const [discoveryLimit, setDiscoveryLimit] = useState(20);
  const [discoveryJob, setDiscoveryJob] = useState<DiscoveryJob | null>(null);
  const [discoveryStarting, setDiscoveryStarting] = useState<
    "manual" | "auto" | "configured" | null
  >(null);
  const [discoveryError, setDiscoveryError] = useState("");
  const [toast, setToast] = useState("");
  const [actionFeedback, setActionFeedback] = useState<"idle" | "loading" | "success" | "error">("idle");
  const actionBusy = Boolean(authLoading || paymentLoading || couponLoading || discoveryStarting || contactingLead || unlockingLeadId || whatsappConnecting);
  const previousActionBusy = useRef(false);
  useEffect(() => {
    if (actionBusy && !previousActionBusy.current) setActionFeedback("loading");
    if (!actionBusy && previousActionBusy.current) {
      setActionFeedback("success");
      window.setTimeout(() => setActionFeedback("idle"), 1200);
    }
    previousActionBusy.current = actionBusy;
  }, [actionBusy]);
  const [popup, setPopup] = useState<Popup | null>(null);
  const [pushMessage, setPushMessage] = useState("");
  const [autoLeadSettings, setAutoLeadSettings] = useState<AutoLeadSettings>({
    enabled: false,
    autoContact: false,
    random: false,
    dailyLimit: 10,
    category: "dental clinics",
    city: "Delhi",
  });
  const [autoLeadModalOpen, setAutoLeadModalOpen] = useState(false);
  const [autoLeadSaving, setAutoLeadSaving] = useState(false);
  const [autoLeadError, setAutoLeadError] = useState("");
  const [maintenance, setMaintenance] = useState<MaintenanceSettings>({
    fullWebsite: false,
    blockLogin: false,
    blockDashboard: false,
    blockNewUsers: false,
    message: "We are making a few improvements. Please check back soon.",
  });
  const [maintenanceNoticeOpen, setMaintenanceNoticeOpen] = useState(false);
  const [autoLeadDailyFound, setAutoLeadDailyFound] = useState(0);
  const [autoContactDailyCount, setAutoContactDailyCount] = useState(0);
  const pendingVerificationRef = useRef(false);
  const autoContactScheduledRef = useRef(new Set<string>());
  const autoContactDailyRef = useRef({ day: "", count: 0 });
  const autoDiscoveryRunningRef = useRef(false);

  useEffect(() => {
    const savedNav = window.localStorage.getItem("leadglut-active-nav");
    if (savedNav && [...navItems, "Settings"].includes(savedNav))
      setActiveNav(savedNav);
    let unsubscribe = () => {};
    void setPersistence(auth, browserLocalPersistence)
      .then(() => {
        unsubscribe = onAuthStateChanged(auth, async (user) => {
          let maintenanceConfig = maintenance;
          try {
            const maintenanceResponse = await fetch("/api/maintenance", {
              cache: "no-store",
            });
            if (maintenanceResponse.ok) {
              maintenanceConfig = (
                (await maintenanceResponse.json()) as {
                  maintenance: MaintenanceSettings;
                }
              ).maintenance;
              setMaintenance(maintenanceConfig);
            }
          } catch {
            // Keep the public page available if maintenance status is temporarily unavailable.
          }
          if (user) {
            const isPasswordUser = user.providerData.some(
              (provider) => provider.providerId === "password",
            );
            if (
              pendingVerificationRef.current ||
              (isPasswordUser && !user.emailVerified)
            ) {
              setView("landing");
              setAuthReady(true);
              setAuthOpen(true);
              setAuthMode("verify");
              if (!authMessage) {
                setAuthMessage("Please verify your email before continuing.");
              }
              return;
            }
            const name =
              user.displayName || user.email?.split("@")[0] || "Akhand";
            setUserName(name);
            if (
              maintenanceConfig.fullWebsite ||
              maintenanceConfig.blockDashboard
            ) {
              setView("landing");
              setAuthReady(true);
              return;
            }
            const accountResponse = await fetch("/api/account/status", {
              headers: { Authorization: `Bearer ${await user.getIdToken()}` },
              cache: "no-store",
            });
            if (accountResponse.ok) {
              const accountStatus = (await accountResponse.json()) as {
                blocked?: boolean;
                permanentlyBlocked?: boolean;
                blockedUntil?: string | null;
                isAdmin?: boolean;
              };
              if (accountStatus.isAdmin) {
                await firebaseSignOut(auth);
                setAuthError("This admin account can only access the admin panel.");
                setView("landing");
                setAuthReady(true);
                return;
              }
              if (accountStatus.blocked) {
                setBlockedAccount({
                  permanent: Boolean(accountStatus.permanentlyBlocked),
                  until: accountStatus.blockedUntil || null,
                });
                setView("landing");
                setAuthReady(true);
                return;
              }
            } else if (accountResponse.status === 401) {
              await firebaseSignOut(auth);
              setAuthError("Your session has expired. Please sign in again.");
              setView("landing");
              setAuthReady(true);
              return;
            }
            try {
              const token = await user.getIdToken();
              const response = await fetch("/api/wallet/initialize", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
              });
              if (response.ok) {
                const wallet = (await response.json()) as {
                  balance: number;
                  history?: Array<{
                    type: string;
                    amount: number;
                    createdAt?: { seconds?: number };
                  }>;
                };
                setBalance(wallet.balance);
                setWalletHistory(wallet.history ?? []);
              }
              const leadHeaders = { Authorization: `Bearer ${token}` };
              const [leadsResponse, savedResponse] = await Promise.all([
                fetch("/api/leads", { headers: leadHeaders }),
                fetch("/api/leads?saved=1", { headers: leadHeaders }),
              ]);
              if (leadsResponse.ok)
                setLeads(
                  ((await leadsResponse.json()) as { leads?: Lead[] }).leads ??
                    [],
                );
              if (savedResponse.ok) {
                const saved = (
                  (await savedResponse.json()) as { leads?: Lead[] }
                ).leads ?? [];
                setSavedLeads(saved);
                setContactedLeads((current) => [
                  ...new Set([
                    ...current,
                    ...saved
                      .filter((lead) => Boolean(lead.contactedAt))
                      .map((lead) => lead.name),
                  ]),
                ]);
              }
              try {
                const whatsapp = await fetchWhatsAppStatus({ restore: true });
                const ready = whatsapp.state === "ready";
                setWhatsappState(whatsapp.state || "disconnected");
                setWhatsappConnected(ready);
                setWhatsappStatusReady(true);
                if (whatsapp.error) setWhatsappError(whatsapp.error);
              } catch (error) {
                setWhatsappError(
                  error instanceof Error
                    ? error.message
                    : "WhatsApp status could not be loaded.",
                );
              }
            } catch {
              setPaymentError("Wallet data could not be loaded.");
            } finally {
              setWalletReady(true);
              setWhatsappStatusReady(true);
            }
            setView("dashboard");
            setAuthReady(true);
          } else {
            setView("landing");
            setAuthReady(true);
          }
        });
      })
      .catch(() => {
        setAuthError("Firebase authentication could not be initialized.");
        setAuthReady(true);
      });
    const savedContacted = window.localStorage.getItem(
      "leadglut-contacted-leads",
    );
    if (savedContacted)
      setContactedLeads(JSON.parse(savedContacted) as string[]);
    const savedWhatsAppSettings = window.localStorage.getItem(
      "leadglut-whatsapp-settings",
    );
    if (savedWhatsAppSettings) {
      try {
        const settings = JSON.parse(savedWhatsAppSettings) as {
          template?: string;
        };
        if (settings.template)
          setWhatsappTemplate(removeLegacyAttribution(settings.template));
      } catch {
        window.localStorage.removeItem("leadglut-whatsapp-settings");
      }
    }
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (view !== "dashboard" || !auth.currentUser) return;
    const checkAccount = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;
        const response = await fetch("/api/account/status", {
          headers: { Authorization: `****** user.getIdToken()}` },
          cache: "no-store",
        });
        if (!response.ok) return;
        const status = (await response.json()) as {
          blocked?: boolean;
          permanentlyBlocked?: boolean;
          blockedUntil?: string | null;
        };
        if (status.blocked) {
          setBlockedAccount({
            permanent: Boolean(status.permanentlyBlocked),
            until: status.blockedUntil || null,
          });
          setView("landing");
        }
      } catch {
        // A temporary status check failure should not interrupt the dashboard.
      }
    };
    const timer = window.setInterval(() => void checkAccount(), 30_000);
    return () => window.clearInterval(timer);
  }, [view]);

  const changeSection = (section: string) => {
    setActiveNav(section);
    window.localStorage.setItem("leadglut-active-nav", section);
  };

  const openHelp = () => {
    window.location.href = "/contact";
  };

  const focusLeadSearch = () => {
    changeSection("Find leads");
    window.setTimeout(() => {
      document.getElementById("lead-search-input")?.focus();
    }, 0);
  };

  const openProfile = () => {
    changeSection("Settings");
  };

  useEffect(() => {
    if (view !== "dashboard") return;
    let active = true;
    const syncWhatsAppStatus = async () => {
      try {
        if (!auth.currentUser) return;
        const data = await fetchWhatsAppStatus({ restore: true });
        if (!active) return;
        const ready = data.state === "ready";
        setWhatsappState(data.state || "disconnected");
        if (data.error) setWhatsappError(data.error);
        setWhatsappConnected(ready);
        setWhatsappStatusReady(true);
        if (ready) {
          window.localStorage.setItem("leadglut-whatsapp-connected", "true");
        } else {
          window.localStorage.removeItem("leadglut-whatsapp-connected");
        }
      } catch (error) {
        if (active) {
          setWhatsappStatusReady(true);
          setWhatsappError(
            error instanceof Error
              ? error.message
              : "WhatsApp status could not be loaded.",
          );
        }
      }
    };
    void syncWhatsAppStatus();
    const timer = window.setInterval(() => void syncWhatsAppStatus(), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [view]);

  useEffect(() => {
    if (!popup?.duration) return;
    const timer = window.setTimeout(() => void dismissPopup(), popup.duration * 1000);
    return () => window.clearTimeout(timer);
  }, [popup]);

  useEffect(() => {
    if (view !== "dashboard") return;
    const loadAutomation = async () => {
      const user = auth.currentUser;
      if (!user) return;
      try {
        const token = await user.getIdToken();
        const response = await fetch("/api/leads/automation", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (response.ok) {
          const result = (await response.json()) as {
            settings: AutoLeadSettings;
            dailyFound?: number;
            dailyContacted?: number;
          };
          setAutoLeadSettings(result.settings);
          setAutoLeadDailyFound(Number(result.dailyFound ?? 0));
          const dailyContacted = Number(result.dailyContacted ?? 0);
          setAutoContactDailyCount(dailyContacted);
          autoContactDailyRef.current = {
            day: new Date().toISOString().slice(0, 10),
            count: dailyContacted,
          };
        }
      } catch {
        setAutoLeadError("Auto leads settings could not be loaded.");
      }
    };
    void loadAutomation();
    const timer = window.setInterval(() => void loadAutomation(), 60 * 1000);
    return () => window.clearInterval(timer);
  }, [view]);

  const saveAutoLeadSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAutoLeadSaving(true);
    setAutoLeadError("");
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Please sign in again.");
      const token = await user.getIdToken();
      const response = await fetch("/api/leads/automation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(autoLeadSettings),
      });
      const result = (await response.json()) as {
        settings?: AutoLeadSettings;
        error?: string;
      };
      if (!response.ok)
        throw new Error(
          result.error || "Auto leads settings could not be saved.",
        );
      if (result.settings) {
        setAutoLeadSettings(result.settings);
        if (!result.settings.enabled) setAutoLeadDailyFound(0);
      }
      setAutoLeadModalOpen(false);
    } catch (error) {
      setAutoLeadError(
        error instanceof Error
          ? error.message
          : "Auto leads settings could not be saved.",
      );
    } finally {
      setAutoLeadSaving(false);
    }
  };

  useEffect(() => {
    if (view !== "dashboard") return;
    let active = true;
    const loadPopup = async () => {
      const user = auth.currentUser;
      if (!user) return;
      try {
        const token = await user.getIdToken();
        const response = await fetch("/api/popup", {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) return;
        const result = (await response.json()) as { popup?: Popup | null };
        if (active && result.popup) setPopup(result.popup);
      } catch {
        // Popup delivery should not block the dashboard.
      }
    };
    void loadPopup();
    return () => {
      active = false;
    };
  }, [view]);

  const dismissPopup = async () => {
    if (!popup) return;
    const current = popup;
    setPopup(null);
    try {
      const user = auth.currentUser;
      if (user) {
        const token = await user.getIdToken();
        await fetch("/api/popup", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ popupId: current.id }),
        });
      }
    } catch {
      // The popup is already closed locally; it may appear again on a later visit.
    }
  };

  const enablePushNotifications = async () => {
    try {
      await registerPushNotifications();
      setPushMessage("Notifications enabled on this device.");
    } catch (error) {
      setPushMessage(error instanceof Error ? error.message : "Could not enable notifications.");
    }
    window.setTimeout(() => setPushMessage(""), 3500);
  };

  const openAuth = (mode: "signin" | "signup") => {
    if (
      maintenance.fullWebsite ||
      maintenance.blockLogin ||
      (mode === "signup" && maintenance.blockNewUsers)
    ) {
      setAuthError(maintenance.message);
      setAuthOpen(false);
      setMaintenanceNoticeOpen(true);
      return;
    }
    pendingVerificationRef.current = false;
    setAuthMode(mode);
    setAuthError("");
    setAuthMessage("");
    setAuthOpen(true);
  };

  const enterApp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthLoading(true);
    setAuthError("");
    setAuthMessage("");

    try {
      if (
        maintenance.fullWebsite ||
        maintenance.blockLogin ||
        (authMode === "signup" && maintenance.blockNewUsers)
      ) {
        throw new Error(maintenance.message);
      }
      if (authMode === "reset") {
        const result = await sendCustomAuthEmail(authEmail, "reset");
        setAuthMessage(result.message || "If an account exists for that email, a password reset link is on its way. Check your inbox and spam folder.");
        return;
      }

      if (authMode === "verify") {
        const user = auth.currentUser;
        if (!user) {
          setAuthError("Please sign in again to verify your email.");
          setAuthMode("signin");
          return;
        }
        await reload(user);
        if (!user.emailVerified) {
          setAuthError(
            "Your email is not verified yet. Open the link from your inbox, then try again.",
          );
          return;
        }
        pendingVerificationRef.current = false;
        window.location.reload();
        return;
      }

      setAuthReady(false);
      const credential =
        authMode === "signup"
          ? await createUserWithEmailAndPassword(auth, authEmail, authPassword)
          : await signInWithEmailAndPassword(auth, authEmail, authPassword);
      const roleResponse = await fetch("/api/account/status", {
        headers: { Authorization: `****** credential.user.getIdToken()}` },
        cache: "no-store",
      });
      if (roleResponse.ok && (await roleResponse.json() as { isAdmin?: boolean }).isAdmin) {
        await firebaseSignOut(auth);
        throw new Error("This admin account can only access the admin panel.");
      }
      if (authMode === "signup" && fullName.trim()) {
        await updateProfile(credential.user, { displayName: fullName.trim() });
      }

      if (
        credential.user.providerData.some(
          (provider) => provider.providerId === "password",
        ) &&
        !credential.user.emailVerified
      ) {
        pendingVerificationRef.current = true;
        await sendCustomAuthEmail(credential.user.email ?? authEmail, "verify");
        setAuthMode("verify");
        setAuthMessage(
          `We sent a verification link to ${credential.user.email ?? authEmail}.`,
        );
        setAuthReady(true);
        setView("landing");
        return;
      }

      pendingVerificationRef.current = false;
      setUserName(
        credential.user.displayName ||
          credential.user.email?.split("@")[0] ||
          "Akhand",
      );
      setAuthOpen(false);
    } catch (error) {
      const code =
        error instanceof Error && "code" in error ? String(error.code) : "";
      const messages: Record<string, string> = {
        "auth/email-already-in-use":
          "This email is already registered. Try signing in.",
        "auth/invalid-credential": "Email or password is incorrect.",
        "auth/invalid-email": "Enter a valid email address.",
        "auth/weak-password": "Use a password with at least 6 characters.",
        "auth/too-many-requests": "Too many attempts. Please try again later.",
        "auth/user-not-found": "No account exists for this email.",
        "auth/operation-not-allowed":
          "This sign-in method is disabled in Firebase Authentication.",
        "auth/popup-closed-by-user": "Google sign-in was cancelled.",
        "auth/popup-blocked": "Your browser blocked the Google sign-in popup.",
        "auth/account-exists-with-different-credential":
          "An account already exists with another sign-in method.",
      };
      setAuthError(
        (authMode === "reset" || authMode === "signup") && error instanceof Error && !code
          ? error.message
          : messages[code] || "Authentication failed. Please check your details.",
      );
      setAuthReady(true);
      setView("landing");
    } finally {
      setAuthLoading(false);
    }
  };

  const signInWithGoogle = async () => {
    if (
      maintenance.fullWebsite ||
      maintenance.blockLogin ||
      (authMode === "signup" && maintenance.blockNewUsers)
    ) {
      setMaintenanceNoticeOpen(true);
      setAuthOpen(false);
      setAuthError(maintenance.message);
      return;
    }
    setAuthLoading(true);
    setAuthError("");
    setAuthMessage("");
    setAuthReady(false);
    try {
      const credential = await signInWithPopup(auth, new GoogleAuthProvider());
      pendingVerificationRef.current = false;
      setUserName(
        credential.user.displayName ||
          credential.user.email?.split("@")[0] ||
          "Akhand",
      );
      setAuthOpen(false);
    } catch (error) {
      const code =
        error instanceof Error && "code" in error ? String(error.code) : "";
      const messages: Record<string, string> = {
        "auth/popup-closed-by-user": "Google sign-in was cancelled.",
        "auth/popup-blocked": "Your browser blocked the Google sign-in popup.",
        "auth/account-exists-with-different-credential":
          "An account already exists with another sign-in method.",
        "auth/operation-not-allowed":
          "Enable Google as a sign-in provider in Firebase Authentication.",
        "auth/unauthorized-domain":
          "This domain is not enabled for Google sign-in in Firebase.",
      };
      setAuthError(
        messages[code] || "Google sign-in failed. Please try again.",
      );
      setAuthReady(true);
      setView("landing");
    } finally {
      setAuthLoading(false);
    }
  };

  const resendVerificationEmail = async () => {
    const user = auth.currentUser;
    if (!user) {
      setAuthError("Please sign in again to resend the verification email.");
      setAuthMode("signin");
      return;
    }
    setAuthLoading(true);
    setAuthError("");
    setAuthMessage("");
    try {
      await sendCustomAuthEmail(user.email ?? authEmail, "verify");
      setAuthMessage(
        `A new verification link was sent to ${user.email ?? authEmail}.`,
      );
    } catch (error) {
      const code =
        error instanceof Error && "code" in error ? String(error.code) : "";
      setAuthError(
        code === "auth/too-many-requests"
          ? "Too many emails requested. Please try again later."
          : "Could not send the verification email.",
      );
    } finally {
      setAuthLoading(false);
    }
  };

  const signOut = async () => {
    pendingVerificationRef.current = false;
    await firebaseSignOut(auth);
    setBlockedAccount(null);
    window.localStorage.removeItem("leadglut-active-nav");
    setView("landing");
  };

  const connectWhatsApp = () => {
    setWhatsappError("");
    setWhatsappConnecting(true);
    setWhatsappConnectOpen(true);
  };

  const connectInstagram = () => {
    const loginWindow = window.open(
      "https://www.instagram.com/accounts/login/",
      "leadglut-instagram-login",
      "popup=yes,width=480,height=720,resizable=yes,scrollbars=yes",
    );

    if (!loginWindow) {
      setInstagramConnectOpen(true);
    }
  };

  const followLeadOnInstagram = (instagram?: string | null) => {
    if (!instagram) return;
    const profileUrl = /^https?:\/\//i.test(instagram)
      ? instagram
      : `https://www.instagram.com/${instagram.replace(/^@/, "").replace(/\/$/, "")}/`;
    window.open(
      profileUrl,
      "leadglut-instagram-profile",
      "popup=yes,width=480,height=720,resizable=yes,scrollbars=yes",
    );
  };

  const closeWhatsAppConnect = () => {
    setWhatsappConnectOpen(false);
    if (!whatsappConnected) setWhatsappConnecting(false);
  };

  useEffect(() => {
    if (!whatsappConnectOpen) return;
    let active = true;
    let startRequested = false;
    const poll = async () => {
      try {
        const data = await fetchWhatsAppStatus({ start: !startRequested });
        startRequested = true;
        if (!active) return;
        setWhatsappState(data.state || "disconnected");
        setWhatsappQr(data.qrDataUrl || null);
        setWhatsappError(data.error || "");
        if (data.state === "ready") {
          window.localStorage.setItem("leadglut-whatsapp-connected", "true");
          setWhatsappConnected(true);
          setWhatsappConnecting(false);
          setWhatsappConnectOpen(false);
        } else {
          setWhatsappConnected(false);
          if (data.state === "disconnected" && startRequested) {
            setWhatsappConnecting(false);
          }
        }
      } catch (error) {
        if (active) {
          setWhatsappConnecting(false);
          setWhatsappError(
            error instanceof Error
              ? error.message
              : "WhatsApp could not start.",
          );
        }
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [whatsappConnectOpen]);

  useEffect(() => {
    if (discoveryJob?.status !== "running") return;
    let active = true;
    const poll = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;
        const response = await fetch("/api/leads/discover", {
          headers: { Authorization: `Bearer ${await user.getIdToken()}` },
          cache: "no-store",
        });
        const result = (await response.json()) as {
          job?: DiscoveryJob;
          error?: string;
        };
        if (!active) return;
        if (!response.ok)
          throw new Error(
            result.error || "Discovery status could not be loaded.",
          );
        if (result.job) {
          setDiscoveryJob(result.job);
          if (result.job.status !== "running") {
            const token = await user.getIdToken();
            const [leadsResponse, savedResponse, walletResponse] =
              await Promise.all([
                fetch("/api/leads", {
                  headers: { Authorization: `Bearer ${token}` },
                }),
                fetch("/api/leads?saved=1", {
                  headers: { Authorization: `Bearer ${token}` },
                }),
                fetch("/api/wallet/initialize", {
                  method: "POST",
                  headers: { Authorization: `Bearer ${token}` },
                }),
              ]);
            if (leadsResponse.ok)
              setLeads(
                ((await leadsResponse.json()) as { leads?: Lead[] }).leads ??
                  [],
              );
            if (savedResponse.ok)
              setSavedLeads(
                ((await savedResponse.json()) as { leads?: Lead[] }).leads ??
                  [],
              );
            if (walletResponse.ok)
              setBalance(
                ((await walletResponse.json()) as { balance?: number })
                  .balance ?? 0,
              );
            const automationResponse = await fetch("/api/leads/automation", {
              headers: { Authorization: `Bearer ${token}` },
              cache: "no-store",
            });
            if (automationResponse.ok) {
              const automation = (await automationResponse.json()) as {
                dailyFound?: number;
                dailyContacted?: number;
              };
              setAutoLeadDailyFound(Number(automation.dailyFound ?? 0));
              setAutoContactDailyCount(Number(automation.dailyContacted ?? 0));
            }
          }
        }
      } catch (error) {
        if (active)
          setPaymentError(
            error instanceof Error
              ? error.message
              : "Discovery status could not be loaded.",
          );
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [discoveryJob?.status]);

  useEffect(() => {
    const handleButtonClick = (event: MouseEvent) => {
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
    document.addEventListener("click", handleButtonClick);
    return () => document.removeEventListener("click", handleButtonClick);
  }, []);

  const contactLead = async (
    name: string,
    phone?: string | null,
    leadId?: string,
    location?: string,
  ) => {
    if (contactingLead) return;
    setContactingLead(leadId || name);
    setPaymentError("");
    try {
      const number = phone || (name === "Akhand" ? "9795979209" : "");
      if (!number)
        throw new Error("This lead does not have a WhatsApp number yet.");
      const lead = {
        id: leadId || name,
        name,
        phone: number,
        location,
      } as Lead;
      const message = renderWhatsAppTemplate(whatsappTemplate, lead);
      const user = auth.currentUser;
      if (!user)
        throw new Error("Please sign in again before contacting a lead.");
      const response = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${await user.getIdToken()}`,
        },
        body: JSON.stringify({ phone: number, message, leadId }),
      });
      const result = (await response.json()) as { error?: string };
      if (response.status === 409) {
        setSavedLeads((current) =>
          current.map((lead) =>
            lead.id === leadId ? { ...lead, contactedAt: true } : lead,
          ),
        );
        setContactedLeads((current) =>
          current.includes(name) ? current : [...current, name],
        );
        return;
      }
      if (!response.ok)
        throw new Error(result.error || "WhatsApp message could not be sent.");
      const next = contactedLeads.includes(name)
        ? contactedLeads
        : [...contactedLeads, name];
      setContactedLeads(next);
      setAutoContactDailyCount((count) => Math.min(20, count + 1));
      autoContactDailyRef.current.count = Math.min(
        20,
        autoContactDailyRef.current.count + 1,
      );
      window.localStorage.setItem(
        "leadglut-contacted-leads",
        JSON.stringify(next),
      );
    } catch (error) {
      setPaymentError(
        error instanceof Error
          ? error.message
          : "WhatsApp message could not be sent.",
      );
    } finally {
      setContactingLead(null);
    }
  };

  useEffect(() => {
    if (
      !autoLeadSettings.enabled ||
      !autoLeadSettings.autoContact ||
      !whatsappConnected ||
      !savedLeads.length
    )
      return;
    const today = new Date().toISOString().slice(0, 10);
    if (autoContactDailyRef.current.day !== today) {
      autoContactDailyRef.current = { day: today, count: 0 };
      setAutoContactDailyCount(0);
    }
    const remaining = savedLeads
      .filter(
        (lead) =>
          lead.phone &&
          !contactedLeads.includes(lead.name) &&
          !lead.contactedAt &&
          !autoContactScheduledRef.current.has(lead.id),
      )
      .slice(0, Math.max(0, 20 - autoContactDailyRef.current.count));
    if (!remaining.length) return;
    let cancelled = false;
    const contactRemaining = async () => {
      for (const lead of remaining) {
        if (cancelled) return;
        autoContactScheduledRef.current.add(lead.id);
        await contactLead(lead.name, lead.phone, lead.id, lead.location);
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
      }
    };
    void contactRemaining();
    return () => {
      cancelled = true;
    };
  }, [
    autoLeadSettings.enabled,
    autoLeadSettings.autoContact,
    whatsappConnected,
    savedLeads,
    autoContactDailyCount,
  ]);

  const purchaseLead = async (leadId: string) => {
    const user = auth.currentUser;
    if (!user || unlockingLeadId) return;
    setUnlockingLeadId(leadId);
    setPaymentError("");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/leads/purchase", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ leadId }),
      });
      const result = (await response.json()) as {
        error?: string;
        purchased?: boolean;
        charged?: boolean;
        lead?: Lead;
      };
      if (!response.ok)
        throw new Error(result.error || "Lead could not be purchased.");
      if (result.charged) setBalance((current) => Math.max(0, current - 1));
      setUnlockedLeadIds((current) =>
        current.includes(leadId) ? current : [...current, leadId],
      );
      if (result.lead)
        setSavedLeads((current) => [
          result.lead!,
          ...current.filter((lead) => lead.id !== leadId),
        ]);
    } catch (error) {
      setPaymentError(
        error instanceof Error ? error.message : "Lead could not be purchased.",
      );
    } finally {
      setUnlockingLeadId(null);
    }
  };

  const startDiscovery = async (mode: "manual" | "auto" | "configured") => {
    if (discoveryJob?.status === "running" || discoveryStarting) return;
    if (
      mode === "manual" &&
      (!discoveryCategory.trim() || !discoveryCity.trim())
    ) {
      setDiscoveryError("Enter a business category and city.");
      return;
    }
    setDiscoveryStarting(mode);
    setDiscoveryError("");
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Please sign in again before finding leads.");
      const token = await user.getIdToken();
      const response = await fetch("/api/leads/discover", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          mode,
          category: discoveryCategory,
          city: discoveryCity,
          limit: discoveryLimit,
        }),
      });
      const result = (await response.json()) as {
        job?: DiscoveryJob;
        error?: string;
        code?: string;
        balance?: number;
      };
      if (response.status === 402 && result.code === "INSUFFICIENT_BALANCE") {
        setBalance(result.balance ?? balance);
        changeSection("Wallet");
        setToast("Insufficient balance, please recharge wallet");
        return;
      }
      if (!response.ok || !result.job)
        throw new Error(result.error || "Lead discovery could not start.");
      setDiscoveryJob(result.job);
    } catch (error) {
      setDiscoveryError(
        error instanceof Error
          ? error.message
          : "Lead discovery could not start.",
      );
    } finally {
      setDiscoveryStarting(null);
    }
  };

  useEffect(() => {
    if (view !== "dashboard" || !autoLeadSettings.enabled) return;
    let active = true;
    const runConfiguredDiscovery = async () => {
      if (!active || autoDiscoveryRunningRef.current) return;
      if (autoLeadDailyFound >= autoLeadSettings.dailyLimit) return;
      autoDiscoveryRunningRef.current = true;
      try {
        await startDiscovery("configured");
      } finally {
        autoDiscoveryRunningRef.current = false;
      }
    };
    void runConfiguredDiscovery();
    const timer = window.setInterval(() => void runConfiguredDiscovery(), 5 * 60 * 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [
    view,
    autoLeadSettings.enabled,
    autoLeadSettings.dailyLimit,
    autoLeadDailyFound,
  ]);

  if (!authReady) {
    return (
      <main className="auth-loading-screen">
        <div className="preloader-orbit">
          <span className="preloader-core">L</span>
          <i></i>
          <i></i>
          <i></i>
        </div>
        <div className="preloader-brand">LeadGlut</div>
        <p>Preparing your dashboard</p>
        <div className="preloader-progress">
          <span></span>
        </div>
        <small>
          Securing your workspace · Loading wallet · Restoring connections
        </small>
      </main>
    );
  }

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 4000);
  };

  const startTopUp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPaymentLoading(true);
    setPaymentError("");
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Please sign in again before adding money.");
      const token = await user.getIdToken();
      const orderResponse = await fetch("/api/razorpay/order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          amount: topUpAmount,
          couponCode: couponApplied ? couponCode : "",
        }),
      });
      const order = (await orderResponse.json()) as {
        orderId?: string;
        amount?: number;
        currency?: string;
        keyId?: string;
        payableAmount?: number;
        error?: string;
      };
      if (
        !orderResponse.ok ||
        !order.orderId ||
        !order.keyId ||
        !order.amount ||
        !order.currency
      ) {
        throw new Error(order.error || "Could not start payment.");
      }
      if (!window.Razorpay)
        throw new Error("Payment checkout is still loading. Please try again.");
      const checkout = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: "LeadGlut",
        description: `Wallet top-up of ₹${topUpAmount}${couponApplied ? " (10% coupon applied)" : ""}`,
        order_id: order.orderId,
        theme: { color: "#17211d" },
        handler: async (response) => {
          const verification = await fetch("/api/razorpay/verify", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(response),
          });
          const result = (await verification.json()) as {
            balance?: number;
            error?: string;
          };
          if (!verification.ok || result.balance === undefined) {
            setPaymentError(result.error || "Payment verification failed.");
            return;
          }
          setBalance(result.balance);
        },
      });
      checkout.open();
    } catch (error) {
      setPaymentError(
        error instanceof Error
          ? error.message
          : "Payment could not be started.",
      );
    } finally {
      setPaymentLoading(false);
    }
  };

  const redeemCoupon = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCouponLoading(true);
    setCouponMessage("");
    try {
      const user = auth.currentUser;
      if (!user)
        throw new Error("Please sign in again before applying a coupon.");
      const token = await user.getIdToken();
      const response = await fetch("/api/wallet/coupon", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ code: couponCode }),
      });
      const result = (await response.json()) as {
        discountPercent?: number;
        creditAmount?: number;
        balance?: number;
        message?: string;
        error?: string;
      };
      if (!response.ok && response.status !== 409)
        throw new Error(result.error || "Coupon could not be applied.");
      if (result.balance !== undefined) setBalance(result.balance);
      setCouponApplied(
        result.discountPercent !== undefined && result.discountPercent > 0,
      );
      setCouponMessage(result.message || "Coupon applied.");
    } catch (error) {
      setCouponMessage(
        error instanceof Error
          ? error.message
          : "Coupon could not be redeemed.",
      );
    } finally {
      setCouponLoading(false);
    }
  };

  const availableLeads = leads.filter(
    (lead) => !unlockedLeadIds.includes(lead.id),
  );
  const categories = [
    ...new Set(leads.map((lead) => lead.category).filter(Boolean)),
  ] as string[];
  const locations = [
    ...new Set(leads.map((lead) => lead.location).filter(Boolean)),
  ] as string[];
  const normalizedSearch = leadSearch.trim().toLowerCase();
  const filteredLeads = availableLeads.filter((lead) => {
    const searchable = [
      lead.name,
      lead.work,
      lead.location,
      lead.website,
      lead.email,
      lead.instagram,
      lead.category,
      lead.status,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return (
      (!normalizedSearch || searchable.includes(normalizedSearch)) &&
      (leadCategory === "All industries" || lead.category === leadCategory) &&
      (leadLocation === "All locations" || lead.location === leadLocation)
    );
  });

  if (maintenance.fullWebsite) {
    return (
      <main className="auth-loading-screen">
        <div className="preloader-orbit">
          <span className="preloader-core">L</span>
        </div>
        <div className="preloader-brand">LeadGlut</div>
        <h1>We&apos;ll be back soon.</h1>
        <p>{maintenance.message}</p>
        <small>Thank you for your patience.</small>
      </main>
    );
  }

  if (blockedAccount) {
    const until = blockedAccount.until ? new Date(blockedAccount.until) : null;
    return (
      <main className="account-blocked-screen">
        <div className="account-blocked-card">
          <div className="account-blocked-icon">!</div>
          <span className="panel-kicker">Account access</span>
          <h1>{blockedAccount.permanent ? "Your account is permanently blocked." : "Your account is temporarily blocked."}</h1>
          <p>
            {blockedAccount.permanent
              ? "You cannot access the LeadGlut dashboard because this account has been permanently blocked."
              : until
                ? `Dashboard access is paused until ${until.toLocaleString("en-IN")}.`
                : "Dashboard access is temporarily paused."}
          </p>
          <div className="account-blocked-actions">
            <a className="primary-button" href="mailto:support@leadglut.com?subject=LeadGlut%20account%20access">Contact support <span>→</span></a>
            <button className="text-button" onClick={() => void signOut()}>Sign out</button>
          </div>
        </div>
      </main>
    );
  }

  if (view === "dashboard") {
    return (
      <>
        <ActionFeedback state={actionFeedback} />
        <Script
          src="https://checkout.razorpay.com/v1/checkout.js"
          strategy="afterInteractive"
        />
        <main className="dashboard-page">
          <aside className="sidebar">
            <Logo />
            <div className="workspace-switcher">
              <span className="avatar">AK</span>
              <span>
                <strong>Acme Studio</strong>
                <small>Personal workspace</small>
              </span>
              <span className="chevron">⌄</span>
            </div>
            <nav className="side-nav" aria-label="Dashboard navigation">
              {navItems.map((item, index) => (
                <button
                  className={
                    activeNav === item ? "nav-item active" : "nav-item"
                  }
                  key={item}
                  onClick={() => changeSection(item)}
                >
                  <span className="nav-icon">
                    {["⌂", "⌕", "♡", "◈"][index]}
                  </span>
                  {item}
                </button>
              ))}
            </nav>
            <div className="sidebar-bottom">
              <button
                className={
                  activeNav === "Settings" ? "nav-item active" : "nav-item"
                }
                onClick={() => changeSection("Settings")}
              >
                <span className="nav-icon">⚙</span>Settings
              </button>
              <button className="user-row" onClick={signOut}>
                <span className="avatar dark">
                  {userName.slice(0, 2).toUpperCase()}
                </span>
                <span>
                  <strong>{userName}</strong>
                  <small>Sign out</small>
                </span>
                <span>↗</span>
              </button>
            </div>
          </aside>
          <section className="dashboard-content">
            <header className="dashboard-header">
              <div>
                <p className="eyebrow">
                  {new Date().toLocaleDateString("en-IN", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </p>
                <h1>
                  {activeNav === "Overview" ? getTimeGreeting() : activeNav},{" "}
                  {userName}
                  <span className="wave">✦</span>
                </h1>
              </div>
              <div className="header-actions">
                <button
                  className={
                    whatsappConnected
                      ? "whatsapp-connected"
                      : "whatsapp-connect"
                  }
                  disabled={
                    whatsappConnected ||
                    whatsappConnecting ||
                    !whatsappStatusReady ||
                    whatsappState === "starting" ||
                    whatsappState === "authenticated"
                  }
                  onClick={connectWhatsApp}
                >
                  <span>◉</span>
                  {whatsappConnected
                    ? "WhatsApp connected"
                    : whatsappConnecting
                      ? "Connecting…"
                      : !whatsappStatusReady ||
                          whatsappState === "starting" ||
                          whatsappState === "authenticated"
                        ? "WhatsApp loading…"
                        : "Connect WhatsApp"}
                </button>
                <button
                        className="instagram-connect"
                        onClick={connectInstagram}
                        aria-label="Connect Instagram"
                >
                        <span className="instagram-button-icon" aria-hidden="true">
                          ◎
                        </span>
                        <span>Connect Instagram</span>
                        <span className="instagram-button-arrow" aria-hidden="true">
                          →
                        </span>
                </button>
                <button
                  className="icon-button"
                  aria-label="Help and support"
                  title="Help and support"
                  onClick={openHelp}
                >
                  ?
                </button>
                <button
                  className="icon-button"
                  aria-label="Enable notifications"
                  title="Enable notifications"
                  onClick={enablePushNotifications}
                >
                  🔔
                </button>
                <button
                  className="icon-button"
                  aria-label="Search leads"
                  title="Search leads"
                  onClick={focusLeadSearch}
                >
                  ⌕
                </button>
                <button
                  className="avatar"
                  aria-label="Open profile settings"
                  title="Open profile settings"
                  onClick={openProfile}
                >
                  {userName.slice(0, 2).toUpperCase()}
                </button>
              </div>
            </header>
            <OverviewPage>
              {pushMessage && <div className="toast">{pushMessage}</div>}
              <div
                className={
                  activeNav === "Overview"
                    ? "dashboard-overview"
                    : "dashboard-overview hidden-panel"
                }
              >
                <div className="stats-grid">
                  <article className="stat-card">
                    <span className="stat-label">Wallet balance</span>
                    <strong>
                      {walletReady
                        ? `₹${balance.toLocaleString("en-IN")}`
                        : "Loading…"}
                    </strong>
                    <span className="stat-meta">
                      {walletHistory.length
                        ? `${walletHistory.length} recent transactions`
                        : "No transactions yet"}
                    </span>
                  </article>
                  <article className="stat-card">
                    <span className="stat-label">Available leads</span>
                    <strong>{leads.length}</strong>
                    <span className="stat-meta">
                      {leads.length ? "Ready to review" : "No leads available"}
                    </span>
                  </article>
                  <article className="stat-card">
                    <span className="stat-label">Saved leads</span>
                    <strong>{savedLeads.length}</strong>
                    <span className="stat-meta">
                      {savedLeads.length
                        ? "Purchased for your workspace"
                        : "No leads saved yet"}
                    </span>
                  </article>
                </div>
                <div
                  className={
                    autoLeadSettings.enabled
                      ? "auto-leads-card panel is-on"
                      : "auto-leads-card panel"
                  }
                >
                  <div className="auto-leads-copy">
                    <div className="auto-leads-heading">
                      <span className="panel-kicker">Automation</span>
                      <span
                        className={
                          autoLeadSettings.enabled
                            ? "auto-status-badge on"
                            : "auto-status-badge off"
                        }
                      >
                        <i></i>
                        {autoLeadSettings.enabled ? "AUTO ON" : "AUTO OFF"}
                      </span>
                    </div>
                    <h2>Auto lead messages</h2>
                    <p>
                      {autoLeadSettings.enabled
                        ? `${autoLeadSettings.dailyLimit} leads daily${autoLeadSettings.autoContact ? " · Auto contact ON" : " · Auto contact OFF"}`
                        : "Automatically find leads every day."}
                    </p>
                    <div className="auto-progress">
                      <span>
                        Leads found:{" "}
                        <strong>
                          {autoLeadDailyFound}/{autoLeadSettings.dailyLimit}
                        </strong>
                      </span>
                      <span>
                        Connected: <strong>{autoContactDailyCount}/20</strong>
                      </span>
                    </div>
                  </div>
                  <button
                    className={
                      autoLeadSettings.enabled
                        ? "auto-toggle enabled"
                        : "auto-toggle"
                    }
                    onClick={() => setAutoLeadModalOpen(true)}
                  >
                    {autoLeadSettings.enabled
                      ? "Manage settings"
                      : "Turn on auto"}{" "}
                    <span>→</span>
                  </button>
                </div>
                <div className="overview-insights">
                  <section className="panel activity-panel">
                    <div className="panel-heading compact">
                      <div>
                        <span className="panel-kicker">Recent activity</span>
                        <h2>Your workspace activity</h2>
                      </div>
                    </div>
                    <div className="activity-list">
                      {walletHistory.slice(0, 5).map((item, index) => {
                        const debit =
                          item.type === "lead_purchase" || item.amount < 0;
                        return (
                          <div key={`${item.type}-${index}`}>
                            <span
                              className={`activity-dot ${debit ? "red" : "green"}`}
                            >
                              {debit ? "−" : "✓"}
                            </span>
                            <span>
                              <strong>
                                {historyLabel(item.type)}
                                {item.leadName ? ` · ${item.leadName}` : ""}
                              </strong>
                              <small>Account transaction</small>
                            </span>
                            <b className={debit ? "debit" : "credit"}>
                              {debit ? "−" : "+"} ₹
                              {Math.abs(item.amount).toLocaleString("en-IN")}
                            </b>
                          </div>
                        );
                      })}
                      {walletHistory.length === 0 && (
                        <p className="history-empty">
                          Your workspace activity will appear here.
                        </p>
                      )}
                    </div>
                  </section>
                  <section className="panel insight-panel">
                    <span className="panel-kicker">Workspace snapshot</span>
                    <h2>
                      {savedLeads.length
                        ? "Your saved leads are ready."
                        : "Start building your lead list."}
                    </h2>
                    <p>
                      {leads.length
                        ? `${leads.length} verified leads are available to review.`
                        : "New matching leads will appear here when available."}
                    </p>
                    <small className="insight-foot">
                      {savedLeads.length} saved · {leads.length} available
                    </small>
                  </section>
                </div>
                <div className="content-grid hidden-panel">
                  <section className="panel generator-panel">
                    <div className="panel-heading">
                      <div>
                        <span className="panel-kicker">Lead engine</span>
                        <h2>Find your next customer</h2>
                        <p>
                          Tell us what you need. We&apos;ll find the right
                          people.
                        </p>
                      </div>
                      <span className="sparkle">✦</span>
                    </div>
                    <div className="form-grid">
                      <label>
                        Industry
                        <select defaultValue="SaaS & technology">
                          <option>SaaS & technology</option>
                          <option>Real estate</option>
                          <option>Education</option>
                          <option>Healthcare</option>
                        </select>
                      </label>
                      <label>
                        Location
                        <select defaultValue="India">
                          <option>India</option>
                          <option>Delhi NCR</option>
                          <option>Mumbai</option>
                          <option>Bengaluru</option>
                        </select>
                      </label>
                      <label>
                        Monthly budget
                        <select defaultValue="₹25,000 – ₹50,000">
                          <option>₹10,000 – ₹25,000</option>
                          <option>₹25,000 – ₹50,000</option>
                          <option>₹50,000+</option>
                        </select>
                      </label>
                      <label>
                        Lead count
                        <div className="stepper">
                          <button
                            onClick={() =>
                              setLeadCount(Math.max(1, leadCount - 1))
                            }
                          >
                            −
                          </button>
                          <span>{leadCount}</span>
                          <button onClick={() => setLeadCount(leadCount + 1)}>
                            +
                          </button>
                        </div>
                      </label>
                    </div>
                    <label className="wide-label">
                      Contact intent
                      <div className="chips">
                        <button className="chip selected">Ready to buy</button>
                        <button className="chip">Exploring options</button>
                        <button className="chip">Need a demo</button>
                      </div>
                    </label>
                    <div className="generator-footer">
                      <span>
                        <strong>Estimated cost</strong>
                        <small>₹1 per qualified lead</small>
                      </span>
                      <button
                        className="primary-button"
                        onClick={() => {
                          setBalance(Math.max(0, balance - leadCount));
                          setGenerated(true);
                        }}
                      >
                        Generate {leadCount} leads <span>→</span>
                      </button>
                    </div>
                    {generated && (
                      <div className="success-note">
                        ✦ Your lead request is queued. We&apos;ll notify you
                        when they&apos;re ready.
                      </div>
                    )}
                  </section>
                  <section className="panel activity-panel">
                    <div className="panel-heading compact">
                      <div>
                        <span className="panel-kicker">Recent activity</span>
                        <h2>Your pulse</h2>
                      </div>
                      <button className="text-button">View all →</button>
                    </div>
                    <div className="activity-list">
                      <div>
                        <span className="activity-dot green">✓</span>
                        <span>
                          <strong>₹10 welcome bonus</strong>
                          <small>Added on account creation</small>
                        </span>
                        <b className="credit">+ ₹10</b>
                      </div>
                      <div>
                        <span className="activity-dot blue">↗</span>
                        <span>
                          <strong>Wallet top-ups</strong>
                          <small>Razorpay-secured payments</small>
                        </span>
                        <b className="credit">INR</b>
                      </div>
                      <div>
                        <span className="activity-dot purple">✓</span>
                        <span>
                          <strong>₹1 per qualified lead</strong>
                          <small>Only pay for your campaigns</small>
                        </span>
                        <b>− ₹1</b>
                      </div>
                    </div>
                    <form className="wallet-callout" onSubmit={startTopUp}>
                      <span className="wallet-icon">◈</span>
                      <span>
                        <strong>Add money to wallet</strong>
                        <small>
                          Recharge from ₹1 · Secure Razorpay checkout.
                        </small>
                      </span>
                      <input
                        aria-label="Top-up amount"
                        min="1"
                        max="10000"
                        step="1"
                        type="number"
                        value={topUpAmount}
                        onChange={(event) =>
                          setTopUpAmount(Number(event.target.value))
                        }
                      />
                      <button className="text-button" disabled={paymentLoading}>
                        {paymentLoading ? "Loading..." : "Top up"}
                      </button>
                    </form>
                    {paymentError && (
                      <p className="auth-error">{paymentError}</p>
                    )}
                  </section>
                </div>
              </div>
            </OverviewPage>
            {activeNav === "Find leads" && (
              <FindLeadsPage>
                <section className="page-panel">
                  <div className="page-hero">
                    <span className="panel-kicker">Business discovery</span>
                    <h2>Find local businesses automatically.</h2>
                    <p>
                      Enter a business category and location. We&apos;ll collect
                      public business details and save new prospects to your
                      workspace.
                    </p>
                  </div>
                  <div className="finder-panel panel">
                    <div className="finder-intro">
                      <span className="finder-illustration">⌕</span>
                      <div>
                        <h2>Build your prospect list</h2>
                        <p>
                          Search manually for a specific market or let the
                          finder search multiple Indian cities.
                        </p>
                      </div>
                    </div>
                    <div className="finder-form">
                      <label>
                        Business category<span>Manual search</span>
                        <input
                          value={discoveryCategory}
                          onChange={(event) =>
                            setDiscoveryCategory(event.target.value)
                          }
                          maxLength={80}
                          placeholder="e.g. Dental clinics, coaching centers"
                        />
                      </label>
                      <label>
                        City or location<span>Manual search</span>
                        <input
                          value={discoveryCity}
                          onChange={(event) =>
                            setDiscoveryCity(event.target.value)
                          }
                          maxLength={80}
                          placeholder="e.g. Pune, India"
                        />
                      </label>
                      <div className="limit-row">
                        <label>
                          Lead target<span>1–50 manual · 1–1,000 auto</span>
                          <input
                            type="number"
                            min={1}
                            max={1000}
                            value={discoveryLimit}
                            onChange={(event) =>
                              setDiscoveryLimit(Number(event.target.value))
                            }
                          />
                        </label>
                        <div className="limit-note">
                          <strong>Indian mobile leads only</strong>
                          <p>
                            Unavailable numbers, landlines, 1800 numbers and
                            non-Indian numbers are skipped automatically.
                          </p>
                        </div>
                      </div>
                      <div className="finder-actions">
                        <button
                          className="button button-secondary launch-button"
                          type="button"
                          disabled={
                            discoveryJob?.status === "running" ||
                            discoveryStarting !== null
                          }
                          onClick={() => startDiscovery("manual")}
                        >
                          <span>
                            {discoveryStarting === "manual" ? (
                              <i className="loading-spinner" />
                            ) : (
                              "⌕"
                            )}
                          </span>{" "}
                          {discoveryStarting === "manual"
                            ? "Starting search…"
                            : "Manual search"}
                        </button>
                        <button
                          className="button button-primary launch-button"
                          type="button"
                          disabled={
                            discoveryJob?.status === "running" ||
                            discoveryStarting !== null
                          }
                          onClick={() => startDiscovery("auto")}
                        >
                          <span>
                            {discoveryStarting === "auto" ? (
                              <i className="loading-spinner" />
                            ) : (
                              "✦"
                            )}
                          </span>{" "}
                          {discoveryStarting === "auto"
                            ? "Starting search…"
                            : "Auto-find across India"}
                        </button>
                      </div>
                    </div>
                  </div>
                  {discoveryError && (
                    <p className="auth-error finder-error">{discoveryError}</p>
                  )}
                  {discoveryJob && (
                    <div className="panel job-panel">
                      <div className="panel-heading">
                        <div>
                          <span className="panel-kicker">
                            Discovery progress
                          </span>
                          <h2>
                            {discoveryJob.status === "running"
                              ? "Finding businesses…"
                              : discoveryJob.status === "complete"
                                ? "Discovery complete"
                                : "Discovery stopped"}
                          </h2>
                          <p>
                            {discoveryJob.category} · {discoveryJob.city}
                          </p>
                        </div>
                        <span className="job-state">{discoveryJob.status}</span>
                      </div>
                      <div className="job-progress">
                        <div className="progress-track">
                          <i
                            style={{
                              width: `${Math.min(100, Math.round((discoveryJob.found / Math.max(1, discoveryJob.target)) * 100))}%`,
                            }}
                          />
                        </div>
                        <span>
                          {discoveryJob.found} / {discoveryJob.target}
                        </span>
                      </div>
                      <p className="job-message">
                        {discoveryJob.status === "running"
                          ? "Public business listings are being reviewed. Keep this page open."
                          : `${discoveryJob.found} found · ${discoveryJob.saved} new leads saved.`}
                        {discoveryJob.error ? ` ${discoveryJob.error}` : ""}
                        {discoveryJob.warning ? ` ${discoveryJob.warning}` : ""}
                      </p>
                    </div>
                  )}
                  <div className="lead-discovery">
                    <label className="lead-search">
                      <span aria-hidden="true">⌕</span>
                      <input
                        id="lead-search-input"
                        value={leadSearch}
                        onChange={(event) => setLeadSearch(event.target.value)}
                        placeholder="Search saved results..."
                        aria-label="Search leads"
                      />
                    </label>
                    <label>
                      Industry
                      <select
                        value={leadCategory}
                        onChange={(event) =>
                          setLeadCategory(event.target.value)
                        }
                      >
                        <option>All industries</option>
                        {categories.map((category) => (
                          <option key={category}>{category}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Location
                      <select
                        value={leadLocation}
                        onChange={(event) =>
                          setLeadLocation(event.target.value)
                        }
                      >
                        <option>All locations</option>
                        {locations.map((location) => (
                          <option key={location}>{location}</option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="text-button clear-filters"
                      type="button"
                      onClick={() => {
                        setLeadSearch("");
                        setLeadCategory("All industries");
                        setLeadLocation("All locations");
                      }}
                    >
                      Clear filters
                    </button>
                  </div>
                  <div className="lead-results">
                    <div className="results-summary">
                      <span>
                        <strong>{filteredLeads.length}</strong> matching leads
                      </span>
                      <small>{availableLeads.length} total available</small>
                    </div>
                    {leads.length === 0 && (
                      <p className="history-empty">
                        No leads are available right now.
                      </p>
                    )}
                    {leads.length > 0 && filteredLeads.length === 0 && (
                      <div className="empty-state">
                        <span className="empty-icon">⌕</span>
                        <strong>No matching leads</strong>
                        <small>
                          Try another keyword, industry or location.
                        </small>
                      </div>
                    )}
                    {filteredLeads.map((lead) => (
                      <div className="lead-result" key={lead.id}>
                        <span className="mini-avatar lead-avatar">
                          {lead.name.slice(0, 2).toUpperCase()}
                        </span>
                        <div>
                          <strong>{lead.name}</strong>
                          <small>
                            {lead.work} · {lead.location}
                          </small>
                          {lead.phone && (
                            <span className="lead-phone">
                              +91 ••••••{lead.phone.slice(-4)}
                            </span>
                          )}
                          <small>
                            {lead.email || "Email not found"}
                            {lead.instagram
                              ? ` · Instagram: ${lead.instagram.replace(/^https?:\/\/(www\.)?instagram\.com\//, "@").replace(/\/$/, "")}`
                              : ""}
                          </small>
                        </div>
                        <b>Verified</b>
                        <button
                          className="chip selected"
                          disabled={unlockingLeadId !== null}
                          onClick={() => purchaseLead(lead.id)}
                        >
                          {unlockingLeadId === lead.id
                            ? "Unlocking…"
                            : "Unlock for ₹1"}
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              </FindLeadsPage>
            )}
            {activeNav === "Saved leads" && (
              <SavedLeadsPage>
                <section className="page-panel">
                  <div className="page-hero">
                    <span className="panel-kicker">Your shortlist</span>
                    <h2>Good leads, saved for later.</h2>
                    <p>
                      Connect WhatsApp once from the top bar, then reach out to
                      any saved lead in one click.
                    </p>
                  </div>
                  {paymentError && <p className="auth-error">{paymentError}</p>}
                  {!whatsappConnected && (
                    <div className="connect-reminder">
                      <span>◉</span>
                      <div>
                        <strong>
                          Connect WhatsApp to contact leads faster
                        </strong>
                        <small>
                          It only takes one scan and stays connected for your
                          next visits.
                        </small>
                      </div>
                      <button
                        className="whatsapp-button"
                        onClick={connectWhatsApp}
                      >
                        Connect now →
                      </button>
                    </div>
                  )}
                  <div className="saved-leads-list">
                    {savedLeads.map((lead) => (
                      <div className="saved-lead" key={lead.id}>
                        <span className="mini-avatar lead-avatar">
                          {lead.name.slice(0, 2).toUpperCase()}
                        </span>
                        <div>
                          <strong>{lead.name}</strong>
                          <small>
                            {lead.work} · {lead.location}
                          </small>
                          <span className="lead-phone">
                            +91 {lead.phone || "Number unavailable"}
                          </span>
                          <small>
                            {lead.email || "Email not found"}
                            {lead.instagram
                              ? ` · Instagram: ${lead.instagram.replace(/^https?:\/\/(www\.)?instagram\.com\//, "@").replace(/\/$/, "")}`
                              : ""}
                          </small>
                        </div>
                        {contactedLeads.includes(lead.name) ||
                        lead.contactedAt ? (
                          <span className="contacted-badge">✓ Connected</span>
                        ) : (
                          <button
                            className="whatsapp-button"
                            onClick={() =>
                              contactLead(
                                lead.name,
                                lead.phone,
                                lead.id,
                                lead.location,
                              )
                            }
                            disabled={
                              !whatsappConnected ||
                              !lead.phone ||
                              contactingLead !== null
                            }
                          >
                            <span>◉</span>{" "}
                            {contactingLead === lead.id
                              ? "Connecting…"
                              : "Connect"}
                          </button>
                        )}
                        <button
                          className="instagram-follow-button"
                          onClick={() => followLeadOnInstagram(lead.instagram)}
                          disabled={!lead.instagram}
                          title={
                              lead.instagram
                                ? "Open Instagram profile"
                                : "Instagram profile unavailable"
                          }
                        >
                          <span>◎</span> Follow
                        </button>
                        <button className="icon-button">⋯</button>
                      </div>
                    ))}
                    {savedLeads.length === 0 && (
                      <p className="history-empty">
                        You have not saved any leads yet.
                      </p>
                    )}
                  </div>
                </section>
              </SavedLeadsPage>
            )}
            {activeNav === "Wallet" && (
              <WalletPage>
                <section className="page-panel">
                  <div className="wallet-hero">
                    <div>
                      <span className="panel-kicker">Your wallet</span>
                      <h2>₹{balance.toLocaleString("en-IN")}</h2>
                      <p>Available balance · ₹1 per qualified lead</p>
                    </div>
                    <span className="wallet-orb">◈</span>
                  </div>
                  <div className="wallet-grid">
                    <div className="wallet-card">
                      <span>Welcome bonus</span>
                      <strong>₹10</strong>
                      <small>One-time bonus on your first account setup.</small>
                    </div>
                    <form
                      className="wallet-card recharge-card"
                      onSubmit={startTopUp}
                    >
                      <span>Recharge wallet</span>
                      <div>
                        <input
                          min="1"
                          max="10000"
                          step="1"
                          type="number"
                          value={topUpAmount}
                          onChange={(event) =>
                            setTopUpAmount(Number(event.target.value))
                          }
                        />
                        <button
                          className="primary-button"
                          disabled={paymentLoading}
                        >
                          {paymentLoading ? "Loading..." : "Add money"}{" "}
                          <span>→</span>
                        </button>
                      </div>
                      <small>Secure Razorpay checkout · ₹1 minimum</small>
                    </form>
                    <form
                      className="wallet-card coupon-card"
                      onSubmit={redeemCoupon}
                    >
                      <span>Have a recharge coupon?</span>
                      <div>
                        <input
                          required
                          value={couponCode}
                          onChange={(event) => {
                            setCouponCode(event.target.value.toUpperCase());
                            setCouponApplied(false);
                          }}
                          placeholder="LEADLY10"
                        />
                        <button
                          className="text-button"
                          disabled={couponLoading}
                        >
                          {couponLoading ? "Checking..." : "Apply"}
                        </button>
                      </div>
                      <small>
                        LEAD100 adds ₹100 to your wallet. LEADLY10 gives 10% off
                        a recharge.
                      </small>
                      {couponMessage && (
                        <em className="coupon-message">{couponMessage}</em>
                      )}
                    </form>
                  </div>
                  {paymentError && <p className="auth-error">{paymentError}</p>}
                  <div className="history-card panel">
                    <div className="panel-heading compact">
                      <div>
                        <span className="panel-kicker">Wallet activity</span>
                        <h2>Transaction history</h2>
                      </div>
                    </div>{" "}
                    <div className="history-list">
                      {walletHistory.map((item, index) => {
                        const debit =
                          item.type === "lead_purchase" || item.amount < 0;
                        return (
                          <div key={index}>
                            <span
                              className={`activity-dot ${debit ? "red" : "green"}`}
                            >
                              {debit ? "−" : "✓"}
                            </span>
                            <span>
                              <strong>
                                {historyLabel(item.type)}
                                {item.leadName ? ` · ${item.leadName}` : ""}
                              </strong>
                              <small>
                                {item.createdAt?.seconds
                                  ? new Date(
                                      item.createdAt.seconds * 1000,
                                    ).toLocaleString("en-IN")
                                  : "Recent transaction"}
                              </small>
                            </span>
                            <b className={debit ? "debit" : "credit"}>
                              {debit ? "−" : "+"} ₹{Math.abs(item.amount)}
                            </b>
                          </div>
                        );
                      })}
                      {walletHistory.length === 0 && (
                        <p className="history-empty">
                          Your wallet transactions will appear here.
                        </p>
                      )}
                    </div>
                  </div>
                </section>
              </WalletPage>
            )}
            {activeNav === "Settings" && (
              <SettingsPage>
                <section className="page-panel">
                  <div className="page-hero settings-hero">
                    <span className="panel-kicker">Workspace settings</span>
                    <h2>Make LeadGlut work your way.</h2>
                    <p>
                      Manage your profile, workspace preferences and
                      notifications from one calm place.
                    </p>
                  </div>
                  <div className="settings-grid">
                    <div className="settings-card">
                      <span className="panel-kicker">Profile</span>
                      <h3>Personal details</h3>
                      <label>
                        Full name
                        <input defaultValue={userName} />
                      </label>
                      <label>
                        Email address
                        <input
                          defaultValue={auth.currentUser?.email ?? ""}
                          readOnly
                        />
                      </label>
                      <button className="primary-button">
                        Save changes <span>→</span>
                      </button>
                    </div>
                    <div className="settings-card">
                      <span className="panel-kicker">Preferences</span>
                      <h3>Stay in the loop</h3>
                      <label className="toggle-row">
                        <span>
                          <strong>Lead alerts</strong>
                          <small>Get notified when a new lead matches.</small>
                        </span>
                        <input type="checkbox" defaultChecked />
                      </label>
                      <label className="toggle-row">
                        <span>
                          <strong>Weekly digest</strong>
                          <small>A simple summary of your progress.</small>
                        </span>
                        <input type="checkbox" defaultChecked />
                      </label>
                      <label className="toggle-row">
                        <span>
                          <strong>Product updates</strong>
                          <small>News and improvements from LeadGlut.</small>
                        </span>
                        <input type="checkbox" />
                      </label>
                    </div>
                  </div>
                  <div className="settings-card whatsapp-template-card">
                    <span className="panel-kicker">WhatsApp outreach</span>
                    <h3>First message template</h3>
                    <p>
                      <code>&lt;Number&gt;</code> lead ka mobile,{" "}
                      <code>&lt;Name&gt;</code> lead ka naam,{" "}
                      <code>&lt;B_Name&gt;</code> lead ka business name aur{" "}
                      <code>&lt;Location&gt;</code> lead ki city/location use
                      karega. <code>*asterisks*</code> WhatsApp bold ke liye
                      hain.
                    </p>
                    <label>
                      Message
                      <textarea
                        value={whatsappTemplate}
                        onChange={(event) =>
                          setWhatsappTemplate(event.target.value)
                        }
                        rows={6}
                      />
                    </label>
                    <div className="required-attribution">
                      <span>Automatic footer</span>
                      <strong>Powered by LeadGlut</strong>
                      <small>
                        This footer is added automatically when the WhatsApp
                        message is sent.
                      </small>
                    </div>
                    <button
                      className="primary-button"
                      onClick={() => {
                        const template =
                          removeLegacyAttribution(whatsappTemplate);
                        setWhatsappTemplate(template);
                        window.localStorage.setItem(
                          "leadglut-whatsapp-settings",
                          JSON.stringify({ template }),
                        );
                        setSettingsMessage("WhatsApp message settings saved.");
                      }}
                    >
                      Save WhatsApp settings <span>→</span>
                    </button>
                    {settingsMessage && (
                      <p className="settings-success">{settingsMessage}</p>
                    )}
                  </div>
                </section>
              </SettingsPage>
            )}
            {autoLeadModalOpen && (
              <div
                className="modal-backdrop"
                onClick={() => setAutoLeadModalOpen(false)}
              >
                <form
                  className="auto-leads-modal"
                  onSubmit={saveAutoLeadSettings}
                  onClick={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    className="close-button"
                    onClick={() => setAutoLeadModalOpen(false)}
                  >
                    ×
                  </button>
                  <span className="modal-kicker">Daily automation</span>
                  <h2>How many leads daily?</h2>
                  <p>
                    LeadGlut will automatically find up to 20 leads per day and
                    stop when your wallet balance is used.
                  </p>
                  <label className="toggle-row automation-master-toggle">
                    <span>
                      <strong>Auto lead discovery</strong>
                      <small>
                        Turn automatic lead finding on or off anytime.
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      checked={autoLeadSettings.enabled}
                      onChange={(event) =>
                        setAutoLeadSettings({
                          ...autoLeadSettings,
                          enabled: event.target.checked,
                        })
                      }
                    />
                  </label>
                  <label>
                    Daily lead count
                    <input
                      type="number"
                      min="1"
                      max="20"
                      value={autoLeadSettings.dailyLimit}
                      onChange={(event) =>
                        setAutoLeadSettings({
                          ...autoLeadSettings,
                          dailyLimit: Math.min(20, Number(event.target.value)),
                        })
                      }
                    />
                  </label>{" "}
                  <label className="toggle-row">
                    <span>
                      <strong>Auto contact leads</strong>
                      <small>
                        Automatically send your saved WhatsApp template to a
                        maximum of 20 leads per day.
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      checked={autoLeadSettings.autoContact}
                      onChange={(event) =>
                        setAutoLeadSettings({
                          ...autoLeadSettings,
                          autoContact: event.target.checked,
                        })
                      }
                    />
                  </label>
                  <label className="toggle-row">
                    <span>
                      <strong>Random markets</strong>
                      <small>
                        Search different business categories and cities.
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      checked={autoLeadSettings.random}
                      onChange={(event) =>
                        setAutoLeadSettings({
                          ...autoLeadSettings,
                          random: event.target.checked,
                        })
                      }
                    />
                  </label>
                  {!autoLeadSettings.random && (
                    <div className="settings-form-grid">
                      <label>
                        Category
                        <input
                          required
                          value={autoLeadSettings.category}
                          onChange={(event) =>
                            setAutoLeadSettings({
                              ...autoLeadSettings,
                              category: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        City
                        <input
                          required
                          value={autoLeadSettings.city}
                          onChange={(event) =>
                            setAutoLeadSettings({
                              ...autoLeadSettings,
                              city: event.target.value,
                            })
                          }
                        />
                      </label>
                    </div>
                  )}
                  <div className="auto-wallet-note">
                    ⚠ Auto leads will only be found while your wallet has enough
                    balance. Keep money in your wallet to continue finding
                    leads.
                  </div>
                  {autoLeadError && (
                    <p className="auth-error">{autoLeadError}</p>
                  )}
                  <button
                    className="primary-button full"
                    disabled={autoLeadSaving}
                  >
                    {autoLeadSaving
                      ? "Saving..."
                      : autoLeadSettings.enabled
                        ? "Save auto settings"
                        : "Save with auto off"}{" "}
                    <span>→</span>
                  </button>
                </form>
              </div>
            )}
            {popup && (
              <div
                className={`popup-backdrop popup-${popup.type}`}
                onClick={dismissPopup}
              >
                <article
                  className="user-popup"
                  style={{ backgroundColor: popup.backgroundColor || "#ffffff", borderColor: popup.accentColor || "#bbef75" }}
                  onClick={(event) => event.stopPropagation()}
                >
                  <button className="popup-close" onClick={dismissPopup}>
                    ×
                  </button>
                  {popup.imageUrl && (
                    <img
                      className="user-popup-image"
                      src={popup.imageUrl}
                      alt=""
                    />
                  )}
                  {popup.header && (
                    <span className="modal-kicker">{popup.header}</span>
                  )}
                  <h2>{popup.title}</h2>
                  <p>{popup.body}</p>
                  {popup.footer && <small>{popup.footer}</small>}
                  {popup.buttonText && (
                    <a
                      className="primary-button popup-button"
                      style={{ backgroundColor: popup.accentColor || "#bbef75" }}
                      href={popup.buttonUrl || "#"}
                      target={popup.buttonUrl ? "_blank" : undefined}
                      rel="noreferrer"
                    >
                      {popup.buttonText} <span>→</span>
                    </a>
                  )}
                </article>
              </div>
            )}
            {(whatsappLead || whatsappConnectOpen) && (
              <div className="modal-backdrop" onClick={closeWhatsAppConnect}>
                <div
                  className="whatsapp-modal"
                  onClick={(event) => event.stopPropagation()}
                >
                  <button
                    className="close-button"
                    onClick={closeWhatsAppConnect}
                  >
                    ×
                  </button>
                  {whatsappLead ? (
                    <>
                      <div className="connected-mark">✓</div>
                      <span className="modal-kicker">WhatsApp connected</span>
                      <h2>Ready to contact {whatsappLead}</h2>
                      <p>
                        Your linked WhatsApp session is ready. LeadGlut will
                        send the message directly.
                      </p>
                      <button
                        className="primary-button full"
                        onClick={() => setWhatsappLead(null)}
                      >
                        Close <span>→</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="modal-kicker">
                        Real WhatsApp Web connection
                      </span>
                      <h2>
                        {whatsappState === "ready"
                          ? "Connected successfully"
                          : whatsappState === "disconnected" && whatsappError
                            ? "Connection failed"
                            : "Scan WhatsApp QR"}
                      </h2>
                      <p>
                        {whatsappState === "qr"
                          ? "WhatsApp on your phone → Linked devices → Link a device, then scan this live WhatsApp QR."
                          : whatsappState === "disconnected" && whatsappError
                            ? whatsappError
                            : "Starting WhatsApp Web session. The real QR will appear here in a moment."}
                      </p>
                      {whatsappQr ? (
                        <div className="qr-shell">
                          <img
                            src={whatsappQr}
                            alt="Live WhatsApp Web pairing QR code"
                          />
                        </div>
                      ) : (
                        <div className="qr-loading">
                          {whatsappState === "starting"
                            ? "Starting secure WhatsApp session…"
                            : whatsappError || "Waiting for WhatsApp QR…"}
                        </div>
                      )}
                      {whatsappState === "disconnected" && whatsappError && (
                        <button
                          className="primary-button full"
                          onClick={() => {
                            setWhatsappError("");
                            setWhatsappConnecting(true);
                            void fetchWhatsAppStatus({
                              retry: true,
                              start: true,
                            })
                              .then((data) => {
                                setWhatsappState(data.state || "disconnected");
                                setWhatsappQr(data.qrDataUrl || null);
                                setWhatsappError(data.error || "");
                              })
                              .catch((error: unknown) => {
                                setWhatsappConnecting(false);
                                setWhatsappError(
                                  error instanceof Error
                                    ? error.message
                                    : "WhatsApp could not start.",
                                );
                              });
                          }}
                        >
                          Try again <span>→</span>
                        </button>
                      )}
                      <small className="demo-hint">
                        This QR is generated by WhatsApp Web, not a LeadGlut
                        link. Keep this page open while scanning.
                      </small>
                    </>
                  )}
                </div>
              </div>
            )}
            {instagramConnectOpen && (
              <div
                className="modal-backdrop"
                onClick={() => setInstagramConnectOpen(false)}
              >
                <div
                  className="whatsapp-modal instagram-modal"
                  onClick={(event) => event.stopPropagation()}
                >
                  <button
                    className="close-button"
                    onClick={() => setInstagramConnectOpen(false)}
                  >
                    ×
                  </button>
                  <div className="instagram-mark">◎</div>
                  <span className="modal-kicker">Instagram connection</span>
                  <h2>Connect Instagram</h2>
                  <p>
                    Instagram login popup blocked है। Browser में popups allow
                    करें, फिर Connect Instagram दोबारा क्लिक करें। Login के
                    बाद lead के Follow button से उसका Instagram profile popup
                    में खुलेगा।
                  </p>
                  <button
                    className="primary-button full"
                    onClick={() => setInstagramConnectOpen(false)}
                  >
                    Got it <span>→</span>
                  </button>
                </div>
              </div>
            )}
          </section>
          {toast && (
            <div className="app-toast" role="status">
              {toast}
            </div>
          )}
        </main>
      </>
    );
  }

  return (
    <>
      <ActionFeedback state={actionFeedback} />
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="afterInteractive"
      />
      <main className="landing-page">
        <LandingPage>
          <nav className="top-nav">
            <Logo />
            <div className="nav-links">
              <a href="#how">How it works</a>
              <a href="#features">Features</a>
              <a href="#integrations">Integrations</a>
              <a href="#pricing">Pricing</a>
              <a href="#faq">FAQ</a>
            </div>
            <div className="nav-actions">
              <button
                className="login-button"
                onClick={() => openAuth("signin")}
              >
                Sign in
              </button>
              <button className="nav-cta" onClick={() => openAuth("signup")}>
                Get started <span>→</span>
              </button>
            </div>
          </nav>
          <section className="hero">
            <div className="hero-copy">
              <div className="pill">
                <span className="pulse-dot"></span> The smarter way to grow
              </div>
              <h1>
                Meet the people
                <br />
                <i>looking for you.</i>
              </h1>
              <p>
                LeadGlut finds high-intent leads that match your business — so
                you can spend less time searching and more time growing.
              </p>
              <div className="hero-actions">
                <button
                  className="primary-button large"
                  onClick={() => openAuth("signup")}
                >
                  Start finding leads <span>→</span>
                </button>
                <button className="play-button">
                  <span>▶</span> See how it works
                </button>
              </div>
              <div className="trusted">
                <span>Trusted by ambitious teams</span>
                <div className="trust-logos">
                  <b>northstar</b>
                  <b>LOOM</b>
                  <b className="serif">arc.</b>
                  <b>◒ notion</b>
                </div>
              </div>
            </div>
            <div className="hero-visual">
              <div className="glow"></div>
              <div className="float-card card-top">
                <span className="mini-avatar coral">+</span>
                <span>
                  <b>New lead match</b>
                  <small>Ready to review</small>
                </span>
                <span className="match">High intent</span>
              </div>
              <div className="orb">
                <div className="orb-inner"></div>
                <span className="orb-word">
                  find
                  <br />
                  your
                  <br />
                  fit
                </span>
              </div>
              <div className="float-card card-bottom">
                <span className="check-circle">✓</span>
                <span>
                  <b>Workspace ready</b>
                  <small>Start reviewing leads</small>
                </span>
              </div>
              <div className="sparkle-one">✦</div>
              <div className="sparkle-two">✦</div>
            </div>
          </section>
          <section className="feature-strip">
            <div>
              <span className="feature-number">01</span>
              <span>
                <b>Precision matching</b>
                <small>Leads built around your criteria.</small>
              </span>
            </div>
            <div>
              <span className="feature-number">02</span>
              <span>
                <b>Pay for intent</b>
                <small>Just ₹1 for every qualified lead.</small>
              </span>
            </div>
            <div>
              <span className="feature-number">03</span>
              <span>
                <b>Grow with confidence</b>
                <small>Every lead, a step forward.</small>
              </span>
            </div>
          </section>
          <AutoShowcase />
          <section className="landing-story reveal" id="how" data-reveal>
            <div className="story-copy">
              <span className="panel-kicker">How it works</span>
              <h2>Your next best customer is already looking.</h2>
              <p>
                LeadGlut turns scattered signals into a clear, actionable
                pipeline. Discover, understand and connect with people who fit
                your business.
              </p>
              <button
                className="text-button"
                onClick={() => openAuth("signup")}
              >
                Build your first audience →
              </button>
            </div>
            <div className="story-cards">
              <div className="story-card">
                <span className="story-number">01</span>
                <strong>Define your ideal lead</strong>
                <small>Choose the signal that matters to you.</small>
              </div>
              <div className="story-card raised">
                <span className="story-number">02</span>
                <strong>Get matched instantly</strong>
                <small>High-intent people, not noisy lists.</small>
              </div>
              <div className="story-card">
                <span className="story-number">03</span>
                <strong>Move with confidence</strong>
                <small>Every rupee works harder.</small>
              </div>
            </div>
          </section>
          <section className="feature-section reveal" id="features" data-reveal>
            <div className="section-heading">
              <span className="panel-kicker">Our features</span>
              <h2>Everything you need to find the right people.</h2>
              <p>
                From first signal to first conversation, LeadGlut keeps your
                lead workflow simple and focused.
              </p>
            </div>
            <div className="feature-grid">
              <article>
                <span className="feature-icon">⌕</span>
                <h3>Robust lead discovery</h3>
                <p>
                  Search by industry, location and buying intent instead of
                  noisy lists.
                </p>
              </article>
              <article>
                <span className="feature-icon">✦</span>
                <h3>Smart lead scoring</h3>
                <p>
                  See which prospects deserve your attention first with clear
                  intent signals.
                </p>
              </article>
              <article>
                <span className="feature-icon">↗</span>
                <h3>Action-ready workflow</h3>
                <p>
                  Save, review and contact leads from one calm, collaborative
                  workspace.
                </p>
              </article>
            </div>
          </section>
          <section
            className="integrations-section reveal"
            id="integrations"
            data-reveal
          >
            <div className="integration-copy">
              <span className="panel-kicker">Integrations</span>
              <h2>All your lead sources, working together.</h2>
              <p>
                Connect the tools you already use and keep every conversation,
                signal and follow-up in one clear view.
              </p>
              <div className="integration-chips">
                <span>WhatsApp</span>
                <span>Google</span>
                <span>Instagram</span>
                <span>Webhooks</span>
              </div>
              <button
                className="text-button"
                onClick={() => openAuth("signup")}
              >
                Connect your workspace <span>→</span>
              </button>
            </div>
            <div className="integration-preview">
              <div className="preview-top">
                <span>
                  <i></i>
                  <i></i>
                  <i></i>
                </span>
                <small>leadglut / integrations</small>
                <b>•••</b>
              </div>
              <div className="preview-body">
                <div className="preview-sidebar">
                  <strong>Sources</strong>
                  <span className="active">
                    All leads <b>248</b>
                  </span>
                  <span>
                    WhatsApp <b>86</b>
                  </span>
                  <span>
                    Instagram <b>64</b>
                  </span>
                  <span>
                    Webhooks <b>98</b>
                  </span>
                </div>
                <div className="preview-main">
                  <div className="preview-heading">
                    <span>
                      <small>CONNECTED SOURCES</small>
                      <strong>Lead flow overview</strong>
                    </span>
                    <em>Live</em>
                  </div>
                  <div className="preview-chart">
                    <span></span>
                    <span></span>
                    <span></span>
                    <span></span>
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                  <div className="preview-status">
                    <span>
                      <i className="status-dot"></i> 4 sources synced
                    </span>
                    <b>+28 this week</b>
                  </div>
                </div>
              </div>
            </div>
          </section>
          <section
            className="benefits-section reveal"
            id="benefits"
            data-reveal
          >
            <div className="section-heading">
              <span className="panel-kicker">Our benefits</span>
              <h2>Built to make every conversation count.</h2>
            </div>
            <div className="benefit-grid">
              <div>
                <strong>01</strong>
                <h3>Save hours every week</h3>
                <p>
                  Stop searching across disconnected sources and focus on
                  qualified opportunities.
                </p>
              </div>
              <div>
                <strong>02</strong>
                <h3>Spend with confidence</h3>
                <p>
                  At ₹1 per qualified lead, your budget stays predictable and
                  transparent.
                </p>
              </div>
              <div>
                <strong>03</strong>
                <h3>Grow at your pace</h3>
                <p>
                  Start small, learn what works and scale your outreach when you
                  are ready.
                </p>
              </div>
            </div>
          </section>
          <section className="why-section reveal" id="why" data-reveal>
            <div className="why-content">
              <span className="panel-kicker">Why choose us</span>
              <h2>
                Find better leads.
                <br />
                <i>Without the busywork.</i>
              </h2>
              <p>
                LeadGlut gives you a focused, affordable way to reach people who
                are already looking for what you offer.
              </p>
              <button
                className="text-button"
                onClick={() => openAuth("signup")}
              >
                Start finding better leads <span>→</span>
              </button>
            </div>
            <div className="why-points">
              <div>
                <span className="why-point-icon">⌕</span>
                <span>
                  <strong>Relevant from the start</strong>
                  <small>
                    Search by the industry, location and intent that matter to
                    your business.
                  </small>
                </span>
                <b>01</b>
              </div>
              <div>
                <span className="why-point-icon">₹</span>
                <span>
                  <strong>Transparent by design</strong>
                  <small>
                    Every qualified lead costs just ₹1. No monthly lock-in or
                    hidden fees.
                  </small>
                </span>
                <b>02</b>
              </div>
              <div>
                <span className="why-point-icon">↗</span>
                <span>
                  <strong>Made for action</strong>
                  <small>
                    Review, save and start conversations from one simple
                    workspace.
                  </small>
                </span>
                <b>03</b>
              </div>
            </div>
          </section>
          <section className="landing-details" aria-label="How LeadGlut works">
            <div className="detail-intro">
              <span className="panel-kicker">Built for momentum</span>
              <h2>
                Less hunting.
                <br />
                <i>More growing.</i>
              </h2>
              <p>
                LeadGlut keeps your pipeline focused on people who are most
                likely to say yes. Set your criteria once, then spend your time
                having better conversations.
              </p>
            </div>
            <div className="detail-list">
              <div>
                <span>01</span>
                <strong>Tell us who you want to reach</strong>
                <small>
                  Pick an industry, location and intent that fit your business.
                </small>
              </div>
              <div>
                <span>02</span>
                <strong>Review your best matches</strong>
                <small>
                  Get a clear list of relevant, high-intent prospects.
                </small>
              </div>
              <div>
                <span>03</span>
                <strong>Turn insight into action</strong>
                <small>
                  Save the right leads and start conversations from one
                  workspace.
                </small>
              </div>
            </div>
          </section>
          <section className="landing-banner pricing-section" id="pricing">
            <div className="pricing-copy">
              <span className="panel-kicker">Simple, transparent pricing</span>
              <h2>
                Every qualified lead
                <br />
                <i>just ₹1.</i>
              </h2>
              <p>
                No confusing plans or long-term commitments. Add balance when
                you need it and pay only for the leads you unlock.
              </p>
              <div className="pricing-points">
                <span>✓ No monthly fee</span>
                <span>✓ Start with ₹10 free</span>
                <span>✓ Pay only for what you use</span>
              </div>
            </div>
            <div className="price-card">
              <span className="price-label">PAY PER LEAD</span>
              <strong>₹1</strong>
              <span className="price-unit">for every qualified lead</span>
              <button
                className="primary-button large"
                onClick={() => openAuth("signup")}
              >
                Create your workspace <span>→</span>
              </button>
            </div>
          </section>
          <section
            className="testimonials-section reveal"
            id="testimonials"
            data-reveal
          >
            <div className="section-heading">
              <span className="panel-kicker">Our testimonials</span>
              <h2>Good leads make good stories.</h2>
            </div>
            <div className="testimonial-grid">
              <blockquote>
                “LeadGlut helped us stop guessing and start having conversations
                with the right prospects.”
                <footer>
                  <b>Riya Mehta</b>
                  <small>Growth lead, Northstar</small>
                </footer>
              </blockquote>
              <blockquote>
                “The ₹1 pricing is refreshingly simple. We can test new
                audiences without risking our budget.”
                <footer>
                  <b>Arjun Kapoor</b>
                  <small>Founder, Arc Studio</small>
                </footer>
              </blockquote>
              <blockquote>
                “Everything feels focused, from discovery to follow-up. Our team
                finally works from the same list.”
                <footer>
                  <b>Neha Sharma</b>
                  <small>Sales manager, Loom</small>
                </footer>
              </blockquote>
            </div>
          </section>
          <section className="faq-section reveal" id="faq" data-reveal>
            <div className="section-heading">
              <span className="panel-kicker">Frequently asked questions</span>
              <h2>Questions, answered clearly.</h2>
            </div>
            <div className="faq-list">
              <details open>
                <summary>How much does one lead cost?</summary>
                <p>
                  Every qualified lead costs just ₹1. There are no monthly plans
                  or hidden platform fees.
                </p>
              </details>
              <details>
                <summary>Can I start before adding payment details?</summary>
                <p>
                  Yes. New workspaces start with ₹10 free credit so you can
                  experience the workflow first.
                </p>
              </details>
              <details>
                <summary>What makes a lead qualified?</summary>
                <p>
                  We match leads to the industry, location and intent criteria
                  you choose in your workspace.
                </p>
              </details>
              <details>
                <summary>Can my team use the same workspace?</summary>
                <p>
                  Yes. LeadGlut is designed to keep your team aligned around one
                  shared lead list.
                </p>
              </details>
            </div>
          </section>
          <footer className="landing-footer" id="about">
            <div className="footer-brand">
              <Logo />
              <p>
                High-intent leads for teams that care about the next right
                customer.
              </p>
            </div>
            <div className="footer-links">
              <div>
                <strong>Product</strong>
                <a href="#how">How it works</a>
                <a href="#pricing">Pricing</a>
                <a href="#about">About LeadGlut</a>
              </div>
              <div>
                <strong>Company</strong>
                <a href="/our-story">Our story</a>
                <a href="/contact">Contact</a>
                <a href="/privacy">Privacy</a>
              </div>
              <div>
                <strong>Get started</strong>
                <button onClick={() => openAuth("signup")}>
                  Create account
                </button>
                <button onClick={() => openAuth("signin")}>Sign in</button>
              </div>
            </div>
            <div className="footer-bottom">
              <span>© 2026 LeadGlut. Built for better growth.</span>
              <span>Made with intention ✦</span>
            </div>
          </footer>
          {authOpen && (
            <div className="modal-backdrop" onClick={() => setAuthOpen(false)}>
              <form
                className="auth-modal"
                onSubmit={enterApp}
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className="close-button"
                  onClick={() => setAuthOpen(false)}
                >
                  ×
                </button>
                <Logo />
                <span className="modal-kicker">
                  {authMode === "signup"
                    ? "Start your growth story"
                    : authMode === "reset"
                      ? "Account recovery"
                      : authMode === "verify"
                        ? "One quick step"
                        : "Welcome back"}
                </span>
                <h2>
                  {authMode === "signup"
                    ? "Create your account"
                    : authMode === "reset"
                      ? "Reset your password"
                      : authMode === "verify"
                        ? "Verify your email"
                        : "Sign in to LeadGlut"}
                </h2>
                <p>
                  {authMode === "signup"
                    ? "Your next customer is closer than you think."
                    : authMode === "reset"
                      ? "Enter your email and we&apos;ll send you a secure reset link."
                      : authMode === "verify"
                        ? "Check your inbox, click the verification link, then come back here."
                        : "Pick up where you left off."}
                </p>
                {authMode === "signup" && (
                  <label>
                    Full name
                    <input
                      value={fullName}
                      onChange={(event) => setFullName(event.target.value)}
                      placeholder="Akhand Pratap Singh"
                    />
                  </label>
                )}
                {authMode !== "verify" && (
                  <label>
                    Email address
                    <input
                      required
                      type="email"
                      value={authEmail}
                      onChange={(event) => setAuthEmail(event.target.value)}
                      placeholder="you@company.com"
                    />
                  </label>
                )}
                {(authMode === "signup" || authMode === "signin") && (
                  <label>
                    Password
                    <input
                      required
                      minLength={6}
                      type="password"
                      value={authPassword}
                      onChange={(event) => setAuthPassword(event.target.value)}
                      placeholder="••••••••"
                    />
                  </label>
                )}
                {authMode === "signin" && (
                  <button
                    type="button"
                    className="forgot-password"
                    onClick={() => {
                      setAuthError("");
                      setAuthMessage("");
                      setAuthMode("reset");
                    }}
                  >
                    Forgot password?
                  </button>
                )}
                {authMode === "verify" && (
                  <div className="verification-note">
                    <strong>{authEmail || auth.currentUser?.email}</strong>
                    {authMessage && <span>{authMessage}</span>}
                  </div>
                )}
                {authError && <p className="auth-error">{authError}</p>}
                {authMessage && authMode !== "verify" && (
                  <p className="auth-message">{authMessage}</p>
                )}
                {authMode === "verify" ? (
                  <>
                    <button
                      type="submit"
                      disabled={authLoading}
                      className="primary-button full"
                    >
                      {authLoading
                        ? "Checking..."
                        : "I&apos;ve verified my email"}{" "}
                      {!authLoading && <span>→</span>}
                    </button>
                    <button
                      type="button"
                      disabled={authLoading}
                      className="text-button verification-resend"
                      onClick={resendVerificationEmail}
                    >
                      {authLoading ? "Sending..." : "Resend verification email"}
                    </button>
                    <div className="auth-switch">
                      Want to use another account?{" "}
                      <button
                        type="button"
                        onClick={() => {
                          pendingVerificationRef.current = false;
                          setAuthError("");
                          setAuthMessage("");
                          setAuthMode("signin");
                        }}
                      >
                        Sign in
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <button
                      type="submit"
                      disabled={authLoading}
                      className="primary-button full"
                    >
                      {authLoading
                        ? "Please wait..."
                        : authMode === "signup"
                          ? "Create free account"
                          : authMode === "reset"
                            ? "Send reset link"
                            : "Sign in"}{" "}
                      {!authLoading && <span>→</span>}
                    </button>
                    {(authMode === "signin" || authMode === "signup") && (
                      <>
                        <div className="auth-divider">
                          <span>or</span>
                        </div>
                        <button
                          type="button"
                          disabled={authLoading}
                          className="google-button"
                          onClick={signInWithGoogle}
                        >
                          <span className="google-mark">G</span>Continue with
                          Google
                        </button>
                      </>
                    )}
                    <div className="auth-switch">
                      {authMode === "signup"
                        ? "Already have an account?"
                        : authMode === "reset"
                          ? "Remember your password?"
                          : "New to LeadGlut?"}{" "}
                      <button
                        type="button"
                        onClick={() => {
                          setAuthError("");
                          setAuthMessage("");
                          setAuthMode(
                            authMode === "signup" ? "signin" : "signup",
                          );
                        }}
                      >
                        {authMode === "signup"
                          ? "Sign in"
                          : authMode === "reset"
                            ? "Sign in"
                            : "Create account"}
                      </button>
                    </div>
                  </>
                )}
                <small className="demo-hint">
                  Secured by Firebase Authentication.
                </small>
              </form>
            </div>
          )}
          {maintenanceNoticeOpen && (
            <div
              className="maintenance-notice-backdrop"
              role="dialog"
              aria-modal="true"
              onClick={() => setMaintenanceNoticeOpen(false)}
            >
              <div
                className="maintenance-notice"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className="close-button"
                  onClick={() => setMaintenanceNoticeOpen(false)}
                >
                  ×
                </button>
                <div className="maintenance-icon">✦</div>
                <span className="modal-kicker">Temporarily unavailable</span>
                <h2>Sign in is taking a short break</h2>
                <p>{maintenance.message}</p>
                <small>Our team is working on it. Please try again soon.</small>
                <button
                  type="button"
                  className="primary-button full"
                  onClick={() => setMaintenanceNoticeOpen(false)}
                >
                  Okay, got it <span>→</span>
                </button>
              </div>
            </div>
          )}
        </LandingPage>
      </main>
    </>
  );
}
