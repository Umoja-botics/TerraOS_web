import { useState, useRef } from 'react';
import { VideoIcon, XIcon } from '@/components/icons';

type CamStatus = 'NO_SIGNAL' | 'CONNECTING' | 'LIVE' | 'STALE';

interface Props {
  bridgeUrl: string | null;
  simulated?: boolean;
}

export function CameraWidget({ bridgeUrl, simulated = false }: Props) {
  const defaultUrl = bridgeUrl && !simulated
    ? (() => {
        try {
          const u = new URL(bridgeUrl);
          return `${u.protocol}//${u.hostname}:8080/stream?topic=/camera/image`;
        } catch { return ''; }
      })()
    : '';
  const [mjpegUrl, setMjpegUrl]   = useState(defaultUrl);
  const [inputUrl, setInputUrl]   = useState(defaultUrl);
  const [status, setStatus]       = useState<CamStatus>(defaultUrl ? 'CONNECTING' : 'NO_SIGNAL');
  const [active, setActive]       = useState(!!defaultUrl);
  const staleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetStaleTimer = () => {
    if (staleTimer.current) clearTimeout(staleTimer.current);
    staleTimer.current = setTimeout(() => setStatus('STALE'), 3000);
  };

  const handleLoad = () => {
    if (!inputUrl.trim()) return;
    setMjpegUrl(inputUrl.trim());
    setActive(true);
    setStatus('CONNECTING');
  };

  const handleStop = () => {
    setActive(false);
    setStatus('NO_SIGNAL');
    if (staleTimer.current) clearTimeout(staleTimer.current);
  };

  const statusColor: Record<CamStatus, string> = {
    LIVE:       'text-green-400',
    STALE:      'text-yellow-400',
    CONNECTING: 'text-blue-400',
    NO_SIGNAL:  'text-gray-600',
  };

  const statusDot: Record<CamStatus, string> = {
    LIVE:       'bg-green-400 animate-pulse',
    STALE:      'bg-yellow-400',
    CONNECTING: 'bg-blue-400 animate-pulse',
    NO_SIGNAL:  'bg-gray-700',
  };

  return (
    <div className="card p-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
        <span className="flex items-center gap-1.5 text-xs text-gray-500 uppercase tracking-wide"><VideoIcon className="w-3.5 h-3.5" />Camera</span>
        <div className={`flex items-center gap-1.5 text-[10px] font-mono ${statusColor[status]}`}>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot[status]}`} />
          {status}
        </div>
      </div>

      {/* Video area */}
      <div className="relative bg-black" style={{ aspectRatio: '16/9' }}>
        {simulated ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-gray-600 font-mono">
            <span className="text-xs">CAMERA NON SIMULEE</span>
            <span className="text-[10px] text-gray-700">Flux disponible avec un robot physique</span>
          </div>
        ) : active && mjpegUrl ? (
          <img
            src={mjpegUrl}
            alt="Robot camera"
            className="w-full h-full object-cover"
            style={{ display: 'block' }}
            onLoad={() => { setStatus('LIVE'); resetStaleTimer(); }}
            onError={() => setStatus('CONNECTING')}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-700 text-xs font-mono">
            NO SIGNAL
          </div>
        )}

        {/* HUD overlay */}
        <div className="absolute inset-0 pointer-events-none">
          {/* Label top-left */}
          <div className="absolute top-2 left-2 text-[10px] font-mono text-white/60 bg-black/40 px-1.5 py-0.5 rounded">
            CAM/01
          </div>

          {/* LIVE badge top-right */}
          {status === 'LIVE' && (
            <div className="absolute top-2 right-2 flex items-center gap-1 text-[10px] font-mono text-green-400 bg-black/60 px-1.5 py-0.5 rounded">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              LIVE
            </div>
          )}

          {/* Crosshair */}
          {active && (
            <>
              <div className="absolute top-1/2 left-0 right-0 h-px bg-white/10" />
              <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/10" />
              <div
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 border border-white/25 rounded-sm"
                style={{ width: 20, height: 20 }}
              />
            </>
          )}
        </div>
      </div>

      {/* URL input + controls */}
      {!simulated && <div className="px-3 py-2 border-t border-gray-800 space-y-2">
        <div className="flex gap-1.5">
          <input
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            placeholder="MJPEG stream URL…"
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-[10px] font-mono text-gray-300 focus:outline-none focus:border-brand-500 min-w-0"
            onKeyDown={(e) => e.key === 'Enter' && handleLoad()}
          />
          {!active ? (
            <button
              onClick={handleLoad}
              disabled={!inputUrl.trim()}
              className="text-[10px] px-2.5 py-1 bg-brand-700 hover:bg-brand-600 text-white rounded disabled:opacity-40"
            >
              LOAD
            </button>
          ) : (
            <button
              onClick={handleStop}
              className="text-[10px] px-2.5 py-1 border border-gray-700 text-gray-400 hover:text-red-400 hover:border-red-800 rounded"
            >
              <XIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>}
    </div>
  );
}
