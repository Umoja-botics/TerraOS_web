import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useFleet } from '@/hooks/useFleet';
import { useCreateMission, useLoadMissionProfile, usePaths } from '@/hooks/useApi';
import { useMissionStore } from '@/store/missionStore';
import { MissionPanel } from '@/components/widgets/MissionPanel';
import { MissionPlannerModal, type MissionPlannerDraft } from '@/components/widgets/MissionPlannerModal';
import { GPSWidget } from '@/components/widgets/GPSWidget';
import { EventLog } from '@/components/widgets/EventLog';
import { DemoPanel } from '@/components/widgets/DemoPanel';
import { JoystickWidget } from '@/components/widgets/JoystickWidget';
import { CameraWidget } from '@/components/widgets/CameraWidget';
import { HealthWidget } from '@/components/widgets/HealthWidget';
import { ModeWidget } from '@/components/widgets/ModeWidget';
import { BatteryWidget } from '@/components/widgets/BatteryWidget';
import { BatteryFullIcon, EyeIcon, XIcon } from '@/components/icons';
import { usePresentationStore } from '@/store/presentationStore';
import { RobotMode } from '@terra-os/types';
import type { ImuData, Mission } from '@terra-os/types';
import clsx from 'clsx';

const MapWidget = lazy(() => import('@/components/widgets/MapWidget').then((m) => ({ default: m.MapWidget })));

// Keep in sync with TYPE_COLOR in MapWidget so selector dots match map markers.
const ROBOT_TYPE_COLOR: Record<string, string> = {
  ugv: '#00ff9d',
  cart: '#ff9a00',
  brouette: '#ff9a00',
  drone: '#a78bfa',
};

