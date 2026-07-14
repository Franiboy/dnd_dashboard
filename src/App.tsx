import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuth } from './hooks/useAuth';
import { useError } from './hooks/useError';
import { Layout } from './components/Layout';
import { PendingApproval } from './components/PendingApproval';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Login } from './pages/Login';
import { AdminLogin } from './pages/AdminLogin';
import { AuthCallback } from './pages/AuthCallback';
import { Home } from './pages/Home';
import { Bingo } from './pages/Bingo';
import { Admin } from './pages/Admin';
import { FeatureRequest } from './pages/FeatureRequest';

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
    return <div className="min-h-screen flex items-center justify-center text-slate-400">Lade...</div>;
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

  return (
    <BrowserRouter>
      <Layout user={user} onLogout={logout}>
        <Routes>
          <Route path="/admin" element={<ProtectedRoute user={user} adminOnly><Admin currentUser={user} /></ProtectedRoute>} />
          {isInitialAdmin ? (
            <Route path="*" element={<Navigate to="/admin" />} />
          ) : (
            <>
              <Route path="/" element={<Home />} />
              <Route path="/feature-request" element={<FeatureRequest />} />
              <Route path="/bingo" element={<ProtectedRoute user={user}><Bingo token={token} user={user} /></ProtectedRoute>} />
              <Route path="*" element={<Navigate to="/" />} />
            </>
          )}
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
