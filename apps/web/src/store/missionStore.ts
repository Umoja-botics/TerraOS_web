import { create } from 'zustand';
import type { AgentConfig, Mission } from '@terra-os/types';

export type MissionPhase =
  | 'IDLE'
  | 'READY'
  | 'RUNNING'
  | 'PAUSED'
  | 'STANDBY'
  | 'COMPLETED'
  | 'ERROR'
  | 'ABORTED';

export interface MissionProfile {
  id:          string;
  name:        string;
  navMode:     string | null;
  agentIds:    string[];  // e.g. ['ugv', 'brouette']
  agentConfigs: AgentConfig[];
}

const SESSION_KEY = 'terraos:mission_profile';

interface MissionStoreState {
  phase:        MissionPhase;
  profile:      MissionProfile | null;
  /** ID of the active run (clone created by start()). Null when no run is active. */
  runId:        string | null;
  startedAt:    number | null;
  alarmMessage: string | null;
  isRecovering: boolean;

  setPhase:         (phase: MissionPhase) => void;
  loadFromMission:  (mission: Mission) => void;
  setRunId:         (id: string | null) => void;
  setAlarm:         (msg: string | null) => void;
  setRecovering:    (v: boolean) => void;
  reset:            () => void;
  restoreFromSession: () => MissionProfile | null;
}

export const useMissionStore = create<MissionStoreState>()((set) => ({
  phase:        'IDLE',
  profile:      null,
  runId:        null,
  startedAt:    null,
  alarmMessage: null,
  isRecovering: false,

  setPhase: (phase) =>
    set((s) => ({
      phase,
      startedAt: phase === 'RUNNING' && s.phase !== 'PAUSED' && s.phase !== 'STANDBY'
        ? (s.startedAt ?? Date.now())
        : s.startedAt,
    })),

  loadFromMission: (mission) => {
    const agentConfigs = mission.agentConfigs ?? parseAgentsJson(mission.agentsJson);
    const profile: MissionProfile = {
      id:           mission.id,
      name:         mission.name,
      navMode:      mission.navMode ?? null,
      agentIds:     agentConfigs?.map((a) => a.agentId) ?? ['ugv'],
      agentConfigs: agentConfigs ?? [],
    };
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(profile));
    } catch { /* ignore */ }
    set({ profile, runId: null, phase: 'READY', startedAt: null, alarmMessage: null });
  },

  setRunId: (id) => set({ runId: id }),

  setAlarm: (msg) => set({ alarmMessage: msg }),

  setRecovering: (v) => set({ isRecovering: v }),

  reset: () => {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch { /* ignore */ }
    set({ phase: 'IDLE', profile: null, runId: null, startedAt: null, alarmMessage: null, isRecovering: false });
  },

  restoreFromSession: () => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const profile = JSON.parse(raw) as MissionProfile;
      profile.agentConfigs ??= [];
      set({ profile, phase: 'READY', isRecovering: true });
      return profile;
    } catch {
      return null;
    }
  },
}));

function parseAgentsJson(raw?: string | null): AgentConfig[] | null {
  if (!raw) return null;
  try {
    const agents = JSON.parse(raw) as Array<Partial<AgentConfig> & { id?: AgentConfig['agentId'] }>;
    return agents.map((agent) => ({
      agentId: (agent.agentId ?? agent.id) as AgentConfig['agentId'],
      ...(agent.pathId ? { pathId: agent.pathId } : {}),
      ...(agent.task ? { task: agent.task } : {}),
    }));
  } catch {
    return null;
  }
}
