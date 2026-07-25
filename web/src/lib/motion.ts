import { createElement, useEffect, useRef, useState } from "react";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reduced;
}

export function useCountUp(target: number, opts?: { durationMs?: number }): number {
  const durationMs = opts?.durationMs ?? 700;
  const safeTarget = Number.isFinite(target) ? target : 0;
  const reducedMotion = useReducedMotion();
  const [value, setValue] = useState(0);
  const valueRef = useRef(0);

  useEffect(() => {
    if (reducedMotion || durationMs <= 0) {
      valueRef.current = safeTarget;
      setValue(safeTarget);
      return;
    }

    const from = valueRef.current;
    const startedAt = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = from + (safeTarget - from) * eased;
      valueRef.current = next;
      setValue(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [durationMs, reducedMotion, safeTarget]);

  return value;
}

export function CountUp({
  value,
  format,
  className,
}: {
  value: number;
  format: (value: number) => string;
  className?: string;
}) {
  const animated = useCountUp(value);
  return createElement("span", { className }, format(animated));
}
