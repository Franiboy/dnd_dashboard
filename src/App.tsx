import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { Layout } from './components/Layout';
import { PendingApproval } from './components/PendingApproval';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Toast } from './components/Toast';
import { Login } from './pages/Login';
import { AdminLogin } from './pages/AdminLogin';
import { AuthCallback } from './pages/AuthCallback';
import { Home } from './pages/Home';
import { Bingo } from './pages/Bingo';
import { Admin } from './pages/Admin';

function App() {
  const { user, token, loading, error, loginAdmin, handleDiscordCallback, startDiscordLogin, logout, checkApproved, setError } = useAuth();
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (error) {
      setToast(error);
      setError(null);
    }
  }, [error, setError]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-slate-400">Lade...</div>;
  }

  if (!user) {
    return (
      <BrowserRouter>
        <Toast message={toast} onClose={() => setToast(null)} />
        <Routes>
          <Route path="/" element={<Login onDiscordLogin={startDiscordLogin} error={error} />} />
          <Route path="/admin-login" element={<AdminLogin onLogin={loginAdmin} error={error} />} />
          <Route path="/auth/discord" element={<AuthCallback onCallback={handleDiscordCallback} onCheckApproved={checkApproved} />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
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
      <Toast message={toast} onClose={() => setToast(null)} />
      <Layout user={user} onLogout={logout}>
        <Routes>
          <Route path="/admin" element={<ProtectedRoute user={user} adminOnly><Admin currentUser={user} /></ProtectedRoute>} />
          {isInitialAdmin ? (
            <Route path="*" element={<Navigate to="/admin" />} />
          ) : (
            <>
              <Route path="/" element={<Home />} />
              <Route path="/bingo" element={<ProtectedRoute user={user}><Bingo token={token} user={user} onError={(msg) => setToast(msg)} /></ProtectedRoute>} />
              <Route path="*" element={<Navigate to="/" />} />
            </>
          )}
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
