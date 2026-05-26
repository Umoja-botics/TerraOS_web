import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { useMissionStore, type MissionPhase } from '@/store/missionStore';
import { useFleetStore, SIM_ROBOT_ID } from '@/store/fleetStore';
import {
  useMissions,
  useStartMission,
  usePauseMission,
  useResumeMission,
  useResumeMissionFromStandby,
  useAbortMission,
  useCancelLoadedMission,
  useCompleteMission,
  useFailMission,
} from '@/hooks/useApi';
import { MissionStatus } from '@terra-os/types';
import type { AgentStatusEvent } from '@terra-os/types';

const AGENT_META: Record<string, { label: string; color: string }> = {
  ugv:      { label: 'UGV',      color: '#00ff9d' },
  brouette: { label: 'Brouette', color: '#ff9a00' },
  drone:    { label: 'Drone',    color: '#a78bfa' },
};

const PHASE_BADGE: Record<MissionPhase, string> = {
  IDLE:      'bg-gray-800 text-gray-500',
  READY:     'bg-yellow-900/40 text-yellow-400 border border-yellow-700',
  RUNNING:   'bg-green-900/40 text-green-400 border border-green-800',
  PAUSED:    'bg-orange-900/30 text-orange-300 border border-orange-700',
  STANDBY:   'bg-orange-900/40 text-orange-400 border border-orange-800',
  COMPLETED: 'bg-green-900/40 text-green-400 border border-green-800',
  ERROR:     'bg-red-900/40 text-red-400 border border-red-800',
  ABORTED:   'bg-red-900/40 text-red-400 border border-red-800',
};

