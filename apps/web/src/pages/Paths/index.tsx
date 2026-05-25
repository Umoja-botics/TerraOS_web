import { lazy, Suspense, useState } from 'react';
import { usePaths, useDeletePath } from '@/hooks/useApi';
import { NavMode } from '@terra-os/types';
import type { Path } from '@terra-os/types';

const PathEditor = lazy(() =>
  import('./PathEditor').then((m) => ({ default: m.PathEditor })),
);

export function PathsPage() {
  const { data: paths = [], isLoading } = usePaths();
  const deletePath = useDeletePath();
  const [showEditor, setShowEditor] = useState(false);
  const [editing, setEditing] = useState<Path | null>(null);

  const handleEdit = (path: Path) => {
    setEditing(path);
    setShowEditor(true);
  };

  const handleClose = () => {
    setShowEditor(false);
    setEditing(null);
  };

  if (showEditor) {
    return (
      <Suspense fallback={<div className="text-gray-500 text-sm">Loading editor…</div>}>
        <PathEditor onClose={handleClose} initialPath={editing ?? undefined} />
      </Suspense>
    );
  }

  if (isLoading) return <div className="text-gray-500 text-sm">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-100">Path Library</h1>
        <button onClick={() => setShowEditor(true)} className="btn-primary text-sm">
          + New Path
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {paths.length === 0 && (
          <div className="col-span-full card text-center py-10">
            <p className="text-gray-500 text-sm mb-4">No paths defined yet.</p>
            <button onClick={() => setShowEditor(true)} className="btn-secondary text-sm">
              Create your first path
            </button>
          </div>
        )}
        {paths.map((path) => (
          <div key={path.id} className="card space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm text-gray-100 truncate pr-2">{path.name}</span>
              <span className="text-xs px-2 py-0.5 rounded-full font-mono bg-blue-900/30 text-blue-400 border border-blue-800 shrink-0">
                {path.navMode === NavMode.FOLLOW_WAYPOINTS ? 'FOLLOW_WP' : path.navMode}
              </span>
            </div>
            <div className="text-xs text-gray-500 space-y-1">
              <div>{path.waypoints.length} waypoints</div>
              <div>Créé le {new Date(path.createdAt).toLocaleDateString()}</div>
            </div>
            <div className="flex gap-2 pt-1 border-t border-gray-800">
              <button
                onClick={() => handleEdit(path)}
                className="flex-1 text-xs py-1.5 border border-gray-700 text-gray-400 rounded-md hover:bg-gray-800 transition-colors"
              >
                Modifier
              </button>
              <button
                onClick={() => {
                  if (window.confirm(`Supprimer le path "${path.name}" ?`)) {
                    deletePath.mutate(path.id);
                  }
                }}
                className="text-xs px-3 py-1.5 border border-red-800/50 text-red-400 rounded-md hover:bg-red-900/20 transition-colors"
              >
                Supprimer
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
