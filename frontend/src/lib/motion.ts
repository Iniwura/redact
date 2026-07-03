import { useEffect } from "react";

/**
 * Scroll-reveal: any element with class "rv" fades and rises into place the
 * first time it enters the viewport. Elements inside a ".rv-stagger" parent
 * cascade with a per-child delay. Respects prefers-reduced-motion via CSS.
 */
export function useReveal(deps: unknown[] = []) {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>(".rv:not(.in)"));
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            (e.target as HTMLElement).classList.add("in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.12 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Count-up for stat numbers. Returns a ref callback. */
export function countUp(el: HTMLElement | null, to: number, suffix = "") {
  if (!el) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    el.textContent = to.toLocaleString() + suffix;
    return;
  }
  const dur = 1100;
  const start = performance.now();
  const from = 0;
  function tick(now: number) {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    el!.textContent = Math.round(from + (to - from) * eased).toLocaleString() + suffix;
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
