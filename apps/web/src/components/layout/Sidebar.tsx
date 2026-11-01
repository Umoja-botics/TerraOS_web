import { NavLink } from 'react-router-dom';
import clsx from 'clsx';
import { ChevronLeftIcon, ChevronRightIcon, DashboardIcon, FleetIcon, MapPinnedIcon, PlugIcon, ReportIcon, RouteIcon, SettingsIcon } from '@/components/icons';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard',       icon: DashboardIcon },
  { to: '/fleet',     label: 'Fleet',           icon: FleetIcon },
  { to: '/missions',  label: 'Mission Planner', icon: RouteIcon },
  { to: '/paths',     label: 'Paths',           icon: MapPinnedIcon },
  { to: '/reports',   label: 'Reports',         icon: ReportIcon },
  { to: '/plugins',   label: 'Plugins',         icon: PlugIcon },
  { to: '/settings',  label: 'Settings',        icon: SettingsIcon },
];

interface SidebarProps {
  collapsed?: boolean;
  mobileOpen?: boolean;
  onClose?: () => void;
  onToggle?: () => void;
}

export function Sidebar({ collapsed = false, mobileOpen = false, onClose, onToggle }: SidebarProps) {
  const showLabels = !collapsed || mobileOpen;

  return (
    <>
      {mobileOpen && <button aria-label="Fermer la navigation" onClick={onClose} className="fixed inset-0 z-[1100] bg-black/60 md:hidden" />}
      <aside className={clsx(
        'w-56 shrink-0 bg-gray-900 border-r border-gray-800 flex-col transition-[width] duration-200 ease-out',
        collapsed ? 'md:w-16' : 'md:w-56',
        mobileOpen ? 'fixed inset-y-0 left-0 z-[1200] flex md:static' : 'hidden md:flex',
      )}>
      <div className={clsx('divider-tech h-12 shrink-0 flex items-center overflow-hidden', showLabels ? 'px-4' : 'justify-center px-2')}>
        <span className="text-brand-500 font-bold text-lg tracking-tight shrink-0">{showLabels ? 'TerraOS' : 'T'}</span>
        {showLabels && <span className="text-gray-500 text-xs ml-2 whitespace-nowrap">UMOJA Robotics</span>}
      </div>

      <nav className="flex-1 py-4 space-y-1 px-2 overflow-x-hidden">
        {NAV_ITEMS.map(({ to, label, icon: NavIcon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onClose}
            title={!showLabels ? label : undefined}
            aria-label={label}
            className={({ isActive }) =>
              clsx(
                'h-10 flex items-center rounded-md text-sm font-medium transition-colors',
                showLabels ? 'gap-3 px-3' : 'justify-center px-2',
                isActive
                  ? 'bg-brand-900/30 text-brand-400 border border-brand-800/50'
                  : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800',
              )
            }
          >
            <NavIcon className="w-4 h-4 shrink-0" />
            {showLabels && <span className="whitespace-nowrap">{label}</span>}
          </NavLink>
        ))}
      </nav>
      <div className="divider-instrument h-8 shrink-0 hidden md:flex">
        <button
          onClick={onToggle}
          className={clsx('h-full flex items-center text-gray-500 hover:text-gray-100 hover:bg-gray-800 transition-colors', collapsed ? 'w-full justify-center' : 'w-full gap-3 px-5')}
          title={collapsed ? 'Déplier la navigation' : 'Replier la navigation'}
          aria-label={collapsed ? 'Déplier la navigation' : 'Replier la navigation'}
        >
          {collapsed ? <ChevronRightIcon className="w-4 h-4" /> : <ChevronLeftIcon className="w-4 h-4" />}
          {!collapsed && <span className="text-xs">Replier</span>}
        </button>
      </div>
      </aside>
    </>
  );
}
