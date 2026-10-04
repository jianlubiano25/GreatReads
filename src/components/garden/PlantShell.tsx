import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * PlantLabel: plain text only (no pill, border, background or shadow), centred over the plant.
 * It lives OUTSIDE the swaying element, so it stays still while the plant moves.
 */
export function PlantLabel({ night, children }: { night: boolean; children: React.ReactNode }) {
  return (
    <span
      className="plant-label animate-particle-float"
      aria-hidden="true"
      style={{ color: night ? '#f3e6d3' : '#3b2a1d' }}
    >
      {children}
    </span>
  );
}

interface PlantShellProps {
  /** Text shown over the plant when tapped, e.g. "🌻 Golden Sunflower" (the emoji stays in the label). */
  label: string;
  /** Accessible name for the button. */
  ariaLabel: string;
  title?: string;
  night: boolean;
  /** Hanging plants get a short rope up to the rail. */
  hanging?: boolean;
  children: React.ReactNode;
  onTap?: () => void;
}

const SWAY_MS = 900;
const LABEL_MS = 1200;

/**
 * One plant = one real <button> that owns its own sway + label timers, so any number of plants
 * can sway at once and tapping another plant never cancels this one.
 */
export const PlantShell = React.memo(function PlantShell({ label, ariaLabel, title, night, hanging, children, onTap }: PlantShellProps) {
  const [swayRun, setSwayRun] = useState(0); // 0 = still; each tap flips 1 <-> 2 so the CSS animation restarts
  const [labelRun, setLabelRun] = useState(0);
  const swayTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const labelTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => {
    clearTimeout(swayTimer.current);
    clearTimeout(labelTimer.current);
  }, []);

  const handleTap = useCallback(() => {
    try {
      navigator.vibrate?.([15, 25]);
    } catch {}
    setSwayRun(r => (r % 2) + 1);
    setLabelRun(r => r + 1);
    clearTimeout(swayTimer.current);
    clearTimeout(labelTimer.current);
    swayTimer.current = setTimeout(() => setSwayRun(0), SWAY_MS);
    labelTimer.current = setTimeout(() => setLabelRun(0), LABEL_MS);
    onTap?.();
  }, [onTap]);

  const standSway = swayRun === 1 ? 'animate-plant-sway' : swayRun === 2 ? 'animate-plant-sway-b' : 'plant-idle';
  const hangSway = swayRun === 1 ? 'animate-hang-sway' : swayRun === 2 ? 'animate-hang-sway-b' : '';

  const button = (
    <button type="button" onClick={handleTap} title={title} aria-label={ariaLabel} className={`plant-btn ${hanging ? 'plant-idle' : standSway}`}>
      {children}
    </button>
  );

  return (
    <div className={`plant-shell${hanging ? ' plant-shell-hang' : ''}`}>
      {labelRun > 0 && <PlantLabel key={labelRun} night={night}>{label}</PlantLabel>}
      {hanging ? (
        // Rope and plant are ONE swinging unit, pivoting from where the rope meets the rail (see .hang-swing)
        <div className={`hang-swing ${hangSway}`}>
          <span className="hang-rope" aria-hidden="true" />
          {button}
        </div>
      ) : (
        button
      )}
    </div>
  );
});
