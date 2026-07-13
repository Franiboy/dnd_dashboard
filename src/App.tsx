import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth, useSocket } from './hooks/useSocket';
import { Login } from './pages/Login';
import { AdminLogin } from './pages/AdminLogin';
import { AuthCallback } from './pages/AuthCallback';
import { Home } from './pages/Home';
import { Bingo } from './pages/Bingo';
import { Admin } from './pages/Admin';
import { Toast } from './components/Toast';

function PendingApproval({ user, onCheckApproved, onLogout }: { user: { displayName: string; avatarUrl: string | null }; onCheckApproved: () => Promise<boolean>; onLogout: () => void }) {
  const message = 'Dein Account wurde noch nicht freigegeben.';

  useEffect(() => {
    const check = async () => {
      const approved = await onCheckApproved();
      if (approved) {
        window.location.href = '/';
      }
    };
    check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, [onCheckApproved]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-8 shadow-xl text-center">
        <div className="w-12 h-12 border-4 border-[var(--accent)] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        {user.avatarUrl && <img src={user.avatarUrl} alt="" className="w-16 h-16 rounded-full mx-auto mb-4" />}
        <h2 className="text-xl font-semibold text-[var(--text-h)] mb-2">Warte auf Freigabe</h2>
        <p className="text-slate-400 mb-4">{message}</p>
        <p className="text-sm text-slate-500 mb-4">
          Diese Seite prüft automatisch alle 5 Sekunden, ob ein Admin dich freigegeben hat.
        </p>
        <button onClick={onLogout} className="text-slate-400 hover:text-[var(--text-h)] underline">Logout</button>
      </div>
    </div>
  );
}

function App() {
  const { user, token, loading, error, loginAdmin, handleDiscordCallback, startDiscordLogin, logout, checkApproved } = useAuth();
  const { game, socket, playerId, bingo } = useSocket(token, user);
  const [toast, setToast] = useState<string | null>(null);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-slate-400">Lade...</div>;
  }

  const handleAdminLogin = async (username: string, password: string) => {
    return await loginAdmin(username, password);
  };

  const handleDiscord = async () => {
    return await startDiscordLogin();
  };

  if (!user) {
    return (
      <BrowserRouter>
        <Toast message={toast} onClose={() => setToast(null)} />
        <Routes>
          <Route path="/" element={<Login onDiscordLogin={handleDiscord} error={error} />} />
          <Route path="/admin-login" element={<AdminLogin onLogin={handleAdminLogin} error={error} />} />
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

  if (user.isAdmin) {
    return (
      <BrowserRouter>
        <Toast message={toast} onClose={() => setToast(null)} />
        <div className="min-h-screen flex flex-col">
          <header className="flex items-center justify-between px-6 py-3 border-b border-[var(--border)] bg-[var(--panel)]">
            <span className="font-semibold text-[var(--text-h)]">{user.displayName}</span>
            <button onClick={logout} className="text-slate-400 hover:text-[var(--text-h)]">Logout</button>
          </header>
          <Routes>
            <Route path="/admin" element={<Admin currentUser={user} />} />
            <Route path="*" element={<Navigate to="/admin" />} />
          </Routes>
        </div>
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      <Toast message={toast} onClose={() => setToast(null)} />
      <div className="min-h-screen flex flex-col">
        <header className="flex items-center justify-between px-6 py-3 border-b border-[var(--border)] bg-[var(--panel)]">
          <div className="flex items-center gap-3 font-semibold text-[var(--text-h)]">
            {user.avatarUrl && <img src={user.avatarUrl} alt="" className="w-8 h-8 rounded-full" />}
            <span>{user.displayName}</span>
          </div>
          <button onClick={logout} className="text-slate-400 hover:text-[var(--text-h)]">Logout</button>
        </header>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/bingo" element={<Bingo game={game} socket={socket} playerId={playerId} bingo={bingo} />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
