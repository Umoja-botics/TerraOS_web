import { useState } from 'react';
import clsx from 'clsx';
import { useFleet } from '@/hooks/useFleet';
import { useUpdateRobot, useDeleteRobot } from '@/hooks/useApi';
import { useAuth } from '@/hooks/useAuth';
import { Role } from '@terra-os/types';
import type { Robot } from '@terra-os/types';

interface EditState {
  name: string;
  type: string;
  bridgeUrl: string;
  description: string;
}

function EditRow({ robot, onClose }: { robot: Robot; onClose: () => void }) {
  const updateRobot = useUpdateRobot();
  const deleteRobot = useDeleteRobot();
  const [form, setForm] = useState<EditState>({
    name:        robot.name,
    type:        robot.type,
    bridgeUrl:   robot.bridgeUrl ?? '',
    description: robot.description ?? '',
  });

  const set = (k: keyof EditState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  const handleSave = () => {
    updateRobot.mutate(
      { id: robot.id, ...form, bridgeUrl: form.bridgeUrl || undefined },
      { onSuccess: onClose },
    );
  };

  const handleDelete = () => {
    if (!confirm(`Supprimer "${robot.name}" ?`)) return;
    deleteRobot.mutate(robot.id, { onSuccess: onClose });
  };

  return (
    <tr className="bg-gray-900/60">
      <td colSpan={6} className="px-4 py-4">
        <div className="mb-2 text-xs font-mono text-gray-600 select-all" title="Robot ID">
          ID: {robot.id}
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          {([
            ['name',        'Nom',         'text', 'Faucon #1'],
            ['type',        'Type',        'text', 'ugv / drone'],
            ['bridgeUrl',   'Bridge URL',  'url',  'http://robot-ip:8100'],
            ['description', 'Description', 'text', 'Note libre…'],
          ] as [keyof EditState, string, string, string][]).map(([key, label, type, placeholder]) => (
            <div key={key}>
              <label className="block text-xs text-gray-500 mb-1">{label}</label>
              <input
                type={type}
                value={form[key]}
                onChange={set(key)}
                placeholder={placeholder}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-brand-500"
              />
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={updateRobot.isPending || !form.name.trim()}
            className="btn-primary text-xs px-4 py-1.5 disabled:opacity-40"
          >
            {updateRobot.isPending ? 'Sauvegarde…' : 'Sauvegarder'}
          </button>
          <button onClick={onClose} className="btn-secondary text-xs px-4 py-1.5">
            Annuler
          </button>
          <button
            onClick={handleDelete}
            disabled={deleteRobot.isPending}
            className="ml-auto text-xs px-4 py-1.5 border border-red-800 text-red-400 rounded-md hover:bg-red-900/20 transition-colors disabled:opacity-40"
          >
            {deleteRobot.isPending ? 'Suppression…' : 'Supprimer'}
          </button>
        </div>
        {(updateRobot.error || deleteRobot.error) && (
          <p className="text-xs text-red-400 mt-2">Erreur — vérifier les permissions (rôle ADMIN requis)</p>
        )}
      </td>
    </tr>
  );
}

export function FleetPage() {
  const { fleet, isLoading, selectRobot, selectedRobot } = useFleet();
  const { user } = useAuth();
  const [editingId, setEditingId] = useState<string | null>(null);
  const isAdmin = user?.role === Role.ADMIN;

  if (isLoading) return <div className="text-gray-500 text-sm">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-100">Fleet Overview</h1>
        {isAdmin && (
          <span className="text-xs text-gray-500">Cliquer sur une ligne pour modifier</span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-500 text-left">
              <th className="pb-3 pr-6 font-medium">Robot</th>
              <th className="pb-3 pr-6 font-medium">Type</th>
              <th className="pb-3 pr-6 font-medium">Status</th>
              <th className="pb-3 pr-6 font-medium">Battery</th>
              <th className="pb-3 pr-6 font-medium">GPS</th>
              <th className="pb-3 font-medium">Last seen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {fleet.map((robot) => {
              const isConnected = robot.live?.status?.connected ?? false;
              const liveStatus  = isConnected ? (robot.live?.status?.mode ?? robot.status) : robot.status;
              const battery     = robot.live?.status?.battery;
              const gps         = robot.live?.telemetry?.gps;
              const isEditing   = editingId === robot.id;

              return [
                <tr
                  key={robot.id}
                  onClick={() => {
                    selectRobot(robot.id);
                    if (isAdmin) setEditingId(isEditing ? null : robot.id);
                  }}
                  className={clsx(
                    'cursor-pointer transition-colors',
                    isEditing
                      ? 'bg-gray-900/80 border-b-0'
                      : robot.id === selectedRobot?.id
                        ? 'bg-brand-900/10'
                        : 'hover:bg-gray-900/50',
                  )}
                >
                  <td className="py-3 pr-6 font-medium text-gray-100">{robot.name}</td>
                  <td className="py-3 pr-6 text-gray-400">{robot.type}</td>
                  <td className="py-3 pr-6">
                    <span
                      className={clsx(
                        'px-2 py-0.5 rounded-full text-xs font-mono',
                        isConnected ? 'badge-online' : 'badge-offline',
                      )}
                    >
                      {liveStatus}
                    </span>
                  </td>
                  <td className="py-3 pr-6 text-gray-400">
                    {battery != null ? `${Math.round(battery * 100)}%` : '—'}
                  </td>
                  <td className="py-3 pr-6 text-gray-400 font-mono text-xs">
                    {gps ? `${gps.lat.toFixed(5)}, ${gps.lon.toFixed(5)}` : '—'}
                  </td>
                  <td className="py-3 text-gray-500 text-xs">
                    {robot.lastSeen ? new Date(robot.lastSeen).toLocaleString() : '—'}
                  </td>
                </tr>,

                isEditing && isAdmin && (
                  <EditRow key={`edit-${robot.id}`} robot={robot} onClose={() => setEditingId(null)} />
                ),
              ];
            })}
          </tbody>
        </table>
        {fleet.length === 0 && (
          <p className="text-center text-gray-500 py-12">No robots registered.</p>
        )}
      </div>
    </div>
  );
}
