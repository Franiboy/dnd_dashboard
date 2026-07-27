import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect, lazy, Suspense } from 'react';
import { Loading } from './components/Loading';
import { useAuth } from './hooks/useAuth';
import { useError } from './hooks/useError';
import { Layout } from './components/Layout';
import { PendingApproval } from './components/PendingApproval';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Login } from './pages/Login';
import { AdminLogin } from './pages/AdminLogin';
import { AuthCallback } from './pages/AuthCallback';
import { Home } from './pages/Home';

const Bingo = lazy(() => import('./pages/Bingo').then((m) => ({ default: m.Bingo })));
const Admin = lazy(() => import('./pages/Admin').then((m) => ({ default: m.Admin })));
const Notes = lazy(() => import('./pages/Diary').then((m) => ({ default: m.Diary })));
const Recordings = lazy(() => import('./pages/Recordings').then((m) => ({ default: m.Recordings })));
const World = lazy(() => import('./pages/World').then((m) => ({ default: m.World })));

const PUBLIC_PATHS = ['/', '/admin-login', '/auth/discord'];

interface PublicRoutesProps {
  error: string | null;
  loginAdmin: (username: string, password: string) => Promise<boolean>;
  startDiscordLogin: () => Promise<string | null>;
  handleDiscordCallback: (code: string) => Promise<{ ok: boolean; message?: string }>;
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
  const { user, token, loading, error, loginAdmin, handleDiscordCallback, startDiscordLogin, logout, checkApproved } = useAuth();

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

  const isInitialAdmin = user.username === 'admin';

  const pageLoader = (
    <div className="h-full flex items-center justify-center">
      <Loading size="lg" />
    </div>
  );

  return (
    <BrowserRouter>
      <Layout user={user} onLogout={logout}>
        <Suspense fallback={pageLoader}>
          <Routes>
            <Route path="/admin" element={<ProtectedRoute user={user} adminOnly><Admin currentUser={user} /></ProtectedRoute>} />
            {isInitialAdmin ? (
              <Route path="*" element={<Navigate to="/admin" />} />
            ) : (
              <>
                <Route path="/" element={<Home />} />
                <Route path="/notizen" element={<ProtectedRoute user={user} appId="notes"><Notes /></ProtectedRoute>} />
                <Route path="/welt" element={<ProtectedRoute user={user} appId="world"><World /></ProtectedRoute>} />
                <Route path="/recordings" element={<ProtectedRoute user={user} appId="recordings" adminOnly><Recordings /></ProtectedRoute>} />
                <Route path="/bingo" element={<ProtectedRoute user={user} appId="bingo"><Bingo token={token} user={user} /></ProtectedRoute>} />
                <Route path="*" element={<Navigate to="/" />} />
              </>
            )}
          </Routes>
        </Suspense>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
