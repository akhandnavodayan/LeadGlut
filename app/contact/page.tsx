import type { Metadata } from "next";
import { InfoPage } from "../../components/pages/InfoPage";
import { ContactPage as ContactForm } from "../../components/pages/ContactPage";

export const metadata: Metadata = {
  title: "Contact — LeadGlut",
  description: "Get in touch with the LeadGlut team.",
};

export default function ContactPage() {
  return (
    <InfoPage
      eyebrow="Contact"
      title="Let’s make your next conversation count."
      intro="Have a question about LeadGlut, pricing or getting started? We’re here to help."
    >
      <section className="contact-intro"><span className="contact-intro-icon">✦</span><div><h2>We’re here to help.</h2><p>Choose the best way to reach our team and we’ll get back to you as soon as possible.</p></div></section>
      <section className="contact-grid">
        <div className="contact-card">
          <span className="contact-icon">✉</span>
          <h2>Email us</h2>
          <p>For product questions, account help and general enquiries.</p>
          <a href="mailto:hello@leadglut.com">hello@leadglut.com</a>
        </div>
        <div className="contact-card">
          <span className="contact-icon">?</span>
          <h2>Need help?</h2>
          <p>Tell us what you are trying to build and we will point you in the right direction.</p>
          <a href="mailto:support@leadglut.com">support@leadglut.com</a>
        </div>
      </section>
      <ContactForm />
      <section className="info-callout">
        <span className="panel-kicker">A quick note</span>
        <h2>We usually reply within one business day.</h2>
        <p>When you write to us, include the email connected to your workspace so we can help you faster.</p>
      </section>
    </InfoPage>
  );
}
