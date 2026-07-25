import type { CSSProperties } from "react";
import { useReducedMotion } from "../lib/motion";

/**
 * The Odin mark — a fist gripping a bolt of lightning, as a seamless looping
 * video. `mix-blend-mode: screen` drops the video's black background so the
 * glowing mark floats on the dark UI. Falls back to a still image when the user
 * prefers reduced motion; brightens a touch when provider sessions are live.
 */
export function OdinMark({
  size = 40,
  active = false,
  className,
}: {
  size?: number;
  active?: boolean;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const style: CSSProperties = {
    width: size,
    height: size,
    objectFit: "cover",
    mixBlendMode: "screen",
    filter: active ? "brightness(1.2) saturate(1.1)" : undefined,
    transition: "filter 0.6s ease",
  };

  if (reduced) {
    return <img src="/logo.png" alt="Odin" style={style} className={className} />;
  }

  return (
    <video
      src="/logo.mp4"
      poster="/logo.png"
      autoPlay
      loop
      muted
      playsInline
      aria-label="Odin"
      style={style}
      className={className}
    />
  );
}
