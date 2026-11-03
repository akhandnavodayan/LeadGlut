"use client";

import { useEffect, useState } from "react";

const slides = [
  {
    label: "01 / Discover",
    title: "Find the signal before everyone else.",
    text: "Filter by industry, location and intent to build a focused lead list in seconds.",
    metric: "248",
    metricLabel: "matching leads",
  },
  {
    label: "02 / Prioritise",
    title: "Know who deserves your attention.",
    text: "Clear intent signals help your team start with the conversations most likely to move forward.",
    metric: "92%",
    metricLabel: "high-intent score",
  },
  {
    label: "03 / Convert",
    title: "Move from lead to conversation.",
    text: "Save the right prospects, keep your team aligned and reach out while interest is fresh.",
    metric: "₹1",
    metricLabel: "per qualified lead",
  },
];

export function AutoShowcase() {
  const [activeSlide, setActiveSlide] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveSlide((current) => (current + 1) % slides.length);
    }, 4200);
    return () => window.clearInterval(timer);
  }, []);

  const slide = slides[activeSlide];

  return (
    <section className="showcase-section reveal" data-reveal aria-label="LeadGlut product showcase">
      <div className="showcase-copy">
        <span className="panel-kicker">See it in motion</span>
        <h2>One smooth flow from <i>signal to sale.</i></h2>
        <p>LeadGlut keeps the important part moving: finding the right people and starting the right conversations.</p>
        <div className="showcase-controls" aria-label="Showcase slides">
          {slides.map((item, index) => (
            <button
              type="button"
              key={item.label}
              className={index === activeSlide ? "active" : ""}
              onClick={() => setActiveSlide(index)}
              aria-label={`Show ${item.label}`}
              aria-pressed={index === activeSlide}
            >
              <span>{item.label}</span>
              <i></i>
            </button>
          ))}
        </div>
      </div>
      <div className="showcase-card" aria-live="polite">
        <div className="showcase-card-top"><span>{slide.label}</span><b>● Live workflow</b></div>
        <div className="showcase-card-main">
          <div className="showcase-ring"><strong>{slide.metric}</strong><small>{slide.metricLabel}</small></div>
          <div><h3>{slide.title}</h3><p>{slide.text}</p></div>
        </div>
        <div className="showcase-progress"><span style={{ width: `${((activeSlide + 1) / slides.length) * 100}%` }}></span></div>
      </div>
    </section>
  );
}
