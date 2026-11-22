"use client";

import { useEffect, useRef } from "react";

/* Animated halftone from the landing hero. A copy of
   apps/landing/components/effects/halftone-hero.tsx: change both together.
   Draw it on a dark background (#08080d). */

const SPACING = 10;
const BRIGHTNESS = 11;
const CONTRAST = 3;
const GAMMA = 0.6;
const MIN_DOT = 0;
const MAX_DOT = 68;
const HOVER_RADIUS = 290;
const FALLOFF = 24;
const PULSE_AMP = 0.19;
const SPEED = 1.2;

const HOVER_RIPPLE = 0.35;
const PULSE_SPATIAL = 0.006;
const PULSE_TEMPORAL = Math.PI * 0.45;
const FALLOFF_EXP = 0.35 + (FALLOFF / 100) * 2.4;

/* 256-entry brightness/contrast/gamma table — per-dot work stays one array read. */
const TONE_LUT = (() => {
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    let v = i / 255 + BRIGHTNESS / 100;
    v = (v - 0.5) * (1 + CONTRAST / 100) + 0.5;
    v = Math.min(1, Math.max(0, v));
    lut[i] = v ** (1 / GAMMA);
  }
  return lut;
})();

type Dot = { x: number; y: number; tone: number };
/* Dots bucketed by their exact sampled color: the draw loop sets fillStyle once
   per distinct color instead of once per dot. Exact, so no quantization banding
   on the gradient. */
type ColorGroup = { css: string; dots: Dot[] };

export function HalftoneHero({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let groups: ColorGroup[] = [];
    let cols = 0;
    let rows = 0;
    let w = 0;
    let h = 0;
    let raf = 0;
    let ready = false;
    const mouse = { x: -9999, y: -9999 };
    const img = new Image();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const sample = () => {
      if (!ready) return;
      const rect = canvas.parentElement!.getBoundingClientRect();
      // fullscreen/tab transitions fire a 0x0 resize — nothing to sample yet
      if (rect.width < 1 || rect.height < 1) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      cols = Math.ceil(w / SPACING);
      rows = Math.ceil(h / SPACING);

      const off = document.createElement("canvas");
      off.width = cols;
      off.height = rows;
      const octx = off.getContext("2d")!;
      // cover-fit, flipped horizontally and vertically
      const scale = Math.max(cols / img.width, rows / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      octx.save();
      octx.translate(cols / 2, rows / 2);
      octx.scale(-1, -1);
      octx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
      octx.restore();
      const data = octx.getImageData(0, 0, cols, rows).data;
      const byColor = new Map<number, ColorGroup>();
      for (let i = 0; i < cols * rows; i++) {
        const r = data[i * 4];
        const g = data[i * 4 + 1];
        const b = data[i * 4 + 2];
        const key = (r << 16) | (g << 8) | b;
        let group = byColor.get(key);
        if (!group) {
          group = { css: `rgb(${r},${g},${b})`, dots: [] };
          byColor.set(key, group);
        }
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        group.dots.push({
          x: (i % cols) * SPACING + SPACING / 2,
          y: Math.floor(i / cols) * SPACING + SPACING / 2,
          tone: TONE_LUT[Math.round(lum)],
        });
      }
      groups = [...byColor.values()];
    };

    const square = (path: Path2D, x: number, y: number, radius: number) =>
      path.rect(x - radius, y - radius, radius * 2, radius * 2);

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (!ready || groups.length === 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const pulsePhase = reduced ? 0 : (t / 1000) * SPEED * PULSE_TEMPORAL;
      const cellRadius = SPACING / 2;
      const minFactor = MIN_DOT / 100;
      const span = (MAX_DOT - MIN_DOT) / 100;
      const cx = w / 2;
      const cy = h / 2;

      for (const group of groups) {
        const path = new Path2D();
        for (const d of group.dots) {
          let radius = (minFactor + span * d.tone) * cellRadius;
          if (!reduced) {
            const dist = Math.hypot(d.x - cx, d.y - cy);
            radius *= 1 + PULSE_AMP * Math.sin(pulsePhase - dist * PULSE_SPATIAL);
          }

          // hover swells dots inside 290px, 24% falloff band
          const md = Math.hypot(d.x - mouse.x, d.y - mouse.y);
          if (md < HOVER_RADIUS) {
            radius *= 1 + HOVER_RIPPLE * (1 - md / HOVER_RADIUS) ** FALLOFF_EXP;
          }

          if (radius <= 0.05) continue;
          square(path, d.x, d.y, radius);
        }
        ctx.fillStyle = group.css;
        ctx.fill(path);
      }
    };

    // listen on window so the reveal works through the overlaid hero text
    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    };
    const onLeave = () => {
      mouse.x = -9999;
      mouse.y = -9999;
    };

    img.src = "/gradient.jpg";
    img.onload = () => {
      ready = true;
      sample();
    };

    const ro = new ResizeObserver(sample);
    ro.observe(canvas.parentElement!);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerleave", onLeave);
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className ?? ""}`} aria-hidden>
      <canvas ref={canvasRef} className="block size-full" />
    </div>
  );
}
