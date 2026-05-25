import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/axios';
import type { Plugin } from '@terra-os/types';
import clsx from 'clsx';

export function PluginsPage() {
  const qc = useQueryClient();
  const { data: plugins = [], isLoading } = useQuery({
    queryKey: ['plugins'],
    queryFn: () => api.get<Plugin[]>('/api/v1/plugins').then((r) => r.data),
  });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api
        .patch(`/api/v1/plugins/${id}/${enabled ? 'enable' : 'disable'}`)
        .then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plugins'] }),
  });

  if (isLoading) return <div className="text-gray-500 text-sm">Loading…</div>;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-100">Plugins</h1>

      <div className="space-y-3">
        {plugins.length === 0 && (
          <p className="text-gray-500 text-sm">No plugins registered.</p>
        )}
        {plugins.map((plugin) => (
          <div key={plugin.id} className="card flex items-center justify-between">
            <div>
              <div className="font-medium text-sm text-gray-100">{plugin.name}</div>
              <div className="text-xs text-gray-500 mt-1">
                v{plugin.manifest.version} · {plugin.manifest.author}
              </div>
              <div className="text-xs text-gray-600 mt-1">
                {plugin.manifest.permissions.join(', ')}
              </div>
            </div>
            <button
              onClick={() => toggle.mutate({ id: plugin.id, enabled: !plugin.enabled })}
              className={clsx(
                'text-xs px-3 py-1 rounded-md font-medium transition-colors',
                plugin.enabled
                  ? 'bg-red-900/30 text-red-400 hover:bg-red-900/50'
                  : 'bg-brand-900/30 text-brand-400 hover:bg-brand-900/50',
              )}
            >
              {plugin.enabled ? 'Disable' : 'Enable'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
