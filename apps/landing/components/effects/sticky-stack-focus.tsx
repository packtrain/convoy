"use client";

import { useEffect } from "react";

/* Marks the folding cards that the next card has covered, so only the one you
   are reading keeps a bright header. A pinned sticky element stops moving, so
   its rect is useless here — this compares scroll position against each card's
   natural `offsetTop`, which sticky does not shift. */
export function StickyStackFocus({
  navHeight,
  headerHeight,
}: {
  navHeight: number;
  headerHeight: number;
}) {
  useEffect(() => {
    const cards = [...document.querySelectorAll<HTMLElement>("[data-stack-card]")];
    if (cards.length === 0) return;
    // cards only stack at lg — below that they are static and none are covered
    const stacks = window.matchMedia("(min-width: 64rem)");

    let tops: number[] = [];
    let queued = false;

    const apply = () => {
      queued = false;
      cards.forEach((card, i) => {
        const next = i + 1;
        const covered =
          stacks.matches &&
          next < cards.length &&
          window.scrollY + navHeight + next * headerHeight >= tops[next];
        card.toggleAttribute("data-covered", covered);
      });
    };

    const remeasure = () => {
      tops = cards.map((card) => card.offsetTop);
      apply();
    };

    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(apply);
    };

    remeasure();
    window.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(remeasure);
    ro.observe(document.documentElement);

    return () => {
      window.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [navHeight, headerHeight]);

  return null;
}
