import { useAuth } from '@/hooks/useAuth';
import { useFleetStore } from '@/store/fleetStore';
import { SafetyLevel } from '@terra-os/types';

export function TopBar() {
  const { user, logout } = useAuth();
  const robots = useFleetStore((s) => s.robots);

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
        {hasAlert && (
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
