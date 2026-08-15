import { useFleetStore } from '@/store/fleetStore';
import { useRobots } from '@/hooks/useApi';
import clsx from 'clsx';
import { RadioTowerIcon } from '@/components/icons';

const SAFETY_COLOR: Record<string, string> = {
  OK:      'text-green-400',
  NOTIFICATION: 'text-blue-400',
  WARNING: 'text-yellow-400',
  ERROR:   'text-red-400',
};

export function StatusBar() {
  const robots          = useFleetStore((s) => s.robots);
  const selectedId      = useFleetStore((s) => s.selectedRobotId);
  const simMode         = useFleetStore((s) => s.simMode);
  const selectedLive    = selectedId ? robots[selectedId] : null;
  const { data: registry = [] } = useRobots();
  const selectedSim     = !!registry.find((r) => r.id === selectedId)?.isSimulated;

  const connectedCount  = Object.values(robots).filter((r) => r.status?.connected).length;
  const total           = Object.keys(robots).length;

  const mode    = selectedLive?.status?.mode    ?? null;
  const safety  = selectedLive?.health?.level   ?? null;
  const battery = selectedLive?.status?.battery ?? null;
  const batteryPct = battery !== null ? Math.round(battery * 100) : null;

  return (
    <footer className="divider-status h-8 shrink-0 overflow-hidden bg-gray-900 flex items-center px-3 md:px-6 gap-4 md:gap-6 text-xs font-mono text-gray-500 whitespace-nowrap">
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

      {(simMode || selectedSim) && (
        <>
          <span className="text-gray-700">|</span>
          <span className="flex items-center gap-1 text-amber-400 font-semibold tracking-wider"><RadioTowerIcon className="w-3.5 h-3.5" />SIMULATION</span>
        </>
      )}

      <span className="ml-auto hidden lg:inline text-gray-700">TerraOS v0.1.0</span>
    </footer>
  );
}
