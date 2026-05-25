import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useMissions, usePaths } from '@/hooks/useApi';
import { MissionStatus, NavMode } from '@terra-os/types';
import type { AgentConfig, AgentTask, GpsPosition, Mission, Path } from '@terra-os/types';

type AgentId = AgentConfig['agentId'];

interface AgentMeta {
  label: string;
  color: string;
  minWp: number;
}

interface AgentPlannerState {
  enabled: boolean;
  pathId: string;
  task: AgentTask;
}

export interface MissionPlannerDraft {
  name: string;
  navMode: NavMode;
  agentConfigs: AgentConfig[];
}

interface Props {
  robotId: string;
  robotGps: GpsPosition | null;
  isLoading?: boolean;
  errorMessage?: string | null;
  onLoad: (draft: MissionPlannerDraft) => void;
  onLoadProfile: (mission: Mission) => void;
  onClose: () => void;
}

const AGENT_IDS: AgentId[] = ['ugv', 'brouette', 'drone'];

const AGENT_META: Record<AgentId, AgentMeta> = {
  ugv:      { label: 'UGV',      color: '#00ff9d', minWp: 2 },
  brouette: { label: 'Brouette', color: '#ff9a00', minWp: 1 },
  drone:    { label: 'Drone',    color: '#a78bfa', minWp: 0 },
};

const TASK_OPTIONS: Record<AgentId, Array<{ value: AgentTask; label: string }>> = {
  ugv: [
    { value: 'follow_path',   label: 'Follow Path' },
    { value: 'goto_waypoint', label: 'Go To Waypoint' },
  ],
  brouette: [
    { value: 'follow_path',   label: 'Follow Path' },
    { value: 'goto_waypoint', label: 'Go To Waypoint' },
  ],
  drone: [
    { value: 'follow_waypoints', label: 'Waypoints' },
    { value: 'inspection',       label: 'Inspection' },
  ],
};

const MAP_TILE = 'https://{s}.basemaps.cartocdn.com/dark_matter/{z}/{x}/{y}{r}.png';

function defaultAgents(): Record<AgentId, AgentPlannerState> {
  return {
    ugv:      { enabled: true,  pathId: '', task: 'follow_path' },
    brouette: { enabled: false, pathId: '', task: 'follow_path' },
    drone:    { enabled: false, pathId: '', task: 'follow_waypoints' },
  };
}

function pathNavModeForTask(task: AgentTask): NavMode {
  return task === 'goto_waypoint' ? NavMode.GOTO_WAYPOINT : NavMode.FOLLOW_WAYPOINTS;
}

function pathsForAgent(agentId: AgentId, task: AgentTask, paths: Path[]): Path[] {
  if (agentId === 'drone') return paths;
  return paths.filter((path) => path.navMode === pathNavModeForTask(task));
}

