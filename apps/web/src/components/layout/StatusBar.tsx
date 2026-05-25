import { useFleetStore } from '@/store/fleetStore';
import clsx from 'clsx';

const SAFETY_COLOR: Record<string, string> = {
  OK:      'text-green-400',
  NOTIFICATION: 'text-blue-400',
  WARNING: 'text-yellow-400',
  ERROR:   'text-red-400',
};

export function StatusBar() {
  const robots          = useFleetStore((s) => s.robots);
  const selectedId      = useFleetStore((s) => s.selectedRobotId);
  const selectedLive    = selectedId ? robots[selectedId] : null;

  const connectedCount  = Object.values(robots).filter((r) => r.status?.connected).length;
  const total           = Object.keys(robots).length;

  const mode    = selectedLive?.status?.mode    ?? null;
  const safety  = selectedLive?.health?.level   ?? null;
  const battery = selectedLive?.status?.battery ?? null;
  const batteryPct = battery !== null ? Math.round(battery * 100) : null;

  return (
    <footer className="h-8 bg-gray-900 border-t border-gray-800 flex items-center px-6 gap-6 text-xs font-mono text-gray-500">
      <span>
        Robots:{' '}
        <span className={clsx(connectedCount > 0 ? 'text-green-400' : 'text-gray-400')}>
          {connectedCount}/{total} connected
        </span>
      </span>

      {mode && (
        <>
          <span className="text-gray-700">|</span>
          <span>
            MODE <span className="text-brand-400">{mode}</span>
          </span>
        </>
      )}

      {safety && (
        <>
          <span className="text-gray-700">|</span>
          <span className={SAFETY_COLOR[safety] ?? 'text-gray-400'}>
            {safety}
          </span>
        </>
      )}

      {batteryPct !== null && (
        <>
          <span className="text-gray-700">|</span>
          <span className={clsx(batteryPct < 20 ? 'text-red-400' : batteryPct < 40 ? 'text-yellow-400' : 'text-gray-300')}>
            BAT {batteryPct}%
          </span>
        </>
      )}

      <span className="ml-auto text-gray-700">TerraOS v0.1.0</span>
    </footer>
  );
}
