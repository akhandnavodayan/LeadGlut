"use client";

import { Suspense, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { confirmPasswordReset } from "firebase/auth";
import { auth } from "../../lib/firebase";
import styles from "./page.module.css";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const oobCode = searchParams.get("oobCode");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!oobCode) {
      setError("Invalid or expired reset link.");
      return;
    }
    if (password.length < 6) {
      setError("Your password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await confirmPasswordReset(auth, oobCode, password);
      setComplete(true);
      setMessage("Your password has been reset. You can now sign in with your new password.");
    } catch (resetError) {
      const code = resetError instanceof Error && "code" in resetError
        ? String(resetError.code)
        : "";
      setError(
        code === "auth/expired-action-code" || code === "auth/invalid-action-code"
          ? "Invalid or expired reset link."
          : code === "auth/weak-password"
            ? "Choose a stronger password with at least 6 characters."
            : "We couldn't reset your password. Please request a new reset link and try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  const invalidLink = !oobCode;

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="reset-title">
        <Link className={styles.brand} href="/" aria-label="LeadGlut home">
          <span className={styles.brandMark}>L</span>
          <span>LeadGlut</span>
        </Link>

        {complete ? (
          <div className={styles.content}>
            <div className={styles.successIcon} aria-hidden="true">✓</div>
            <p className={styles.eyebrow}>Password updated</p>
            <h1 id="reset-title">You’re all set.</h1>
            <p className={styles.description}>{message}</p>
            <Link className={styles.button} href="/">
              Back to sign in
            </Link>
          </div>
        ) : invalidLink ? (
          <div className={styles.content}>
            <p className={styles.eyebrow}>Password reset</p>
            <h1 id="reset-title">This link can’t be used.</h1>
            <p className={styles.error} role="alert">
              Invalid or expired reset link.
            </p>
            <Link className={styles.button} href="/">
              Request a new link
            </Link>
          </div>
        ) : (
          <div className={styles.content}>
            <p className={styles.eyebrow}>Account security</p>
            <h1 id="reset-title">Create a new password</h1>
            <p className={styles.description}>
              Choose a strong password to secure your LeadGlut account.
            </p>

            <form className={styles.form} onSubmit={submit}>
              <label className={styles.field}>
                <span>New Password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={6}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="At least 6 characters"
                  disabled={loading}
                />
              </label>

              <label className={styles.field}>
                <span>Confirm Password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={6}
                  required
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Enter your new password again"
                  disabled={loading}
                />
              </label>

              {error && <p className={styles.error} role="alert">{error}</p>}

              <button className={styles.button} type="submit" disabled={loading}>
                {loading ? "Resetting..." : "Reset password"}
              </button>
            </form>
          </div>
        )}

        <footer className={styles.footer}>
          Secure access for teams that care about the next right customer.
        </footer>
      </section>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <main className={styles.page}>
          <section className={styles.card} aria-label="Loading password reset">
            <div className={styles.brand}>
              <span className={styles.brandMark}>L</span>
              <span>LeadGlut</span>
            </div>
            <p className={styles.description}>Loading secure password reset…</p>
          </section>
        </main>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
