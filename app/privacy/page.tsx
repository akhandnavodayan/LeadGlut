import type { Metadata } from "next";
import { InfoPage } from "../../components/pages/InfoPage";

export const metadata: Metadata = {
  title: "Privacy — LeadGlut",
  description: "LeadGlut privacy principles and data practices.",
};

export default function PrivacyPage() {
  return (
    <InfoPage
      eyebrow="Privacy"
      title="Your data should work for you, not against you."
      intro="This page explains the principles we use to handle account, workspace and lead data responsibly."
    >
      <section className="privacy-row">
        <span className="info-section-number">01</span><div><h2>What we collect</h2>
        <p>We collect the information needed to create your account, operate your workspace, process payments and provide support. This can include your name, email address, workspace activity and payment status.</p>
        </div>
      </section>
      <section className="privacy-row">
        <span className="info-section-number">02</span><div><h2>How we use it</h2>
        <p>We use this information to provide LeadGlut, secure your account, improve the product and communicate important service updates. We do not sell your personal information.</p>
        </div>
      </section>
      <section className="privacy-row">
        <span className="info-section-number">03</span><div><h2>Your choices</h2>
        <p>You can ask us to update or delete your account information, or contact us with questions about how your data is handled. Email <a href="mailto:privacy@leadglut.com">privacy@leadglut.com</a> for privacy requests.</p>
        </div>
      </section>
      <p className="info-updated">Last updated: 31 October 2026</p>
    </InfoPage>
  );
}
