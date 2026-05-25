import clsx from 'clsx';
import type { Robot } from '@terra-os/types';
import type { RobotLive } from '@/types/fleet';

interface Props {
  robot: Robot & { live: RobotLive | null };
  isSelected: boolean;
  onSelect: () => void;
}

const MODE_BADGE: Record<string, string> = {
  STANDBY: 'badge-offline',
  TELEOP: 'bg-yellow-900/50 text-yellow-400 border border-yellow-800',
  AUTONOMOUS: 'badge-running',
  ESTOP: 'badge-error',
  MISSION: 'badge-running',
  EMERGENCY_STOP: 'badge-error',
  MANUAL: 'bg-yellow-900/50 text-yellow-400 border border-yellow-800',
  ERROR: 'badge-error',
};

export function RobotCard({ robot, isSelected, onSelect }: Props) {
  const live = robot.live;
  const connected = live?.status?.connected ?? false;
  const mode = live?.status?.mode;
  const battery = live?.status?.battery;
  const gps = live?.telemetry?.gps ?? null;

  return (
    <button
      onClick={onSelect}
      className={clsx(
        'w-full text-left card transition-all cursor-pointer',
        isSelected ? 'border-brand-600 bg-brand-900/10' : 'hover:border-gray-700',
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium text-sm text-gray-100">{robot.name}</span>
        <span
          className={clsx(
            'text-xs px-2 py-0.5 rounded-full font-mono',
            connected ? 'badge-online' : 'badge-offline',
          )}
        >
          {connected ? 'ONLINE' : 'OFFLINE'}
        </span>
      </div>
      <div className="text-xs text-gray-500 space-y-1">
        <div>Type: {robot.type}</div>
        {mode && (
          <div className="flex items-center gap-2">
            Mode:{' '}
            <span className={clsx('text-xs px-1.5 py-0.5 rounded font-mono', MODE_BADGE[mode] ?? 'badge-offline')}>
              {mode}
            </span>
          </div>
        )}
        {battery !== null && battery !== undefined && (
          <div>Battery: {Math.round(battery * 100)}%</div>
        )}
        {gps && (
          <div className="font-mono">
            {gps.lat.toFixed(5)}, {gps.lon.toFixed(5)}
          </div>
        )}
      </div>
    </button>
  );
}
