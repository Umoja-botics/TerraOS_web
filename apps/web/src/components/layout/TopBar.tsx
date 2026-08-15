import { useAuth } from '@/hooks/useAuth';
import { useFleetStore } from '@/store/fleetStore';
import { SafetyLevel } from '@terra-os/types';
import { LogOutIcon, MenuIcon, TriangleAlertIcon } from '@/components/icons';
import { useLocation } from 'react-router-dom';

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Vue opérationnelle',
  '/fleet': 'Flotte',
  '/missions': 'Missions',
  '/paths': 'Trajectoires',
  '/reports': 'Rapports',
  '/plugins': 'Intégrations',
  '/settings': 'Paramètres',
};

export function TopBar({ onMenuClick }: { onMenuClick?: () => void }) {
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const robots    = useFleetStore((s) => s.robots);
  const simMode   = useFleetStore((s) => s.simMode);
  const toggleSim = useFleetStore((s) => s.toggleSimMode);

  const hasAlert = Object.values(robots).some(
    (r) => r.health?.level && r.health.level !== SafetyLevel.OK,
  );
  const alertLevel = Object.values(robots).some((r) => r.health?.level === SafetyLevel.ERROR)
    ? SafetyLevel.ERROR
    : SafetyLevel.WARNING;

  return (
    <header className={`divider-tech ${simMode ? 'divider-tech--sim' : ''} h-12 shrink-0 bg-gray-900 flex items-center justify-between px-3 md:px-6`}>
      <div className="flex items-center gap-2">
        <button onClick={onMenuClick} className="md:hidden p-1 text-gray-400 hover:text-gray-100" title="Navigation" aria-label="Ouvrir la navigation"><MenuIcon className="w-5 h-5" /></button>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm text-brand-500 font-semibold font-mono md:hidden">TerraOS</span>
          <span className="hidden md:inline text-sm text-gray-300 font-medium truncate">{PAGE_TITLES[pathname] ?? 'TerraOS'}</span>
          <span className="hidden lg:inline text-xs text-gray-600 font-mono">Ground Control Station</span>
        </div>
      </div>
      <div className="flex items-center gap-2 md:gap-4">
        {hasAlert && !simMode && (
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-mono font-semibold animate-pulse ${
              alertLevel === SafetyLevel.ERROR
                ? 'bg-red-900/50 text-red-400 border border-red-800'
                : 'bg-orange-900/50 text-orange-400 border border-orange-800'
            }`}
          >
            <span className="inline-flex items-center gap-1"><TriangleAlertIcon className="w-3.5 h-3.5" />{alertLevel === SafetyLevel.ERROR ? 'FAULT' : 'WARNING'}</span>
          </span>
        )}

        {/* Simulation mode toggle */}
        <button
          onClick={toggleSim}
          title={simMode ? 'Désactiver le mode simulation' : 'Activer le mode simulation'}
          className={`flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border font-mono font-semibold transition-colors ${
            simMode
              ? 'bg-orange-500/20 text-orange-300 border-orange-500/50 hover:bg-orange-500/30'
              : 'bg-gray-800 text-gray-500 border-gray-700 hover:text-gray-300 hover:border-gray-600'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${simMode ? 'bg-orange-400 animate-pulse' : 'bg-gray-600'}`} />
          SIM
        </button>

        {user && (
          <span className="hidden lg:inline text-sm text-gray-300">
            {user.name} <span className="text-gray-500 text-xs">({user.role})</span>
          </span>
        )}
        <button onClick={logout} title="Se déconnecter" className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors">
          <LogOutIcon className="w-4 h-4" /><span className="hidden sm:inline">Quitter</span>
        </button>
      </div>
    </header>
  );
}
