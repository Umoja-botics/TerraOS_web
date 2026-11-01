import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useMissions, useDeleteMission, useStartMission } from '@/hooks/useApi';
import { useRobots } from '@/hooks/useApi';
import { MissionStatus } from '@terra-os/types';
import type { Mission } from '@terra-os/types';
import { MissionForm } from './MissionForm';
import { PencilIcon, PlayIcon, PlusIcon, TrashIcon } from '@/components/icons';

// ── Status styling ─────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  IDLE:      'bg-gray-800 text-gray-400',
  RUNNING:   'bg-green-900/40 text-green-400 border border-green-800',
  PAUSED:    'bg-yellow-900/40 text-yellow-400 border border-yellow-800',
  COMPLETED: 'bg-blue-900/40 text-blue-400 border border-blue-800',
  ABORTED:   'bg-red-900/40 text-red-400 border border-red-800',
  ERROR:     'bg-red-900/40 text-red-400 border border-red-800',
  FAILED:    'bg-red-900/40 text-red-400 border border-red-800',
};

const AGENT_COLOR: Record<string, string> = {
  ugv:      '#00ff9d',
  brouette: '#ff9a00',
  drone:    '#a78bfa',
};

function AgentPill({ agentId }: { agentId: string }) {
  return (
    <span
      className="text-xs font-mono px-2 py-0.5 rounded border"
      style={{ color: AGENT_COLOR[agentId] ?? '#94a3b8', borderColor: (AGENT_COLOR[agentId] ?? '#94a3b8') + '44', background: (AGENT_COLOR[agentId] ?? '#94a3b8') + '11' }}
    >
      {agentId}
    </span>
  );
}

