import { useAuth } from '@/hooks/useAuth';
import { useDemoStatus, useDemoInject, useDemoReset } from '@/hooks/useApi';
import { Role } from '@terra-os/types';
import clsx from 'clsx';

// Mirrors the failure_injections in scenarios/demo_agri.yaml.
const INJECTIONS = [
  { id: 'gps_degraded', label: 'GPS dégradé', desc: 'Bruit GPS ×100 sur l’UGV (30 s)' },
  { id: 'low_battery', label: 'Batterie faible', desc: 'Brouette → 15 %' },
];

/**
 * ADMIN-only demo control: scenario status, scripted failure injections, and a
 * one-click reset. Renders nothing unless the user is ADMIN and DEMO_MODE is on
 * (detected by the /demo/status query succeeding).
 */
export function DemoPanel() {
  const { user } = useAuth();
  const isAdmin = user?.role === Role.ADMIN;
  const { data: status, isError } = useDemoStatus(isAdmin);
  const inject = useDemoInject();
  const reset = useDemoReset();

  // Hidden for non-admins or when DEMO_MODE is off (status endpoint 403s).
  if (!isAdmin || isError) return null;

  const state = status?.state ?? '—';
  const phase = status?.phase;
  const playerDown = state === 'OFFLINE';

  return (
    <div className="card border-amber-500/30">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-amber-400 uppercase tracking-wide font-semibold">
          Démo — contrôle
        </span>
        <span className="text-[10px] font-mono text-gray-500">
          {playerDown ? 'player hors-ligne' : (
            <>
              {state}{phase ? ` · ${phase}` : ''}
              {status ? ` (${status.phase_index + 1}/${status.total_phases})` : ''}
            </>
          )}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-2">
        {INJECTIONS.map((f) => (
          <button
            key={f.id}
            title={f.desc}
            disabled={inject.isPending || playerDown}
            onClick={() => inject.mutate(f.id)}
            className="text-xs px-2 py-1.5 rounded-md border border-orange-500/40 text-orange-300 bg-orange-500/10 hover:bg-orange-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            ⚠ {f.label}
          </button>
        ))}
      </div>

      <button
        disabled={reset.isPending}
        onClick={() => reset.mutate()}
        className={clsx(
          'w-full text-xs px-2 py-1.5 rounded-md border font-mono transition-colors',
          'border-gray-700 text-gray-300 hover:border-gray-500 hover:text-white',
          'disabled:opacity-40 disabled:cursor-not-allowed',
        )}
      >
        {reset.isPending ? 'Réinitialisation…' : '↺ Réinitialiser la démo'}
      </button>
    </div>
  );
}
