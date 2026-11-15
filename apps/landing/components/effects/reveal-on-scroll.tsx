"use client";

import { useEffect } from "react";

/* Reveals each `.reveal` below the viewport once, then stops watching it — a
   block that re-fades every time you scroll back over it fights the reader.
   Copy is visible until the observer exists, so failed scripts never hide it. */
export function RevealOnScroll() {
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          delete (entry.target as HTMLElement).dataset.pending;
          io.unobserve(entry.target);
        }
      },
      // fire a little before the block's top edge, not the moment it grazes
      { rootMargin: "0px 0px -12%" },
    );
    const pending = [...document.querySelectorAll<HTMLElement>(".reveal")].filter(
      (el) => el.getBoundingClientRect().top >= window.innerHeight,
    );
    for (const el of pending) {
      el.dataset.pending = "";
      io.observe(el);
    }
    return () => {
      io.disconnect();
      for (const el of pending) delete el.dataset.pending;
    };
  }, []);

  return null;
}
