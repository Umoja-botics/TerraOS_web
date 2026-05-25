import clsx from 'clsx';
import type { MissionUpdateEvent } from '@terra-os/types';
import { useStartMission, usePauseMission, useAbortMission } from '@/hooks/useApi';

const STATE_BADGE: Record<string, string> = {
  RUNNING: 'badge-running',
  PAUSED: 'bg-yellow-900/50 text-yellow-400 border border-yellow-800',
  COMPLETED: 'badge-online',
  IDLE: 'badge-offline',
  ABORTED: 'badge-error',
  ERROR: 'badge-error',
};

interface Props {
  mission: MissionUpdateEvent | null;
  missionId?: string | null;
}

export function MissionWidget({ mission, missionId }: Props) {
  const startMission = useStartMission();
  const pauseMission = usePauseMission();
  const abortMission = useAbortMission();

  const pct = mission && mission.totalWp > 0
    ? Math.round((mission.currentWp / mission.totalWp) * 100)
    : 0;

  if (!mission && !missionId) {
    return (
      <div className="card">
        <div className="text-xs text-gray-500 mb-2 uppercase tracking-wide">Mission</div>
        <div className="text-gray-600 text-xs">No active mission</div>
      </div>
    );
  }

  const id = missionId ?? null;

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500 uppercase tracking-wide">Mission</span>
        {mission?.state && (
          <span className={clsx('text-xs px-2 py-0.5 rounded-full font-mono', STATE_BADGE[mission.state] ?? 'badge-offline')}>
            {mission.state}
          </span>
        )}
      </div>

      {mission && (
        <>
          <div className="text-xs font-mono text-gray-400">
            {mission.navMode} · WP {mission.currentWp}/{mission.totalWp}
          </div>

          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Progress</span>
              <span>{pct}%</span>
            </div>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
              <div
                className={clsx(
                  'h-full rounded-full transition-all',
                  mission.state === 'RUNNING' ? 'bg-blue-500' : 'bg-gray-600',
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          {mission.error && (
            <div className="text-xs text-red-400 bg-red-900/20 border border-red-800 rounded p-2">
              {mission.error}
            </div>
          )}
        </>
      )}

      {id && (
        <div className="flex gap-2">
          {(!mission || mission.state === 'IDLE') && (
            <button
              onClick={() => startMission.mutate(id)}
              disabled={startMission.isPending}
              className="btn-primary text-xs py-1 flex-1"
            >
              Start
            </button>
          )}
          {mission?.state === 'RUNNING' && (
            <>
              <button
                onClick={() => pauseMission.mutate(id)}
                disabled={pauseMission.isPending}
                className="btn-secondary text-xs py-1 flex-1"
              >
                Pause
              </button>
              <button
                onClick={() => abortMission.mutate(id)}
                disabled={abortMission.isPending}
                className="bg-red-800 hover:bg-red-700 text-white text-xs py-1 px-3 rounded-md transition-colors"
              >
                Abort
              </button>
            </>
          )}
          {mission?.state === 'PAUSED' && (
            <>
              <button
                onClick={() => startMission.mutate(id)}
                disabled={startMission.isPending}
                className="btn-primary text-xs py-1 flex-1"
              >
                Resume
              </button>
              <button
                onClick={() => abortMission.mutate(id)}
                disabled={abortMission.isPending}
                className="bg-red-800 hover:bg-red-700 text-white text-xs py-1 px-3 rounded-md transition-colors"
              >
                Abort
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
