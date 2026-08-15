import type { SystemHealthEvent, LiveFault } from '@terra-os/types';
import { FaultSeverity } from '@terra-os/types';
import clsx from 'clsx';

const SEV_COLOR: Record<FaultSeverity, string> = {
  [FaultSeverity.ERROR]: 'text-red-400',
  [FaultSeverity.WARNING]: 'text-orange-400',
  [FaultSeverity.NOTIFICATION]: 'text-blue-400',
};

const SEV_DOT: Record<FaultSeverity, string> = {
  [FaultSeverity.ERROR]: 'bg-red-500',
  [FaultSeverity.WARNING]: 'bg-orange-500',
  [FaultSeverity.NOTIFICATION]: 'bg-blue-500',
};

interface Props {
  health: SystemHealthEvent | null;
}

function FaultRow({ fault }: { fault: LiveFault }) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-gray-800 last:border-0">
      <span className={clsx('w-2 h-2 rounded-full mt-1 shrink-0', SEV_DOT[fault.severity])} />
      <div className="min-w-0">
        <div className={clsx('text-xs font-mono', SEV_COLOR[fault.severity])}>
          [{fault.severity}] {fault.source}
        </div>
        <div className="text-xs text-gray-400 truncate">{fault.msg}</div>
      </div>
    </div>
  );
}

export function HealthWidget({ health }: Props) {
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-500 uppercase tracking-wide">Health</span>
        {health?.level && (
          <span
            className={clsx(
              'text-xs px-2 py-0.5 rounded-full font-mono',
              health.level === 'OK' ? 'badge-online' : health.level === 'ERROR' ? 'badge-error' : 'bg-orange-900/50 text-orange-400 border border-orange-800',
            )}
          >
            {health.level}
          </span>
        )}
      </div>

      {!health || (health.faults ?? []).length === 0 ? (
        <div className="text-xs text-gray-600 font-mono">No active faults</div>
      ) : (
        <div className="space-y-0 max-h-36 overflow-y-auto">
          {(health.faults ?? []).map((fault, i) => (
            <FaultRow key={i} fault={fault} />
          ))}
        </div>
      )}
    </div>
  );
}
