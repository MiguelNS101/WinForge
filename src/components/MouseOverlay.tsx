import { useEffect, useState } from 'react';
import { tauriBridge } from '../services/tauriBridge';
import { MouseOverlayState } from '../types/profile';

export function MouseOverlay() {
  const [state, setState] = useState<MouseOverlayState>({
    x: -9999,
    y: -9999,
    spotlightActive: false,
    crosshairActive: false,
    spotlightRadius: 120,
  });

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    tauriBridge
      .onMouseOverlayState((payload) => {
        setState(payload);
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => {
      unlisten?.();
    };
  }, []);

  if (!state.spotlightActive && !state.crosshairActive) {
    return <div className="pointer-events-none fixed inset-0 h-screen w-screen bg-transparent" />;
  }

  const radius = Math.max(60, state.spotlightRadius || 120);

  return (
    <div className="pointer-events-none fixed inset-0 h-screen w-screen select-none overflow-hidden bg-transparent">
      {/* Find My Mouse Spotlight Vignette */}
      {state.spotlightActive && (
        <>
          <div
            className="fixed inset-0"
            style={{
              background: `radial-gradient(circle ${radius}px at ${state.x}px ${state.y}px, rgba(17, 17, 27, 0) 0%, rgba(17, 17, 27, 0.04) 76%, rgba(17, 17, 27, 0.72) 100%)`,
            }}
          />
          <div
            className="fixed rounded-full border-2 border-[#cba6f7]/90"
            style={{
              left: `${state.x - radius}px`,
              top: `${state.y - radius}px`,
              width: `${radius * 2}px`,
              height: `${radius * 2}px`,
              boxShadow: '0 0 24px rgba(203, 166, 247, 0.45)',
            }}
          />
        </>
      )}

      {/* Mouse Crosshair Guide Lines */}
      {state.crosshairActive && (
        <>
          {/* Horizontal guide */}
          <div
            className="fixed left-0 right-0 h-[1px] bg-[#cba6f7]/75"
            style={{
              top: `${state.y}px`,
              boxShadow: '0 0 4px rgba(17, 17, 27, 0.85)',
            }}
          />
          {/* Vertical guide */}
          <div
            className="fixed bottom-0 top-0 w-[1px] bg-[#cba6f7]/75"
            style={{
              left: `${state.x}px`,
              boxShadow: '0 0 4px rgba(17, 17, 27, 0.85)',
            }}
          />
          {/* Center precision ring */}
          <div
            className="fixed rounded-full border border-[#a6e3a1]/90"
            style={{
              left: `${state.x - 10}px`,
              top: `${state.y - 10}px`,
              width: '20px',
              height: '20px',
            }}
          />
        </>
      )}
    </div>
  );
}
