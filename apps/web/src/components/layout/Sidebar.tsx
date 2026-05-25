import { NavLink } from 'react-router-dom';
import clsx from 'clsx';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard',      icon: '⬡' },
  { to: '/fleet',     label: 'Fleet',          icon: '◈' },
  { to: '/missions',  label: 'Mission Planner', icon: '▶' },
  { to: '/paths',     label: 'Paths',          icon: '⤴' },
  { to: '/reports',   label: 'Reports',        icon: '◫' },
  { to: '/plugins',   label: 'Plugins',        icon: '⬡' },
  { to: '/settings',  label: 'Settings',       icon: '⚙' },
];

export function Sidebar() {
  return (
    <aside className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col">
      <div className="px-4 py-5 border-b border-gray-800">
        <span className="text-brand-500 font-bold text-lg tracking-tight">TerraOS</span>
        <span className="text-gray-500 text-xs ml-2">UMOJA Robotics</span>
      </div>

      <nav className="flex-1 py-4 space-y-1 px-2">
        {NAV_ITEMS.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                isActive
                  ? 'bg-brand-900/30 text-brand-400 border border-brand-800/50'
                  : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800',
              )
            }
          >
            <span className="text-base">{icon}</span>
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