function MissionCard({ mission, robotName, launchBlocked, onLaunch, onEdit, onDelete }: {
  mission: Mission;
  robotName: string;
  launchBlocked: boolean;
  onLaunch: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isIdle    = mission.status === MissionStatus.IDLE;
  const isRunning = mission.status === MissionStatus.RUNNING;
  const canEdit   = !isRunning;
  const agents  = (mission as Mission & { agentConfigs?: Array<{ agentId: string }> }).agentConfigs ?? [];

  return (
    <div className="card flex flex-col gap-3 hover:border-gray-700 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-gray-100 truncate">{mission.name}</div>
          <div className="text-xs text-gray-500 mt-0.5">{robotName}</div>
        </div>
        <span className={clsx('text-xs font-mono px-2 py-0.5 rounded-full shrink-0', STATUS_BADGE[mission.status] ?? STATUS_BADGE.IDLE)}>
          {mission.status}
        </span>
      </div>

      {agents.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {agents.map((a) => <AgentPill key={a.agentId} agentId={a.agentId} />)}
        </div>
      )}

      {mission.startedAt && (
        <div className="text-xs text-gray-600">
          {mission.status === MissionStatus.IDLE ? 'Créé' : 'Démarré'} le{' '}
          {new Date(mission.startedAt).toLocaleString()}
        </div>
      )}

      <div className="flex gap-2 pt-1 border-t border-gray-800">
        {isIdle ? (
          <>
            <button
              onClick={onLaunch}
              disabled={launchBlocked}
              title={launchBlocked ? 'Une mission est déjà en cours' : ''}
              className="flex flex-1 items-center justify-center gap-1.5 text-xs py-1.5 bg-brand-700 hover:bg-brand-600 text-white rounded-md transition-colors font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <PlayIcon className="w-3.5 h-3.5" />Lancer
            </button>
            <button
              onClick={onEdit}
              title="Modifier"
              className="text-xs p-1.5 border border-gray-700 text-gray-400 rounded-md hover:bg-gray-800 transition-colors"
            >
              <PencilIcon className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onDelete}
              title="Supprimer"
              className="text-xs p-1.5 border border-red-800/50 text-red-400 rounded-md hover:bg-red-900/20 transition-colors"
            >
              <TrashIcon className="w-3.5 h-3.5" />
            </button>
          </>
        ) : (
          <>
            <span className="flex-1 text-xs text-gray-600 py-1.5">
              {isRunning ? 'Mission active — contrôler depuis le Dashboard' : 'Archivé'}
            </span>
            {canEdit && (
              <button
                onClick={onEdit}
                className="text-xs px-3 py-1.5 border border-gray-700 text-gray-400 rounded-md hover:bg-gray-800 transition-colors"
              >
                Modifier
              </button>
            )}
            <button
              onClick={onDelete}
              className="text-xs px-3 py-1.5 border border-red-800/50 text-red-400 rounded-md hover:bg-red-900/20 transition-colors"
            >
              Supprimer
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export function MissionsPage() {
  const navigate = useNavigate();
  const { data: missions = [], isLoading } = useMissions();
  const { data: robots   = [] }            = useRobots();

  const deleteMission = useDeleteMission();
  const startMission  = useStartMission();

  const [showForm,   setShowForm]   = useState(false);
  const [editing,    setEditing]    = useState<(typeof missions)[0] | null>(null);
  const [filter,     setFilter]     = useState<'all' | 'idle' | 'history'>('all');

  const robotMap = Object.fromEntries(robots.map((r) => [r.id, r.name]));
  const activeMission = missions.find(
    (mission) => mission.status === MissionStatus.RUNNING || mission.status === MissionStatus.PAUSED,
  );

  const filtered = missions.filter((m) => {
    if (filter === 'idle')    return m.status === MissionStatus.IDLE;
    if (filter === 'history') return m.status !== MissionStatus.IDLE;
    return true;
  });

  const handleLaunch = (mission: Mission) => {
    startMission.mutate(mission.id, {
      onSuccess: () => navigate('/'),
    });
  };

  const handleDelete = (mission: Mission) => {
    const warn = mission.status === MissionStatus.RUNNING
      ? `La mission "${mission.name}" est marquée RUNNING — elle sera supprimée de la base.\n\nContinuer ?`
      : `Supprimer la mission "${mission.name}" ?`;
    if (window.confirm(warn)) {
      deleteMission.mutate(mission.id);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-100">Mission Planner</h1>
          <p className="text-xs text-gray-500 mt-0.5">Créer, modifier, supprimer et lancer les profils de mission</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="btn-primary flex items-center gap-1.5 text-xs px-4 py-1.5"
        >
          <PlusIcon className="w-3.5 h-3.5" />Nouveau profil
        </button>
      </div>

      {/* Filter tabs */}
      {activeMission && (
        <div className="border border-green-800 bg-green-950/30 px-3 py-2 rounded-md text-xs text-green-300">
          Mission active : <span className="font-semibold">{activeMission.name}</span>. Terminez-la ou annulez-la avant d’en lancer une autre.
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-gray-800 pb-0">
        {([['all', 'Tous'], ['idle', 'Prêts'], ['history', 'Historique']] as const).map(([val, label]) => (
          <button
            key={val}
            onClick={() => setFilter(val)}
            className={clsx(
              'text-xs px-4 py-2 border-b-2 -mb-px transition-colors',
              filter === val
                ? 'border-brand-500 text-brand-400'
                : 'border-transparent text-gray-500 hover:text-gray-300',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="text-gray-500 text-sm py-8 text-center">Chargement…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-gray-600 text-sm mb-4">Aucune mission{filter !== 'all' ? ' dans ce filtre' : ''}</div>
          <button onClick={() => setShowForm(true)} className="btn-secondary text-xs">
            Créer un profil
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((mission) => (
            <MissionCard
              key={mission.id}
              mission={mission}
              robotName={robotMap[mission.robotId] ?? mission.robotId}
              launchBlocked={!!activeMission}
              onLaunch={() => handleLaunch(mission)}
              onEdit={() => setEditing(mission)}
              onDelete={() => handleDelete(mission)}
            />
          ))}
        </div>
      )}

      {showForm && <MissionForm onClose={() => setShowForm(false)} />}
      {editing   && <MissionForm initial={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
