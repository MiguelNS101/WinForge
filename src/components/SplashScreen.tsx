interface SplashScreenProps {
  progress: number;
  statusText: string;
  fadingOut: boolean;
}

/**
 * Boot splash display featuring an animated minimalist monochrome single-line cat (squish),
 * the WinForge wordmark, and a TUI loading progress bar.
 */
export function SplashScreen({ progress, statusText, fadingOut }: SplashScreenProps) {
  return (
    <div
      aria-label="Inicializando WinForge"
      className={`absolute inset-0 z-40 flex flex-col items-center justify-center bg-[#1e1e2e] px-8 transition-opacity duration-300 ${
        fadingOut ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
    >
      <div className="flex flex-col items-center gap-6">
        {/* Minimalist Monochrome Single-Line Squish Cat */}
        <div className="relative flex flex-col items-center">
          <svg
            width="112"
            height="104"
            viewBox="0 0 112 104"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            className="overflow-visible"
          >
            {/* Subtle ground shadow synced with squish */}
            <ellipse
              cx="56"
              cy="91"
              rx="28"
              ry="4"
              fill="#11111b"
              className="animate-cat-shadow"
            />

            {/* Single-line monochrome cat body & face */}
            <g className="animate-cat-squish">
              {/* Continuous single-line loaf silhouette: left ear -> crown -> right ear -> cheek -> body -> tucked paws -> left cheek */}
              <path
                d="M 32 42 L 29 22 C 28.8 19.5 31.2 18.4 33.1 20 L 44 29.5 C 48 28.3 64 28.3 68 29.5 L 78.9 20 C 80.8 18.4 83.2 19.5 83 22 L 80 42 C 85 48 88 57 87 68 C 86.2 77.5 79.5 83 68 83 L 44 83 C 32.5 83 25.8 77.5 25 68 C 24 57 27 48 32 42 Z"
                stroke="#cba6f7"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Single-line curled tail */}
              <path
                d="M 85.5 74 C 95 73 99 66 96.5 59 C 94.5 53.5 88.5 54 88 58.5"
                stroke="#cba6f7"
                strokeWidth="2.4"
                strokeLinecap="round"
                className="animate-cat-tail"
              />

              {/* Minimalist face: blinking eyes + tiny w mouth */}
              <g className="animate-cat-blink">
                <path
                  d="M 42 51 Q 45.5 47.5 49 51"
                  stroke="#cba6f7"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
                <path
                  d="M 63 51 Q 66.5 47.5 70 51"
                  stroke="#cba6f7"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
              </g>

              <path
                d="M 52 57.5 Q 54 60 56 57.5 Q 58 60 60 57.5"
                stroke="#cba6f7"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Minimalist tucked paws hint */}
              <path
                d="M 45 83 C 45 78.5 49.5 78.5 49.5 83 M 62.5 83 C 62.5 78.5 67 78.5 67 83"
                stroke="#cba6f7"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </g>
          </svg>
        </div>

        {/* App Name Display */}
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="font-mono text-2xl font-bold tracking-tight text-[#cdd6f4]">
            WinForge
          </h1>
          <p className="font-mono text-[11px] text-[#7f849c]">
            Universal Windows Provisioner
          </p>
        </div>

        {/* TUI Loading Bar */}
        <div className="flex w-56 flex-col gap-2">
          <div className="h-1.5 w-full overflow-hidden border border-[#313244] bg-[#11111b]">
            <div
              className="h-full bg-[#cba6f7] transition-[width] duration-150 ease-out"
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>
          <div className="flex items-center justify-between font-mono text-[11px]">
            <span className="truncate text-[#a6adc8]">{statusText}</span>
            <span className="shrink-0 text-[#cba6f7] tabular-nums">
              {Math.round(progress)}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