// ── IMU widget ────────────────────────────────────────────────────────────────
function ImuWidget({ imu }: { imu: ImuData | null }) {
  const deg = (r: number) => ((r * 180) / Math.PI).toFixed(1);
  return (
    <div className="card">
      <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">IMU</div>
      {imu ? (
        <div className="space-y-1 font-mono text-xs">
          {(['roll', 'pitch', 'yaw'] as const).map((axis) => (
            <div key={axis} className="flex justify-between">
              <span className="text-gray-500 uppercase">{axis}</span>
              <span className="text-gray-200">{deg(imu[axis])}°</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-gray-600 text-xs">—</div>
      )}
    </div>
  );
}

// ── Compact top status bar ────────────────────────────────────────────────────
function StatusBar({
  name,
  mode,
  battery,
  connected,
}: {
  name: string;
  mode: string | null;
  battery: number | null;
  connected: boolean;
}) {
  const modeColor: Record<string, string> = {
    STANDBY: 'text-gray-400',
    TELEOP: 'text-yellow-400',
    AUTONOMOUS: 'text-blue-400',
    ESTOP: 'text-red-400 animate-pulse',
    MISSION: 'text-blue-400',
    EMERGENCY_STOP: 'text-red-400 animate-pulse',
    MANUAL: 'text-yellow-400',
  };
  const battPct = battery !== null ? Math.round(battery * 100) : null;
  const battColor =
    battPct === null ? 'text-gray-600'
    : battPct > 25 ? 'text-green-400'
    : battPct > 10 ? 'text-orange-400'
    : 'text-red-400';

  return (
    <div className="flex items-center gap-4 px-3 py-1.5 bg-gray-900/60 border border-gray-800 rounded-lg text-xs font-mono">
      <span className="text-gray-300 font-semibold truncate max-w-[12rem]">{name}</span>
      <span className={clsx('w-2 h-2 rounded-full shrink-0', connected ? 'bg-green-500' : 'bg-gray-600')} />
      {mode && (
        <span className={clsx('uppercase tracking-wide', modeColor[mode] ?? 'text-gray-400')}>
          {mode}
        </span>
      )}
      {battPct !== null && (
        <span className={clsx('ml-auto', battColor)}>
          <span className="inline-flex items-center gap-1"><BatteryFullIcon className="w-3.5 h-3.5" />{battPct}%</span>
        </span>
      )}
    </div>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────
export function DashboardPage() {
  const { fleet, isLoading, selectedRobot, selectRobot } = useFleet();
  const [plannerOpen, setPlannerOpen] = useState(false);
  const createMission = useCreateMission();
  const loadMissionProfile = useLoadMissionProfile();
  const { data: paths = [] } = usePaths();
  const missionPhase = useMissionStore((s) => s.phase);
  const missionProfile = useMissionStore((s) => s.profile);
  const loadFromMission = useMissionStore((s) => s.loadFromMission);
  const presentation = usePresentationStore((s) => s.active);
  const setPresentation = usePresentationStore((s) => s.setActive);
  const pathById = useMemo(() => new Map(paths.map((path) => [path.id, path])), [paths]);
  const missionPathWaypoints = useMemo(() => {
    const agentConfigs = missionProfile?.agentConfigs ?? [];
    const pathId =
      agentConfigs.find((config) => config.agentId === 'ugv' && config.pathId)?.pathId ??
      agentConfigs.find((config) => config.pathId)?.pathId;
    return pathId ? pathById.get(pathId)?.waypoints : undefined;
  }, [missionProfile, pathById]);

  useEffect(() => {
    const syncFullscreen = () => {
      if (!document.fullscreenElement && usePresentationStore.getState().active) {
        setPresentation(false);
      }
    };
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, [setPresentation]);

  const enterPresentation = async () => {
    setPresentation(true);
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
      // CSS presentation mode remains available when native fullscreen is denied.
    }
  };

  const exitPresentation = async () => {
    setPresentation(false);
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
  };

  if (isLoading) {
    return <div className="text-gray-500 text-sm">Loading fleet…</div>;
  }

  const live      = selectedRobot?.live ?? null;
  const mode      = (live?.status?.mode as RobotMode) ?? null;
  const imu       = live?.telemetry?.imu ?? null;
  const velocity  = live?.telemetry?.velocity?.linear ?? 0;
  const health    = live?.health ?? null;
  const battery   = live?.status?.battery ?? null;
  const connected = live?.status?.connected ?? false;
  const plannerLocked = missionPhase === 'RUNNING' || missionPhase === 'PAUSED' || missionPhase === 'STANDBY';

  const openPlanner = () => {
    if (!selectedRobot || plannerLocked) return;
    createMission.reset();
    loadMissionProfile.reset();
    setPlannerOpen(true);
  };

  const handlePlannerLoad = (draft: MissionPlannerDraft) => {
    if (!selectedRobot || createMission.isPending) return;
    createMission.mutate(
      {
        robotId: selectedRobot.id,
        name: draft.name,
        navMode: draft.navMode,
        agentConfigs: draft.agentConfigs,
      },
      {
        onSuccess: (mission) => {
          loadMissionProfile.mutate(mission.id, {
            onSuccess: (loadedMission) => {
              loadFromMission(loadedMission);
              setPlannerOpen(false);
            },
          });
        },
      },
    );
  };

  const handlePlannerProfileLoad = (mission: Mission) => {
    if (loadMissionProfile.isPending) return;
    loadMissionProfile.mutate(mission.id, {
      onSuccess: (loadedMission) => {
        loadFromMission(loadedMission);
        setPlannerOpen(false);
      },
    });
  };

  return (
    <div className="flex flex-col gap-3 h-full">

      {presentation ? (
        <div className="h-9 shrink-0 flex items-center justify-between border-b border-gray-800 pb-2">
          <div className="flex items-center gap-2 text-xs font-mono text-gray-400">
            <EyeIcon className="w-4 h-4 text-brand-500" />
            MODE PRÉSENTATION
          </div>
          <button onClick={exitPresentation} className="flex items-center gap-1.5 text-xs px-2 py-1 border border-gray-700 rounded text-gray-300 hover:bg-gray-800" title="Quitter le mode présentation">
            <XIcon className="w-3.5 h-3.5" />Quitter
          </button>
        </div>
      ) : (
        <div className="flex justify-end">
          <button onClick={enterPresentation} className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-gray-700 rounded-md text-gray-400 hover:text-gray-100 hover:bg-gray-800 transition-colors" title="Afficher la démonstration en plein écran">
            <EyeIcon className="w-3.5 h-3.5" />Mode présentation
          </button>
        </div>
      )}

      {/* ── Robot selector ── */}
      {fleet.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto">
          {fleet.map((robot) => (
            <button
              key={robot.id}
              onClick={() => selectRobot(robot.id)}
              className={`shrink-0 flex items-center gap-1.5 text-xs px-3 py-1 rounded-md border font-mono transition-colors ${
                robot.id === selectedRobot?.id
                  ? 'border-brand-600 text-brand-500 bg-brand-900/20'
                  : 'border-gray-700 text-gray-400 hover:border-gray-600'
              }`}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: ROBOT_TYPE_COLOR[robot.type] ?? '#00ff9d' }}
              />
              {robot.name}
            </button>
          ))}
        </div>
      )}

      {/* ── Main layout: map + right panel ── */}
      <div className="flex flex-col xl:flex-row gap-3 flex-1 min-h-0">

        {/* Map — left */}
        <div className="xl:flex-[3] min-w-0 flex flex-col gap-3">
          <Suspense
            fallback={
              <div className="card flex-1 flex items-center justify-center text-gray-500 text-sm">
                Loading map…
              </div>
            }
          >
            <MapWidget fleet={fleet} selectedRobot={selectedRobot} pathWaypoints={missionPathWaypoints} />
          </Suspense>
        </div>

        {/* Right panel */}
        {selectedRobot ? (
          <div className="xl:flex-[2] min-w-0 flex flex-col gap-3 xl:overflow-y-auto">
            <button
              type="button"
              onClick={openPlanner}
              disabled={plannerLocked}
              title={plannerLocked ? 'Pause ou annule la mission active avant de charger une autre mission' : ''}
              className="btn-primary w-full text-xs py-2 tracking-wide disabled:opacity-40 disabled:cursor-not-allowed"
            >
              MISSION PLANNER
            </button>

            {/* Status bar */}
            <StatusBar
              name={selectedRobot.name}
              mode={mode}
              battery={battery}
              connected={connected}
            />

            <DemoPanel />

            <MissionPanel
              robotId={selectedRobot.id}
              health={health}
              velocity={velocity}
              showIdleSelector={false}
              title="Execution"
            />

            {/* 2-column grid */}
            <div className="grid grid-cols-2 gap-3 content-start">
              <div className="flex flex-col gap-3">
                <ModeWidget status={live?.status ?? null} />
                <div className="col-span-2">
                  <EventLog events={live?.events ?? []} />
                </div>
                <BatteryWidget battery={battery} />
              </div>

              <JoystickWidget robotId={selectedRobot.id} mode={mode} />
              <GPSWidget gps={live?.telemetry?.gps ?? null} />

              <ImuWidget imu={imu} />
              <HealthWidget health={health} />

              <div className="col-span-2">
                <CameraWidget bridgeUrl={selectedRobot.bridgeUrl ?? null} simulated={selectedRobot.isSimulated} />
              </div>

            </div>
          </div>
        ) : (
          <div className="flex-[2] flex items-center justify-center text-gray-600 text-sm">
            {fleet.length === 0 ? 'No robots registered.' : 'Select a robot.'}
          </div>
        )}
      </div>

      {plannerOpen && selectedRobot && (
        <MissionPlannerModal
          robotId={selectedRobot.id}
          robotGps={live?.telemetry?.gps ?? null}
          isLoading={createMission.isPending || loadMissionProfile.isPending}
          errorMessage={createMission.error || loadMissionProfile.error ? 'Impossible de charger la mission' : null}
          onLoad={handlePlannerLoad}
          onLoadProfile={handlePlannerProfileLoad}
          onClose={() => setPlannerOpen(false)}
        />
      )}
    </div>
  );
}
