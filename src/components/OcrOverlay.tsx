import React, { useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauriRuntime, tauriBridge } from '../services/tauriBridge';

interface DragBox {
  startX: number;
  startY: number;
  curX: number;
  curY: number;
}

export function OcrOverlay() {
  const [drag, setDrag] = useState<DragBox | null>(null);
  const [capturing, setCapturing] = useState(false);
  const dragRef = useRef<DragBox | null>(null);

  const closeOverlay = async () => {
    if (!isTauriRuntime()) return;
    try {
      await getCurrentWindow().close();
    } catch {
      // Ignore if already closing
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        void closeOverlay();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const normalizedRect = drag
    ? {
        x: Math.min(drag.startX, drag.curX),
        y: Math.min(drag.startY, drag.curY),
        width: Math.abs(drag.curX - drag.startX),
        height: Math.abs(drag.curY - drag.startY),
      }
    : null;

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (capturing) return;
    if (e.button === 2) {
      void closeOverlay();
      return;
    }
    if (e.button !== 0) return;
    const next: DragBox = {
      startX: e.clientX,
      startY: e.clientY,
      curX: e.clientX,
      curY: e.clientY,
    };
    dragRef.current = next;
    setDrag(next);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragRef.current || capturing) return;
    const next: DragBox = {
      ...dragRef.current,
      curX: e.clientX,
      curY: e.clientY,
    };
    dragRef.current = next;
    setDrag(next);
  };

  const handleMouseUp = async () => {
    const current = dragRef.current;
    dragRef.current = null;
    if (!current || capturing) return;

    const x = Math.min(current.startX, current.curX);
    const y = Math.min(current.startY, current.curY);
    const width = Math.abs(current.curX - current.startX);
    const height = Math.abs(current.curY - current.startY);

    if (width < 6 || height < 6) {
      setDrag(null);
      return;
    }

    setCapturing(true);

    try {
      if (isTauriRuntime()) {
        const win = getCurrentWindow();
        const dpr = window.devicePixelRatio || 1;
        let originX = 0;
        let originY = 0;
        try {
          const pos = await win.outerPosition();
          originX = pos.x;
          originY = pos.y;
        } catch {
          originX = 0;
          originY = 0;
        }

        const physX = Math.round(originX + x * dpr);
        const physY = Math.round(originY + y * dpr);
        const physW = Math.max(4, Math.round(width * dpr));
        const physH = Math.max(4, Math.round(height * dpr));

        // Hide overlay immediately so DWM does not include the dimming veil in the GDI capture
        await win.hide();

        try {
          await tauriBridge.extractTextFromRegion(physX, physY, physW, physH);
        } finally {
          await win.close();
        }
      }
    } catch {
      await closeOverlay();
    }
  };

  return (
    <div
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={() => void handleMouseUp()}
      onContextMenu={(e) => {
        e.preventDefault();
        void closeOverlay();
      }}
      className={`fixed inset-0 h-screen w-screen select-none overflow-hidden cursor-crosshair ${
        normalizedRect ? 'bg-transparent' : 'bg-[#11111b]/40'
      }`}
    >
      {/* Top center TUI HUD */}
      {!capturing && (
        <div className="pointer-events-none fixed left-1/2 top-4 z-20 -translate-x-1/2 border border-[#cba6f7] bg-[#181825]/95 px-3.5 py-1.5 font-mono text-[11px] text-[#cdd6f4] shadow-xl">
          <span className="font-bold text-[#cba6f7]">WINFORGE OCR</span>
          <span className="mx-2 text-[#45475a]">│</span>
          <span>Arraste para extrair texto da tela</span>
          <span className="mx-2 text-[#45475a]">│</span>
          <span className="text-[#fab387]">ESC / Botão Dir. cancela</span>
        </div>
      )}

      {/* Selection rectangle with inverted outer dimming spotlight */}
      {normalizedRect && !capturing && (
        <div
          className="pointer-events-none fixed border-2 border-[#cba6f7] bg-transparent"
          style={{
            left: `${normalizedRect.x}px`,
            top: `${normalizedRect.y}px`,
            width: `${normalizedRect.width}px`,
            height: `${normalizedRect.height}px`,
            boxShadow: '0 0 0 9999px rgba(17, 17, 27, 0.45)',
          }}
        >
          <div className="absolute -bottom-6 left-0 whitespace-nowrap border border-[#cba6f7]/70 bg-[#181825]/95 px-1.5 py-0.5 font-mono text-[10px] text-[#a6e3a1]">
            {Math.round(normalizedRect.width)} × {Math.round(normalizedRect.height)} px
          </div>
        </div>
      )}
    </div>
  );
}
