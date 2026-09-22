import { useEffect, useRef } from "react";
import { Player } from "@lordicon/react";

export interface OnceIconProps {
  /** Lordicon Lottie JSON (self-hosted - see `./icons/`, D8/Lordicon best practices). */
  icon: object;
  className?: string;
}

/**
 * A Lordicon animation played once on mount and left on its final frame - never looped, per
 * Lordicon's own best-practice guidance that looping icons stop delivering their effect. Replays
 * from the beginning on hover instead, which is Lordicon's own recommended trigger for an icon
 * that isn't otherwise animating: motion on demand rather than motion that never stops.
 */
export default function OnceIcon({ icon, className }: OnceIconProps) {
  const ref = useRef<Player>(null);

  useEffect(() => {
    ref.current?.playFromBeginning();
  }, [icon]);

  return (
    <span
      className={className}
      aria-hidden
      onMouseEnter={() => ref.current?.playFromBeginning()}
    >
      <Player ref={ref} icon={icon} />
    </span>
  );
}
