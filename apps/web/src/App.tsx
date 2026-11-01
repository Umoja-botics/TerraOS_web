import { Routes, Route, Navigate } from 'react-router-dom';
import { Shell } from '@/components/layout/Shell';
import { useAuth } from '@/hooks/useAuth';
import { LoginPage } from '@/pages/Login';

// Pages chargées lazily pour isoler les erreurs de module
import { lazy, Suspense, Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(_err: Error, info: ErrorInfo) {
    console.error('[Terra] render error:', _err, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, color: '#f87171', fontFamily: 'monospace' }}>
          <strong>Une erreur est survenue</strong>
          <pre style={{ marginTop: 8, fontSize: 12, color: '#9ca3af', whiteSpace: 'pre-wrap' }}>
            {(this.state.error as Error).message}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: 16, padding: '6px 16px', background: '#374151', color: '#e5e7eb', border: 'none', borderRadius: 6, cursor: 'pointer' }}
          >
            Recharger le widget
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
const DashboardPage = lazy(() => import('@/pages/Dashboard').then(m => ({ default: m.DashboardPage })));
const FleetPage = lazy(() => import('@/pages/Fleet').then(m => ({ default: m.FleetPage })));
const MissionsPage = lazy(() => import('@/pages/Missions').then(m => ({ default: m.MissionsPage })));
const PathsPage = lazy(() => import('@/pages/Paths').then(m => ({ default: m.PathsPage })));
const ReportsPage = lazy(() => import('@/pages/Reports').then(m => ({ default: m.ReportsPage })));
const PluginsPage = lazy(() => import('@/pages/Plugins').then(m => ({ default: m.PluginsPage })));
const SettingsPage  = lazy(() => import('@/pages/Settings').then(m => ({ default: m.SettingsPage })));

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <ErrorBoundary>
    <Suspense fallback={<div style={{ padding: 32, color: '#888' }}>Chargement…</div>}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Shell />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="fleet" element={<FleetPage />} />
          <Route path="missions" element={<MissionsPage />} />
          <Route path="planner" element={<Navigate to="/missions" replace />} />
          <Route path="paths" element={<PathsPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="plugins" element={<PluginsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </Suspense>
    </ErrorBoundary>
  );
}
