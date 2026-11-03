import type { Metadata } from "next";
import { InfoPage } from "../../components/pages/InfoPage";

export const metadata: Metadata = {
  title: "Our story — LeadGlut",
  description: "The story behind LeadGlut.",
};

export default function OurStoryPage() {
  return (
    <InfoPage
      eyebrow="Our story"
      title="Better growth starts with better conversations."
      intro="LeadGlut was created to make finding the right customers feel less like a hunt and more like a clear, repeatable process."
    >
      <section className="info-feature">
        <div><span className="info-section-number">01</span><h2>Built for teams that do more with less.</h2></div>
        <p>Small teams should not need a large sales operation to find meaningful opportunities. We built LeadGlut around a simple idea: give people useful signals, remove the noise, and let them focus on conversations that matter.</p>
      </section>
      <section className="info-stat-grid">
        <div><strong>01</strong><h3>Signal over noise</h3><p>Relevant criteria and intent help you spend time where it counts.</p></div>
        <div><strong>02</strong><h3>Simple by default</h3><p>A focused workspace keeps discovery and action in one place.</p></div>
        <div><strong>03</strong><h3>Fair for every team</h3><p>At ₹1 per qualified lead, you can start small and grow with confidence.</p></div>
      </section>
      <section className="info-callout">
        <span className="panel-kicker">Our promise</span>
        <h2>Practical tools. Better conversations.</h2>
        <p>We will keep LeadGlut practical, transparent and focused on helping you find your next right customer.</p>
      </section>
    </InfoPage>
  );
}
