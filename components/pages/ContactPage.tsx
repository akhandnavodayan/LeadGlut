"use client";

import { FormEvent, useState } from "react";

export function ContactPage() {
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "" });
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSending(true);
    setStatus("");
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Message could not be sent.");
      setForm({ name: "", email: "", subject: "", message: "" });
      setStatus("Thanks! Your message has been sent to the LeadGlut team.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Message could not be sent.");
    } finally {
      setSending(false);
    }
  };

  return (
    <form className="contact-form" onSubmit={submit}>
      <div className="contact-form-heading">
        <span className="panel-kicker">Send a message</span>
        <h2>Let&apos;s talk.</h2>
        <p>Tell us what you need and our team will get back to you within one business day.</p>
      </div>
      <div className="contact-form-grid">
        <label>Name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Your name" /></label>
        <label>Email<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="you@company.com" /></label>
      </div>
      <label>Subject<input required value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} placeholder="How can we help?" /></label>
      <label>Message<textarea required rows={6} value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} placeholder="Write your message..." /></label>
      <button className="primary-button" disabled={sending}>{sending ? "Sending..." : "Send message"} <span>→</span></button>
      {status && <p className={status.startsWith("Thanks") ? "contact-form-success" : "contact-form-error"}>{status}</p>}
    </form>
  );
}
