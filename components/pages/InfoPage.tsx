import Link from "next/link";
import { ReactNode } from "react";

type InfoPageProps = {
  eyebrow: string;
  title: string;
  intro: string;
  children: ReactNode;
};

export function InfoPage({ eyebrow, title, intro, children }: InfoPageProps) {
  return (
    <main className="info-page">
      <header className="info-nav">
        <Link className="logo" href="/" aria-label="LeadGlut home">
          <span className="logo-mark">L</span>
          <span>leadglut</span>
        </Link>
        <nav className="info-nav-actions">
          <Link className="info-back" href="/">Back to home</Link>
          <Link className="nav-cta" href="/?signup=1">Get started <span>→</span></Link>
        </nav>
      </header>
      <article className="info-content">
        <div className="info-hero">
          <span className="panel-kicker">{eyebrow}</span>
          <h1>{title}</h1>
          <p>{intro}</p>
          <div className="info-hero-orbit"><span>✦</span><i></i><b>leadglut</b></div>
        </div>
        <div className="info-body">{children}</div>
      </article>
      <footer className="info-footer">
        <span>© 2026 LeadGlut</span>
        <nav aria-label="Footer navigation">
          <Link href="/our-story">Our story</Link>
          <Link href="/contact">Contact</Link>
          <Link href="/privacy">Privacy</Link>
        </nav>
      </footer>
    </main>
  );
}
