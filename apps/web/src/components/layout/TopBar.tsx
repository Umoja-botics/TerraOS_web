import { useAuth } from '@/hooks/useAuth';
import { useFleetStore } from '@/store/fleetStore';
import { SafetyLevel } from '@terra-os/types';

export function TopBar() {
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
    <header className="h-12 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-6">
      <span className="text-sm text-gray-400 font-mono">Ground Control Station</span>
      <div className="flex items-center gap-4">
        {hasAlert && !simMode && (
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-mono font-semibold animate-pulse ${
              alertLevel === SafetyLevel.ERROR
                ? 'bg-red-900/50 text-red-400 border border-red-800'
                : 'bg-orange-900/50 text-orange-400 border border-orange-800'
            }`}
          >
            {alertLevel === SafetyLevel.ERROR ? '⚠ FAULT' : '⚠ WARNING'}
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
          <span className="text-sm text-gray-300">
            {user.name} <span className="text-gray-500 text-xs">({user.role})</span>
          </span>
        )}
        <button onClick={logout} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
          Sign out
        </button>
      </div>
    </header>
  );
}
