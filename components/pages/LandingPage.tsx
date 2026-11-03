"use client";

import { ReactNode, useEffect, useRef, useState } from "react";

export function LandingPage({ children }: { children: ReactNode }) {
  const [showBackToTop, setShowBackToTop] = useState(false);
  const cursorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const revealItems = document.querySelectorAll<HTMLElement>("[data-reveal]");
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => entry.isIntersecting && entry.target.classList.add("is-visible")),
      { threshold: 0.12 },
    );
    revealItems.forEach((item) => observer.observe(item));
    const handleScroll = () => setShowBackToTop(window.scrollY > 560);
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || !cursorRef.current) return;
      cursorRef.current.style.transform = `translate3d(${event.clientX - 18}px, ${event.clientY - 18}px, 0)`;
    };
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    return () => window.removeEventListener("pointermove", handlePointerMove);
  }, []);

  const scrollToTop = () => window.scrollTo({ top: 0, behavior: "smooth" });

  return (
    <div data-page="landing">
      {children}
      <div ref={cursorRef} className="cursor-glow" aria-hidden="true"></div>
      <button
        className={`back-to-top${showBackToTop ? " visible" : ""}`}
        type="button"
        onClick={scrollToTop}
        aria-label="Back to top"
        aria-hidden={!showBackToTop}
        tabIndex={showBackToTop ? 0 : -1}
      >
        <span>↑</span>
        <small>Top</small>
      </button>
    </div>
  );
}