function robotIcon() {
  return L.divIcon({
    html: '<div style="width:12px;height:12px;border-radius:50%;background:#00ff9d;border:2px solid #f8fafc;box-shadow:0 0 10px #00ff9d;"></div>',
    className: '',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
}

function waypointIcon(color: string, index: number) {
  return L.divIcon({
    html: `<div style="min-width:18px;height:18px;border-radius:9px;background:${color};color:#0a0f12;border:1px solid #f8fafc;font-size:10px;font-weight:700;line-height:17px;text-align:center;box-shadow:0 0 8px ${color}66;">${index + 1}</div>`,
    className: '',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function FitPreview({ points }: { points: [number, number][] }) {
  const map = useMap();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      map.invalidateSize();
      if (points.length > 1) {
        map.fitBounds(points, { padding: [24, 24], maxZoom: 18 });
      } else if (points.length === 1) {
        map.setView(points[0], 17);
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, [map, points]);

  return null;
}

export function MissionPlannerModal({
  robotId,
  robotGps,
  isLoading = false,
  errorMessage,
  onLoad,
  onLoadProfile,
  onClose,
}: Props) {
  const { data: paths = [], isLoading: pathsLoading } = usePaths();
  const { data: missions = [], isLoading: missionsLoading } = useMissions(robotId);
  const [missionName, setMissionName] = useState(() => `mission_${Date.now()}`);
  const [agents, setAgents] = useState<Record<AgentId, AgentPlannerState>>(defaultAgents);
  const [selectedMissionId, setSelectedMissionId] = useState('');

  const pathById = useMemo(() => new Map(paths.map((path) => [path.id, path])), [paths]);

  const selectedAgentIds = AGENT_IDS.filter((id) => agents[id].enabled);
  const missionProfiles = useMemo(
    () => missions.filter((mission) => mission.status === MissionStatus.IDLE),
    [missions],
  );
  const selectedMission = useMemo(
    () => missionProfiles.find((mission) => mission.id === selectedMissionId) ?? null,
    [missionProfiles, selectedMissionId],
  );

  const selectedLines = useMemo(() => (
    AGENT_IDS.flatMap((id) => {
      const state = agents[id];
      const path = state.enabled && state.pathId ? pathById.get(state.pathId) : null;
      if (!path || path.waypoints.length === 0) return [];
      return [{
        id,
        label: AGENT_META[id].label,
        color: AGENT_META[id].color,
        points: path.waypoints.map((wp) => [wp.lat, wp.lon] as [number, number]),
      }];
    })
  ), [agents, pathById]);

  const selectedProfileLines = useMemo(() => (
    selectedMission?.agentConfigs?.flatMap((config) => {
      const path = config.pathId ? pathById.get(config.pathId) : null;
      if (!path || path.waypoints.length === 0) return [];
      return [{
        id: config.agentId,
        label: AGENT_META[config.agentId].label,
        color: AGENT_META[config.agentId].color,
        points: path.waypoints.map((wp) => [wp.lat, wp.lon] as [number, number]),
      }];
    }) ?? []
  ), [pathById, selectedMission]);

  const previewLines = selectedMission ? selectedProfileLines : selectedLines;

  const mapPoints = useMemo(() => {
    const pathPoints = previewLines.flatMap((line) => line.points);
    return robotGps ? [[robotGps.lat, robotGps.lon] as [number, number], ...pathPoints] : pathPoints;
  }, [previewLines, robotGps]);

  const center: [number, number] = robotGps ? [robotGps.lat, robotGps.lon] : [48.8566, 2.3522];

  const setAgentField = <K extends keyof AgentPlannerState>(
    id: AgentId,
    field: K,
    value: AgentPlannerState[K],
  ) => {
    setAgents((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };

  const setAgentTask = (id: AgentId, task: AgentTask) => {
    setAgents((prev) => ({ ...prev, [id]: { ...prev[id], task, pathId: '' } }));
  };

  const isInspection = (id: AgentId) => id === 'drone' && agents[id].task === 'inspection';

  const isAgentValid = (id: AgentId) => {
    const state = agents[id];
    if (!state.enabled) return false;
    if (isInspection(id)) return true;
    if (!state.pathId) return false;
    const path = pathById.get(state.pathId);
    return !!path && path.waypoints.length >= AGENT_META[id].minWp;
  };

  const canLoad =
    Boolean(missionName.trim()) &&
    selectedAgentIds.length > 0 &&
    selectedAgentIds.every((id) => isAgentValid(id)) &&
    !isLoading;

  const resolveNavMode = (): NavMode => {
    const ugv = agents.ugv.enabled && agents.ugv.pathId ? pathById.get(agents.ugv.pathId) : null;
    if (ugv) return ugv.navMode;
    const firstPath = selectedAgentIds
      .map((id) => agents[id].pathId)
      .filter(Boolean)
      .map((pathId) => pathById.get(pathId))
      .find(Boolean);
    return firstPath?.navMode ?? NavMode.FOLLOW_WAYPOINTS;
  };

  const loadMission = () => {
    if (!canLoad) return;
    const agentConfigs: AgentConfig[] = selectedAgentIds.map((agentId) => {
      const state = agents[agentId];
      return {
        agentId,
        ...(state.pathId ? { pathId: state.pathId } : {}),
        task: state.task,
      };
    });

    onLoad({
      name: missionName.trim(),
      navMode: resolveNavMode(),
      agentConfigs,
    });
  };

  const loadSelectedProfile = () => {
    if (!selectedMission) return;
    onLoadProfile(selectedMission);
  };

  return (
    <div className="fixed inset-0 z-[5000] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[92vh] overflow-hidden rounded-lg border border-gray-800 bg-gray-950 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-200">MISSION PLANNER</div>
          <button
            type="button"
            onClick={onClose}
            className="h-7 w-7 rounded-md border border-gray-800 text-gray-500 hover:border-gray-700 hover:text-gray-200"
            aria-label="Fermer"
          >
            x
          </button>
        </div>

        <div className="h-44 border-b border-gray-800 bg-gray-900">
          <MapContainer
            center={center}
            zoom={robotGps ? 17 : 5}
            className="h-full w-full"
            zoomControl={false}
            attributionControl={false}
            style={{ background: '#111827' }}
          >
            <TileLayer url={MAP_TILE} maxZoom={22} subdomains={['a', 'b', 'c', 'd']} />
            <FitPreview points={mapPoints} />

            {previewLines.map((line) => (
              <Polyline
                key={line.id}
                positions={line.points}
                color={line.color}
                weight={3}
                opacity={0.9}
                dashArray="6 4"
              />
            ))}

            {previewLines.flatMap((line) => (
              line.points.map((point, index) => (
                <Marker
                  key={`${line.id}:${index}`}
                  position={point}
                  icon={waypointIcon(line.color, index)}
                />
              ))
            ))}

            {robotGps && <Marker position={[robotGps.lat, robotGps.lon]} icon={robotIcon()} />}
          </MapContainer>
        </div>

        <div className="max-h-[calc(92vh-14rem)] overflow-y-auto p-4">
          <div className="space-y-4">
            <div className="rounded-md border border-gray-800 bg-gray-900/60 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <label className="text-xs uppercase tracking-wide text-gray-500">Mission pre etablie</label>
                {missionsLoading && <span className="text-[11px] text-gray-600">Chargement...</span>}
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_10rem]">
                <select
                  value={selectedMissionId}
                  onChange={(event) => setSelectedMissionId(event.target.value)}
                  className="w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-100 focus:outline-none focus:border-brand-500"
                >
                  <option value="">Selectionner une mission</option>
                  {missionProfiles.map((mission) => (
                    <option key={mission.id} value={mission.id}>
                      {mission.name} ({mission.agentConfigs?.length ?? 0} agents)
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={loadSelectedProfile}
                  disabled={!selectedMission}
                  className="btn-primary px-3 py-1.5 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Charger
                </button>
              </div>
              {missionProfiles.length === 0 && !missionsLoading && (
                <div className="mt-2 text-[11px] text-gray-600">Aucune mission pre etablie</div>
              )}
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wide text-gray-500 mb-1">Nom de mission</label>
              <input
                value={missionName}
                onChange={(event) => setMissionName(event.target.value)}
                className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-500"
              />
            </div>

            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wide text-gray-500">Agents</div>
              {AGENT_IDS.map((id) => {
                const meta = AGENT_META[id];
                const state = agents[id];
                const compatiblePaths = pathsForAgent(id, state.task, paths);
                const selectedPath = state.pathId ? pathById.get(state.pathId) : null;
                const waypointWarning =
                  selectedPath && selectedPath.waypoints.length < meta.minWp
                    ? `Minimum ${meta.minWp} wp requis`
                    : null;

                return (
                  <div
                    key={id}
                    className="rounded-md border border-gray-800 bg-gray-900/60 p-3"
                    style={{ borderLeftColor: state.enabled ? meta.color : undefined, borderLeftWidth: 3 }}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={state.enabled}
                        onChange={() => setAgentField(id, 'enabled', !state.enabled)}
                        className="accent-brand-500"
                      />
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: meta.color }} />
                      <span className="w-20 text-sm font-semibold text-gray-200">{meta.label}</span>
                    </div>

                    {state.enabled && (
                      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[10rem_1fr]">
                        <select
                          value={state.task}
                          onChange={(event) => setAgentTask(id, event.target.value as AgentTask)}
                          className="rounded-md border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-100 focus:outline-none focus:border-brand-500"
                        >
                          {TASK_OPTIONS[id].map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>

                        {!isInspection(id) ? (
                          <div className="space-y-1">
                            <select
                              value={state.pathId}
                              onChange={(event) => setAgentField(id, 'pathId', event.target.value)}
                              className="w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-100 focus:outline-none focus:border-brand-500"
                            >
                              <option value="">Choisir un path</option>
                              {compatiblePaths.map((path) => (
                                <option key={path.id} value={path.id}>
                                  {path.name} ({path.waypoints.length} wp)
                                </option>
                              ))}
                            </select>

                            {compatiblePaths.length === 0 && !pathsLoading && (
                              <div className="text-[11px] text-red-400">
                                Aucun path compatible
                              </div>
                            )}
                            {waypointWarning && (
                              <div className="text-[11px] text-orange-300">{waypointWarning}</div>
                            )}
                          </div>
                        ) : (
                          <div className="rounded-md border border-gray-800 bg-gray-950 px-2 py-1.5 text-xs text-gray-400">
                            Inspection auto
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {paths.length === 0 && !pathsLoading && (
              <div className="rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">
                Bibliotheque de paths vide
              </div>
            )}

            {errorMessage && (
              <div className="rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">
                {errorMessage}
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button type="button" onClick={onClose} className="btn-secondary flex-1 text-sm">
                Annuler
              </button>
              <button
                type="button"
                onClick={loadMission}
                disabled={!canLoad}
                className="btn-primary flex-1 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Chargement...' : 'Charger la mission'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
