import type { RobotStatusEvent } from '@terra-os/types';
import clsx from 'clsx';

const MODE_COLOR: Record<string, string> = {
  STANDBY: 'text-gray-400 border-gray-700 bg-gray-800/30',
  TELEOP: 'text-yellow-400 border-yellow-800 bg-yellow-900/30',
  AUTONOMOUS: 'text-blue-400 border-blue-800 bg-blue-900/30',
  ESTOP: 'text-red-400 border-red-800 bg-red-900/30 animate-pulse',
  MISSION: 'text-blue-400 border-blue-800 bg-blue-900/30',
  EMERGENCY_STOP: 'text-red-400 border-red-800 bg-red-900/30 animate-pulse',
  MANUAL: 'text-yellow-400 border-yellow-800 bg-yellow-900/30',
  ERROR: 'text-red-400 border-red-800 bg-red-900/30',
};

const SAFETY_COLOR: Record<string, string> = {
  OK: 'text-green-400',
  NOTIFICATION: 'text-blue-400',
  WARNING: 'text-orange-400',
  ERROR: 'text-red-400',
};

interface Props {
  status: RobotStatusEvent | null;
}

export function ModeWidget({ status }: Props) {
  const mode = status?.mode ?? '—';
  const safetyLevel = status?.safety_level ?? null;

  return (
    <div className="card">
      <div className="text-xs text-gray-500 mb-2 uppercase tracking-wide">Mode</div>
      <div
        className={clsx(
          'text-center py-3 rounded-lg border text-lg font-mono font-bold tracking-widest',
          MODE_COLOR[mode] ?? 'text-gray-400 border-gray-700',
        )}
      >
        {mode}
      </div>
      {safetyLevel && (
        <div className={clsx('text-xs font-mono mt-2 text-center', SAFETY_COLOR[safetyLevel])}>
          Safety: {safetyLevel}
        </div>
      )}
    </div>
  );
}
