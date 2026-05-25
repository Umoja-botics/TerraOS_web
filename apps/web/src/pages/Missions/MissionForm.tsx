import { useState } from 'react';
import { useRobots, usePaths, useCreateMission, useUpdateMission } from '@/hooks/useApi';
import { NavMode } from '@terra-os/types';
import type { AgentConfig, AgentTask, Mission } from '@terra-os/types';

const AGENT_OPTIONS: { id: AgentConfig['agentId']; label: string; color: string }[] = [
  { id: 'ugv',      label: 'UGV',      color: 'text-green-400' },
  { id: 'brouette', label: 'Brouette', color: 'text-orange-400' },
  { id: 'drone',    label: 'Drone',    color: 'text-purple-400' },
];

const NAV_MODE_LABELS: Record<string, string> = {
  [NavMode.FOLLOW_WAYPOINTS]: 'Follow Waypoints',
  [NavMode.GOTO_WAYPOINT]:    'Go To Waypoint',
};

interface Props {
  onClose:  () => void;
  initial?: Mission & { agentConfigs?: AgentConfig[] | null };
}

export function MissionForm({ onClose, initial }: Props) {
  const { data: robots = [] } = useRobots();
  const { data: paths = [] }  = usePaths();
  const createMission = useCreateMission();
  const updateMission = useUpdateMission();

  const isEditing = !!initial;
  const mutate    = isEditing ? updateMission : createMission;

  // Initialise state from existing mission when editing
  const initAgentPaths = (): Record<string, string> => {
    if (!initial?.agentConfigs?.length) return { ugv: '' };
    return Object.fromEntries(initial.agentConfigs.map((a) => [a.agentId, a.pathId ?? '']));
  };
  const initAgentTasks = (): Record<string, AgentTask> => {
    if (!initial?.agentConfigs?.length) return { ugv: 'follow_path' };
    return Object.fromEntries(
      initial.agentConfigs.map((a) => [a.agentId, (a.task as AgentTask) ?? 'follow_path']),
    );
  };

  const [name,       setName]       = useState(initial?.name ?? '');
  const [robotId,    setRobotId]    = useState(initial?.robotId ?? '');
  const [navMode,    setNavMode]    = useState<string>(initial?.navMode ?? NavMode.FOLLOW_WAYPOINTS);
  const [agentPaths, setAgentPaths] = useState<Record<string, string>>(initAgentPaths);
  const [agentTasks, setAgentTasks] = useState<Record<string, AgentTask>>(initAgentTasks);

  const selectedAgentIds = Object.keys(agentPaths);

  const toggleAgent = (agentId: AgentConfig['agentId']) => {
    setAgentPaths((prev) => {
      if (agentId in prev) {
        const next = { ...prev };
        delete next[agentId];
        setAgentTasks((tasks) => { const c = { ...tasks }; delete c[agentId]; return c; });
        return next;
      }
      setAgentTasks((tasks) => ({
        ...tasks,
        [agentId]: agentId === 'ugv' ? 'follow_path' : 'follow_waypoints',
      }));
      return { ...prev, [agentId]: '' };
    });
  };

  const setAgentPath = (agentId: string, pathId: string) =>
    setAgentPaths((prev) => ({ ...prev, [agentId]: pathId }));

  const isValid =
    name.trim() &&
    robotId &&
    selectedAgentIds.length > 0 &&
    selectedAgentIds.every(
      (id) => (id === 'drone' && agentTasks[id] === 'inspection') ? true : agentPaths[id],
    );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    const agentConfigs: AgentConfig[] = selectedAgentIds.map((agentId) => {
      const task   = agentTasks[agentId];
      const pathId = agentPaths[agentId];
      return {
        agentId: agentId as AgentConfig['agentId'],
        ...(pathId ? { pathId } : {}),
        ...(task   ? { task }   : {}),
      };
    });

    if (isEditing && initial) {
      updateMission.mutate(
        { id: initial.id, name: name.trim(), robotId, navMode, agentConfigs },
        { onSuccess: onClose },
      );
    } else {
      createMission.mutate(
        { robotId, name: name.trim(), navMode, agentConfigs },
        { onSuccess: onClose },
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-lg max-h-screen overflow-y-auto">
        <form onSubmit={handleSubmit} className="card space-y-5 m-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-100">
              {isEditing ? 'Modifier le profil' : 'Nouveau profil de mission'}
            </h2>
            <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xl leading-none">×</button>
          </div>

          {mutate.error && (
            <p className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded p-2">
              {isEditing ? 'Échec de la mise à jour' : 'Échec de la création'}
            </p>
          )}

          {/* Name */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Nom de la mission</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-500"
              placeholder="Tour Nord, Inspection A3…"
              required
            />
          </div>

          {/* Robot */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Robot</label>
            <select
              value={robotId}
              onChange={(e) => setRobotId(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-500"
              required
            >
              <option value="">Sélectionner un robot…</option>
              {robots.map((r) => (
                <option key={r.id} value={r.id}>{r.name} — {r.type}</option>
              ))}
            </select>
          </div>

          {/* Nav mode */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Mode de navigation</label>
            <div className="flex gap-3">
              {Object.entries(NAV_MODE_LABELS).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="navMode"
                    value={value}
                    checked={navMode === value}
                    onChange={() => setNavMode(value)}
                    className="accent-brand-500"
                  />
                  <span className="text-sm text-gray-300">{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Agents */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Agents & paths</label>
            <div className="space-y-3">
              {AGENT_OPTIONS.map(({ id, label, color }) => {
                const checked = id in agentPaths;
                return (
                  <div key={id} className="flex items-center gap-3">
                    <label className="flex items-center gap-2 w-24 cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAgent(id)}
                        className="accent-brand-500"
                      />
                      <span className={`text-sm font-mono ${color}`}>{label}</span>
                    </label>
                    {checked && (
                      <div className="flex-1 flex gap-2">
                        {id === 'drone' && (
                          <select
                            value={agentTasks[id] ?? 'follow_waypoints'}
                            onChange={(e) => setAgentTasks((prev) => ({ ...prev, [id]: e.target.value as AgentTask }))}
                            className="w-36 bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-brand-500"
                          >
                            <option value="follow_waypoints">Waypoints</option>
                            <option value="inspection">Inspection</option>
                          </select>
                        )}
                        <select
                          value={agentPaths[id] ?? ''}
                          onChange={(e) => setAgentPath(id, e.target.value)}
                          className="flex-1 bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-brand-500"
                          required={!(id === 'drone' && agentTasks[id] === 'inspection')}
                        >
                          <option value="">
                            {id === 'drone' && agentTasks[id] === 'inspection' ? 'Inspection auto…' : 'Sélectionner un path…'}
                          </option>
                          {paths.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} ({p.waypoints.length} wp · {p.navMode})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {selectedAgentIds.length === 0 && (
              <p className="text-xs text-yellow-500 mt-2">Sélectionner au moins un agent.</p>
            )}
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">
              Annuler
            </button>
            <button
              type="submit"
              disabled={!isValid || mutate.isPending}
              className="btn-primary flex-1 disabled:opacity-40"
            >
              {mutate.isPending ? 'Sauvegarde…' : isEditing ? 'Mettre à jour' : 'Créer le profil'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
