import { Routes, Route, Navigate } from 'react-router-dom';
import { Shell } from '@/components/layout/Shell';
import { useAuth } from '@/hooks/useAuth';
import { LoginPage } from '@/pages/Login';

// Pages chargées lazily pour isoler les erreurs de module
import { lazy, Suspense } from 'react';
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
  );
}