function useUptime(startedAt: number | null): string {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  if (!startedAt) return '00:00';
  const secs = Math.floor((now - startedAt) / 1000);
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

interface Props {
  robotId: string | null;
  health: { level: string; faults: { msg: string }[] } | null;
  velocity: number;
  showIdleSelector?: boolean;
  title?: string;
}

export function MissionPanel({ robotId, health, velocity, showIdleSelector = true, title = 'Mission' }: Props) {
  const { phase, profile, runId, startedAt, alarmMessage, isRecovering, setPhase, setAlarm, setRecovering, reset, loadFromMission, setRunId, restoreFromSession } =
    useMissionStore();
  // Use the run's ID (clone) for lifecycle calls once a run is active
  const activeId = runId ?? profile?.id ?? null;
  const simMode = useFleetStore((s) => s.simMode);
  const agents = useFleetStore((s) => robotId ? (s.robots[robotId]?.agents ?? {}) : {});
  const ugvMission = useFleetStore((s) => robotId ? (s.robots[robotId]?.mission ?? null) : null);
  const robotMode = useFleetStore((s) => robotId ? ((s.robots[robotId]?.status as unknown as Record<string, unknown>)?.mode as string ?? null) : null);
  const estopActive = robotMode === 'ESTOP' || robotMode === 'EMERGENCY_STOP';
  const uptime  = useUptime(startedAt);

  // ── Session recovery on mount ────────────────────────────────────────────
  useEffect(() => {
    if (phase === 'IDLE') restoreFromSession();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch IDLE profiles for this robot
  const { data: allMissions = [] } = useMissions(robotId ?? undefined);
  const idleProfiles = allMissions.filter((m) => m.status === MissionStatus.IDLE);

  // ── Auto-select sim mission when sim mode activates ───────────────────────
  useEffect(() => {
    if (simMode && robotId === SIM_ROBOT_ID && phase === 'IDLE' && idleProfiles.length > 0 && !profile) {
      loadFromMission(idleProfiles[0]);
    }
  }, [simMode, robotId, idleProfiles.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const startMission  = useStartMission();
  const pauseMission  = usePauseMission();
  const resumeMission = useResumeMission();
  const resumeFromStandby = useResumeMissionFromStandby();
  const abortMission  = useAbortMission();
  const cancelLoadedMission = useCancelLoadedMission();
  const completeMission = useCompleteMission();
  const failMission = useFailMission();

  // ── Safety transitions from Faucon health ────────────────────────────────
  useEffect(() => {
    if (!health) return;
    const faultMessage = health.faults.map((f) => f.msg).join(' · ') || health.level;
    if (phase === 'RUNNING' && (health.level === 'WARNING' || health.level === 'ERROR')) {
      setPhase('STANDBY');
      setAlarm(faultMessage);
    }
    if (phase === 'STANDBY' && !estopActive && (health.level === 'OK' || health.level === 'NOTIFICATION')) {
      setAlarm(null);
    }
  }, [health, phase, estopActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── E-Stop mode → hold mission, do not cancel navigation ─────────────────
  useEffect(() => {
    if (estopActive && ['READY', 'RUNNING', 'PAUSED', 'STANDBY'].includes(phase)) {
      setAlarm('E-Stop actif');
      if (phase === 'RUNNING') {
        setPhase('STANDBY');
      }
    }
    if (!estopActive && alarmMessage?.toLowerCase().includes('e-stop')) {
      setAlarm(null);
    }
  }, [estopActive, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-COMPLETED when all active agents done ───────────────────────────
  useEffect(() => {
    if (phase !== 'RUNNING' || !profile) return;
    const ids = profile.agentIds;
    if (ids.length === 0) return;
    const agentState = (id: string) => (
      id === 'ugv'
        ? ((agents[id] as AgentStatusEvent | undefined)?.state ?? ugvMission?.state)
        : (agents[id] as AgentStatusEvent | undefined)?.state
    );
    const allDone  = ids.every((id) => agentState(id) === 'COMPLETED');
    const anyError = ids.some((id) => {
      const state = agentState(id);
      return state === 'ERROR' || state === 'ABORTED';
    });
    if (allDone) {
      setPhase('COMPLETED');
      if (activeId) completeMission.mutate(activeId);
    } else if (anyError) {
      setPhase('ERROR');
      if (activeId) failMission.mutate(activeId);
    }
  }, [agents, ugvMission, phase, profile, activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Session recovery banner dismiss ─────────────────────────────────────
  useEffect(() => {
    if (isRecovering) {
      const t = setTimeout(() => setRecovering(false), 4000);
      return () => clearTimeout(t);
    }
  }, [isRecovering]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── UGV progress bar ──────────────────────────────────────────────────────
  const ugvAgent = agents['ugv'] as AgentStatusEvent | undefined;
  const ugvCurrentWp = ugvAgent?.currentWp ?? ugvMission?.currentWp ?? 0;
  const ugvTotalWp = ugvAgent?.totalWp ?? ugvMission?.totalWp ?? 0;
  const ugvState = ugvAgent?.state ?? ugvMission?.state;
  const ugvPct   = ugvTotalWp > 0
    ? Math.round((ugvCurrentWp / ugvTotalWp) * 100)
    : 0;

  if (!showIdleSelector && phase === 'IDLE' && !profile && !isRecovering) {
    return null;
  }

  return (
    <div className="card space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500 uppercase tracking-wide">{title}</span>
        <span className={clsx('text-xs px-2 py-0.5 rounded-full font-mono', PHASE_BADGE[phase])}>
          {phase === 'RUNNING' ? (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              {phase}
            </span>
          ) : phase}
        </span>
      </div>

      {/* Recovery banner */}
      {isRecovering && (
        <div className="text-xs text-yellow-400 bg-yellow-900/20 border border-yellow-800 rounded px-2 py-1">
          ↻ Reconnexion en cours…
        </div>
      )}

      {/* ── IDLE: mission selector ── */}
      {showIdleSelector && phase === 'IDLE' && (
        <div className="space-y-2">
          {idleProfiles.length === 0 ? (
            <div className="text-xs text-gray-600 text-center py-2 space-y-1">
              <div>Aucun profil.</div>
              <div className="flex gap-3 justify-center">
                <Link to="/missions" className="text-brand-400 hover:underline">Bibliothèque →</Link>
              </div>
            </div>
          ) : (
            <>
              <label className="text-xs text-gray-500">Profil de mission</label>
              <select
                defaultValue=""
                onChange={(e) => {
                  const m = idleProfiles.find((p) => p.id === e.target.value);
                  if (m) loadFromMission(m);
                }}
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-brand-500"
              >
                <option value="" disabled>Choisir un profil…</option>
                {idleProfiles.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}{m.navMode ? ` · ${m.navMode}` : ''}
                  </option>
                ))}
              </select>
              <div className="flex justify-between text-[10px] text-gray-600">
                <Link to="/missions" className="hover:text-brand-400">Gérer les profils →</Link>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── READY / active: profile info ── */}
      {profile && phase !== 'IDLE' && (
        <>
          <div className="text-xs font-mono text-gray-400 truncate">{profile.name}</div>

          {/* Per-agent rows */}
          {profile.agentIds.map((agentId) => {
            const st   = agents[agentId] as AgentStatusEvent | undefined;
            const meta = AGENT_META[agentId] ?? { label: agentId, color: '#888' };
            return (
              <div key={agentId} className="flex items-center gap-2 text-xs">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: meta.color }} />
                <span className="text-gray-400 w-16 shrink-0">{meta.label}</span>
                {st || (agentId === 'ugv' && ugvMission) ? (
                  <>
                    <span className="text-gray-500 font-mono">
                      {agentId === 'ugv' ? ugvCurrentWp : st?.currentWp}/{agentId === 'ugv' ? ugvTotalWp : st?.totalWp} wp
                    </span>
                    <span
                      className="ml-auto font-mono px-1.5 py-0.5 rounded text-[10px]"
                      style={{ color: meta.color, background: meta.color + '18' }}
                    >
                      {agentId === 'ugv' ? ugvState : st?.state}
                    </span>
                  </>
                ) : (
                  <span className="text-gray-700 ml-auto">—</span>
                )}
              </div>
            );
          })}

          {/* UGV progress bar */}
          {ugvTotalWp > 0 && (
            <div>
              <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                <span>UGV progress</span>
                <span>{ugvPct}%</span>
              </div>
              <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all bg-brand-500"
                  style={{ width: `${ugvPct}%` }}
                />
              </div>
            </div>
          )}

          {/* Speed + uptime */}
          {phase !== 'READY' && (
            <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
              <div className="bg-gray-800/60 rounded px-2 py-1">
                <span className="text-gray-500">SPEED </span>
                <span className={clsx(velocity > 0 ? 'text-green-400' : velocity < 0 ? 'text-orange-400' : 'text-gray-400')}>
                  {velocity.toFixed(2)} m/s
                </span>
              </div>
              <div className="bg-gray-800/60 rounded px-2 py-1">
                <span className="text-gray-500">UPTIME </span>
                <span className="text-gray-300">{uptime}</span>
              </div>
            </div>
          )}
        </>
      )}

      {/* Safety alarm */}
      {['READY', 'PAUSED', 'STANDBY'].includes(phase) && alarmMessage && (
        <div className="text-xs text-orange-400 bg-orange-900/20 border border-orange-800 rounded px-2 py-1.5">
          ⚠ {alarmMessage}
        </div>
      )}

      {/* ── Control buttons ── */}
      <div className="space-y-1.5">
        {phase === 'READY' && profile && (
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() =>
                startMission.mutate(profile.id, {
                  onSuccess: (run) => {
                    setRunId(run.id);
                    setPhase('RUNNING');
                  },
                })
              }
              disabled={startMission.isPending || !!alarmMessage || estopActive}
              className="btn-primary text-xs py-1.5 disabled:opacity-40"
              title={alarmMessage ? 'Lever l’alarme avant de lancer' : ''}
            >
              ▶ START
            </button>
            <button
              onClick={() => {
                if (!profile?.id) return reset();
                cancelLoadedMission.mutate(profile.id, { onSuccess: reset });
              }}
              disabled={cancelLoadedMission.isPending}
              className="text-xs py-1.5 border border-red-800 text-red-400 rounded-md hover:bg-red-900/20"
            >
              ✕ CANCEL
            </button>
          </div>
        )}

        {phase === 'RUNNING' && activeId && (
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() =>
                pauseMission.mutate(activeId, { onSuccess: () => setPhase('PAUSED') })
              }
              disabled={pauseMission.isPending}
              className="btn-secondary text-xs py-1.5 disabled:opacity-40"
            >
              ⏸ PAUSE
            </button>
            <button
              onClick={() =>
                abortMission.mutate(activeId, {
                  onSuccess: reset,
                })
              }
              disabled={abortMission.isPending}
              className="text-xs py-1.5 border border-red-800 text-red-400 rounded-md hover:bg-red-900/20 disabled:opacity-40"
            >
              ✕ CANCEL
            </button>
          </div>
        )}

        {phase === 'PAUSED' && activeId && (
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() =>
                resumeMission.mutate(activeId, { onSuccess: () => setPhase('RUNNING') })
              }
              disabled={resumeMission.isPending || !!alarmMessage || estopActive}
              className="btn-primary text-xs py-1.5 disabled:opacity-40"
              title={alarmMessage ? 'Lever l’alarme avant de reprendre' : ''}
            >
              ▶▶ RESUME
            </button>
            <button
              onClick={() =>
                abortMission.mutate(activeId, {
                  onSuccess: reset,
                })
              }
              disabled={abortMission.isPending}
              className="text-xs py-1.5 border border-red-800 text-red-400 rounded-md hover:bg-red-900/20 disabled:opacity-40"
            >
              ✕ CANCEL
            </button>
          </div>
        )}

        {phase === 'STANDBY' && (
          <div className="space-y-1.5">
            <button
              onClick={() => {
                if (!activeId) return;
                resumeFromStandby.mutate(activeId, {
                  onSuccess: () => {
                    setPhase('RUNNING');
                    setAlarm(null);
                  },
                });
              }}
              disabled={!!alarmMessage || estopActive || !activeId || resumeFromStandby.isPending}
              className="btn-primary w-full text-xs py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              title={alarmMessage ? 'Lever l’alarme avant de reprendre' : ''}
            >
              ▶ REPRENDRE
            </button>
            {activeId && (
              <button
                onClick={() =>
                  abortMission.mutate(activeId, {
                    onSuccess: reset,
                  })
                }
                className="w-full text-xs py-1.5 border border-red-800 text-red-400 rounded-md hover:bg-red-900/20"
              >
                ✕ CANCEL
              </button>
            )}
          </div>
        )}

        {(phase === 'COMPLETED' || phase === 'ERROR' || phase === 'ABORTED') && (
          <button onClick={reset} className="btn-secondary w-full text-xs py-1.5">
            ↺ New mission
          </button>
        )}
      </div>
    </div>
  );
}
