import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { StatusBar } from './StatusBar';
import { useFleetStore } from '@/store/fleetStore';

function SimBanner() {
  const toggleSim = useFleetStore((s) => s.toggleSimMode);
  return (
    <div className="flex items-center justify-between bg-orange-500/15 border-b border-orange-500/30 px-6 py-1.5">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
        <span className="text-xs font-mono font-semibold text-orange-300 tracking-widest uppercase">
          Mode Simulation — aucun robot physique connecté
        </span>
      </div>
      <button
        onClick={toggleSim}
        className="text-xs text-orange-400 hover:text-orange-200 font-mono border border-orange-500/40 px-2 py-0.5 rounded hover:border-orange-400 transition-colors"
      >
        Quitter
      </button>
    </div>
  );
}

export function Shell() {
  const simMode = useFleetStore((s) => s.simMode);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-950">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopBar />
        {simMode && <SimBanner />}
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
        <StatusBar />
      </div>
    </div>
  );
}
