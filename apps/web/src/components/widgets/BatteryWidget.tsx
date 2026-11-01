import clsx from 'clsx';
import { BatteryFullIcon, BatteryLowIcon, BatteryMediumIcon, BatteryWarningIcon } from '@/components/icons';

interface Props {
  battery: number | null; // Normalized to 0..1 by fleetStore.
}

export function BatteryWidget({ battery }: Props) {
  const pct = battery !== null ? Math.round(battery * 100) : null;
  const color =
    pct === null ? 'bg-gray-700'
    : pct > 60 ? 'bg-green-500'
    : pct > 25 ? 'bg-orange-500'
    : 'bg-red-500';
  const BatteryIcon = pct === null || pct <= 10 ? BatteryWarningIcon : pct <= 25 ? BatteryLowIcon : pct <= 60 ? BatteryMediumIcon : BatteryFullIcon;

  return (
    <div className="card">
      <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-2 uppercase tracking-wide"><BatteryIcon className="w-3.5 h-3.5" /> Battery</div>
      <div className="flex items-center gap-3">
        <div className="flex-1 h-3 bg-gray-800 rounded-full overflow-hidden">
          <div
            className={clsx('h-full rounded-full transition-all', color)}
            style={{ width: pct !== null ? `${pct}%` : '0%' }}
          />
        </div>
        <span className={clsx('text-sm font-mono font-bold min-w-[3rem] text-right', pct === null ? 'text-gray-600' : pct > 25 ? 'text-gray-200' : 'text-red-400')}>
          {pct !== null ? `${pct}%` : '—'}
        </span>
      </div>
    </div>
  );
}
