"use client";

import { useEffect, useRef } from "react";

/**
 * HP3 cursor-spotlight — the only client island on the landing. Renders the
 * backdrop layer and tracks the pointer across its parent hero, writing
 * --mx/--my (CSS handles the static pin + reduced-motion). Scoped to the hero
 * by construction: the listener lives on the parent element.
 */
export function HeroSpotlight() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    const hero = el?.parentElement;
    if (!el || !hero) return;
    if (typeof window.matchMedia !== "function") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMove = (e: PointerEvent) => {
      if (reduced.matches) return;
      const r = hero.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
    };
    hero.addEventListener("pointermove", onMove);
    return () => hero.removeEventListener("pointermove", onMove);
  }, []);

  return (
    <div
      ref={ref}
      className="hero-spotlight pointer-events-none absolute inset-0 -z-[1]"
      aria-hidden="true"
    />
  );
}
