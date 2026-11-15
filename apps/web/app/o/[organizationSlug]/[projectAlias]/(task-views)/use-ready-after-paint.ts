import { useEffect, useState } from "react";

// `false` for the first painted frame after mount, then `true`.
//
// Defers an expensive subtree past one paint so it doesn't block the commit it mounts in.
// App Router runs navigation in a transition, keeping the old route on screen until the new
// tree commits — so a heavy synchronous render freezes the old route with no feedback.
// Gating on this commits a cheap placeholder first.
//
// Two `requestAnimationFrame`s, not an effect: an effect runs before paint, so React would
// fold the placeholder and the heavy render into one commit and the placeholder would never
// paint.
export function useReadyAfterPaint(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setReady(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);

  return ready;
}
