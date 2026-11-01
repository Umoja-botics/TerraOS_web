import type { RobotEventPayload } from '@terra-os/types';
import clsx from 'clsx';
import type { ReactNode } from 'react';
import { CircleCheckIcon, NavigationIcon, RouteIcon, TriangleAlertIcon, XIcon } from '@/components/icons';

const TYPE_COLOR: Record<string, string> = {
  mission: 'text-brand-400',
  wp: 'text-blue-400',
  ok: 'text-green-400',
  warn: 'text-orange-400',
  alarm: 'text-red-400',
  system: 'text-gray-500',
};

const TYPE_PREFIX: Record<string, ReactNode> = {
  mission: <RouteIcon className="w-3 h-3" />,
  wp: <NavigationIcon className="w-3 h-3" />,
  ok: <CircleCheckIcon className="w-3 h-3" />,
  warn: <TriangleAlertIcon className="w-3 h-3" />,
  alarm: <XIcon className="w-3 h-3" />,
  system: <span>·</span>,
};

interface Props {
  events: RobotEventPayload[];
}

export function EventLog({ events }: Props) {
  return (
    <div className="card">
      <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Event Log</div>
      {events.length === 0 ? (
        <div className="text-xs text-gray-600 font-mono">En attente d'événements…</div>
      ) : (
        <div className="space-y-0 max-h-40 overflow-y-auto font-mono text-xs">
          {events.map((ev, i) => (
            <div key={i} className="flex items-start gap-2 py-1.5 border-b border-gray-800/50 last:border-0">
              <span className={clsx('w-3 shrink-0 text-center', TYPE_COLOR[ev.type] ?? 'text-gray-500')}>
                {TYPE_PREFIX[ev.type] ?? <span>·</span>}
              </span>
              <span className="text-gray-600 shrink-0 text-[10px]">
                {new Date(ev.timestamp).toLocaleTimeString()}
              </span>
              <span className={clsx(TYPE_COLOR[ev.type] ?? 'text-gray-400')}>{ev.msg}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
