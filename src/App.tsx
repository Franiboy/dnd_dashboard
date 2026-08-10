import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect, useState, lazy, Suspense } from 'react';
import { Loading } from './components/Loading';
import { useAuth } from './hooks/useAuth';
import { useError } from './hooks/useError';
import { Layout } from './components/Layout';
import { PendingApproval } from './components/PendingApproval';
import { ProtectedRoute } from './components/ProtectedRoute';
import { EntityDialogRouteSync } from './components/EntityDialogRouteSync';
import { EntityDialogProvider } from './contexts/EntityDialogProvider';
import { MappingsProvider } from './contexts/MappingsProvider';
import { Login } from './pages/Login';
import { AdminLogin } from './pages/AdminLogin';
import { AuthCallback } from './pages/AuthCallback';
import { Home } from './pages/Home';
import type { VersionInfo } from '../shared/types';

const Bingo = lazy(() => import('./pages/Bingo').then((m) => ({ default: m.Bingo })));
const Admin = lazy(() => import('./pages/Admin').then((m) => ({ default: m.Admin })));
const Diary = lazy(() => import('./pages/Diary').then((m) => ({ default: m.Diary })));
const Sessions = lazy(() => import('./pages/Recordings').then((m) => ({ default: m.Sessions })));
const World = lazy(() => import('./pages/World').then((m) => ({ default: m.World })));

const PUBLIC_PATHS = ['/', '/admin-login', '/auth/discord'];

interface PublicRoutesProps {
  error: string | null;
  loginAdmin: (username: string, password: string) => Promise<boolean>;
  startDiscordLogin: () => Promise<string | null>;
  handleDiscordCallback: (code: string, state: string) => Promise<{ ok: boolean; pending?: boolean; message?: string }>;
  checkApproved: () => Promise<boolean>;
}

function PublicRoutes({
  error,
  loginAdmin,
  startDiscordLogin,
  handleDiscordCallback,
  checkApproved,
}: PublicRoutesProps) {
  const location = useLocation();
  const { showError } = useError();

  useEffect(() => {
    if (!PUBLIC_PATHS.includes(location.pathname)) {
      showError('Bitte einloggen, um diese Seite zu sehen.');
    }
  }, [location.pathname, showError]);

  return (
    <Routes>
      <Route path="/" element={<Login onDiscordLogin={startDiscordLogin} error={error} />} />
      <Route path="/admin-login" element={<AdminLogin onLogin={loginAdmin} error={error} />} />
      <Route path="/auth/discord" element={<AuthCallback onCallback={handleDiscordCallback} onCheckApproved={checkApproved} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  const { user, loading, error, loginAdmin, handleDiscordCallback, startDiscordLogin, logout, checkApproved, updateUser } = useAuth();
  const [version, setVersion] = useState<VersionInfo | null | undefined>(undefined);

  useEffect(() => {
    fetch('/api/version')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: VersionInfo | null) => {
        setVersion(data);
      })
      .catch(() => {
        setVersion(null);
      });
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loading size="lg" />
      </div>
    );
  }

  if (!user) {
    return (
      <BrowserRouter>
        <PublicRoutes
          error={error}
          loginAdmin={loginAdmin}
          startDiscordLogin={startDiscordLogin}
          handleDiscordCallback={handleDiscordCallback}
          checkApproved={checkApproved}
        />
      </BrowserRouter>
    );
  }

  if (!user.isApproved && !user.isAdmin) {
    return (
      <PendingApproval
        user={{ displayName: user.displayName, avatarUrl: user.avatarUrl }}
        onCheckApproved={checkApproved}
        onLogout={logout}
      />
    );
  }

  const pageLoader = (
    <div className="h-full flex items-center justify-center">
      <Loading size="lg" />
    </div>
  );

  return (
    <BrowserRouter>
      <MappingsProvider>
        <EntityDialogProvider>
          <Layout user={user} version={version} onLogout={logout} onUserChange={updateUser}>
            <Suspense fallback={pageLoader}>
              <Routes>
                <Route path="/admin" element={<ProtectedRoute user={user} appId="admin" version={version}><Admin currentUser={user} /></ProtectedRoute>} />
                <Route path="/" element={<Home version={version} />} />
                <Route path="/tagebuch" element={<ProtectedRoute user={user} appId="notes" version={version}><Diary /></ProtectedRoute>} />
                <Route path="/welt" element={<ProtectedRoute user={user} appId="world" version={version}><World /></ProtectedRoute>} />
                <Route path="/sessions" element={<ProtectedRoute user={user} appId="sessions" version={version}><Sessions user={user} /></ProtectedRoute>} />
                <Route path="/bingo" element={<ProtectedRoute user={user} appId="bingo" version={version}><Bingo user={user} /></ProtectedRoute>} />
                <Route path="*" element={<Navigate to="/" />} />
              </Routes>
            </Suspense>
          </Layout>
          <EntityDialogRouteSync />
        </EntityDialogProvider>
      </MappingsProvider>
    </BrowserRouter>
  );
}

export default App;
