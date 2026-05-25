import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useCreateRobot, useRobots, useUpdateRobot, useDeleteRobot } from '@/hooks/useApi';
import { Role } from '@terra-os/types';
import type { Robot } from '@terra-os/types';

function RobotRegistrationForm({ onSuccess }: { onSuccess: () => void }) {
  const createRobot = useCreateRobot();
  const [name,        setName]        = useState('');
  const [type,        setType]        = useState('UGV');
  const [bridgeUrl,   setBridgeUrl]   = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createRobot.mutate(
      { name: name.trim(), type, bridgeUrl: bridgeUrl.trim() || undefined, description: description.trim() || undefined },
      {
        onSuccess: () => {
          setName(''); setBridgeUrl(''); setDescription('');
          onSuccess();
        },
      },
    );
  };

  return (
    <form onSubmit={handleSubmit} className="card space-y-4 max-w-md">
      <h3 className="text-base font-semibold text-gray-100">Enregistrer un robot</h3>

      {createRobot.error && (
        <p className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded p-2">
          Échec de l'enregistrement
        </p>
      )}
      {createRobot.isSuccess && (
        <p className="text-sm text-green-400 bg-green-900/20 border border-green-800 rounded p-2">
          Robot enregistré
        </p>
      )}

      <div>
        <label className="block text-sm text-gray-400 mb-1">Nom</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-500"
          placeholder="Faucon UGV 01" required />
      </div>

      <div>
        <label className="block text-sm text-gray-400 mb-1">Type</label>
        <select value={type} onChange={(e) => setType(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-500">
          <option value="UGV">UGV</option>
          <option value="DRONE">DRONE</option>
          <option value="BROUETTE">BROUETTE</option>
        </select>
      </div>

      <div>
        <label className="block text-sm text-gray-400 mb-1">Bridge URL</label>
        <input type="url" value={bridgeUrl} onChange={(e) => setBridgeUrl(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-500 font-mono"
          placeholder="http://192.168.1.50:8100" />
        <p className="text-xs text-gray-600 mt-1">Adresse du terra-bridge sur le robot</p>
      </div>

      <div>
        <label className="block text-sm text-gray-400 mb-1">Description (optionnel)</label>
        <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-500"
          placeholder="Robot de terrain #1" />
      </div>

      <button type="submit" disabled={createRobot.isPending} className="btn-primary w-full">
        {createRobot.isPending ? 'Enregistrement…' : 'Enregistrer'}
      </button>
    </form>
  );
}

function RobotRow({ robot }: { robot: Robot }) {
  const updateRobot = useUpdateRobot();
  const deleteRobot = useDeleteRobot();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name:        robot.name,
    type:        robot.type,
    bridgeUrl:   robot.bridgeUrl ?? '',
    description: robot.description ?? '',
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  const handleSave = () => {
    updateRobot.mutate(
      { id: robot.id, ...form, bridgeUrl: form.bridgeUrl || undefined },
      { onSuccess: () => setOpen(false) },
    );
  };

  const handleDelete = () => {
    if (!confirm(`Supprimer "${robot.name}" ?`)) return;
    deleteRobot.mutate(robot.id);
  };

  return (
    <div className="card space-y-3">
      {/* Summary row */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-gray-100 font-medium">{robot.name}</div>
          <div className="text-xs text-gray-500 font-mono mt-0.5">
            {robot.type}{robot.bridgeUrl && <> · {robot.bridgeUrl}</>}
          </div>
          {robot.description && (
            <div className="text-xs text-gray-600 mt-0.5">{robot.description}</div>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => setOpen((o) => !o)}
            className="text-xs px-3 py-1 border border-gray-700 text-gray-400 rounded-md hover:bg-gray-800 transition-colors"
          >
            {open ? 'Fermer' : 'Modifier'}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleteRobot.isPending}
            className="text-xs px-3 py-1 border border-red-800/50 text-red-400 rounded-md hover:bg-red-900/20 transition-colors disabled:opacity-40"
          >
            Supprimer
          </button>
        </div>
      </div>

      {/* Inline edit form */}
      {open && (
        <div className="border-t border-gray-800 pt-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {([
              ['name',        'Nom',         'text', 'Faucon #1'],
              ['bridgeUrl',   'Bridge URL',  'url',  'http://robot:8100'],
              ['description', 'Description', 'text', 'Note…'],
            ] as [keyof typeof form, string, string, string][]).map(([key, label, type, placeholder]) => (
              <div key={key} className={key === 'description' ? 'col-span-2' : ''}>
                <label className="block text-xs text-gray-500 mb-1">{label}</label>
                <input
                  type={type}
                  value={form[key]}
                  onChange={set(key)}
                  placeholder={placeholder}
                  className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-100 focus:outline-none focus:border-brand-500"
                />
              </div>
            ))}
            <div>
              <label className="block text-xs text-gray-500 mb-1">Type</label>
              <select value={form.type} onChange={set('type')}
                className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-100 focus:outline-none focus:border-brand-500">
                <option value="UGV">UGV</option>
                <option value="DRONE">DRONE</option>
                <option value="BROUETTE">BROUETTE</option>
              </select>
            </div>
          </div>
          {(updateRobot.error) && (
            <p className="text-xs text-red-400">Erreur — rôle ADMIN requis</p>
          )}
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={updateRobot.isPending || !form.name.trim()}
              className="btn-primary text-xs px-4 py-1.5 disabled:opacity-40">
              {updateRobot.isPending ? 'Sauvegarde…' : 'Sauvegarder'}
            </button>
            <button onClick={() => setOpen(false)} className="btn-secondary text-xs px-4 py-1.5">
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function SettingsPage() {
  const { user } = useAuth();
  const { data: robots = [], refetch } = useRobots();
  const isAdmin = user?.role === Role.ADMIN;

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-xl font-semibold text-gray-100 mb-1">Paramètres</h1>
        <p className="text-sm text-gray-500">Configuration système et gestion des robots</p>
      </div>

      {/* Account */}
      <section className="card space-y-3">
        <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wider">Compte</h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Nom</span>
            <span className="text-gray-200">{user?.name ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Email</span>
            <span className="text-gray-200">{user?.email ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Rôle</span>
            <span className="text-gray-200 font-mono text-xs">{user?.role ?? '—'}</span>
          </div>
        </div>
      </section>

      {/* Robot registry */}
      <section className="space-y-4">
        <h2 className="text-sm font-medium text-gray-300 border-b border-gray-800 pb-2">
          Robots enregistrés
        </h2>

        {robots.length > 0 ? (
          <div className="space-y-2">
            {robots.map((robot) => <RobotRow key={robot.id} robot={robot} />)}
          </div>
        ) : (
          <p className="text-xs text-gray-600 card text-center py-6">Aucun robot enregistré.</p>
        )}

        {isAdmin ? (
          <RobotRegistrationForm onSuccess={() => void refetch()} />
        ) : (
          <p className="text-xs text-gray-600 card">
            L'enregistrement de robots nécessite le rôle ADMIN.
          </p>
        )}
      </section>

      {/* API */}
      <section className="card space-y-2">
        <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wider">Connexion API</h2>
        <div className="text-xs font-mono text-gray-500">
          {import.meta.env.VITE_API_URL ?? 'http://localhost:4000'}
        </div>
      </section>
    </div>
  );
}
