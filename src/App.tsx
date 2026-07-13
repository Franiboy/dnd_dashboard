import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { useState } from 'react';
import { useAuth, useSocket } from './hooks/useSocket';
import { Login } from './pages/Login';
import { AdminLogin } from './pages/AdminLogin';
import { AuthCallback } from './pages/AuthCallback';
import { Home } from './pages/Home';
import { Bingo } from './pages/Bingo';
import { Admin } from './pages/Admin';
import { Profile } from './pages/Profile';
import { Toast } from './components/Toast';

function App() {
  const { user, token, loading, error, loginAdmin, handleDiscordCallback, startDiscordLogin, updateDisplayName, logout, checkApproved } = useAuth();
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
          <Link to="/profile" className="flex items-center gap-3 font-semibold text-[var(--text-h)] hover:text-[var(--accent)]">
            {user.avatarUrl && <img src={user.avatarUrl} alt="" className="w-8 h-8 rounded-full" />}
            <span>{user.displayName}</span>
          </Link>
          <div className="flex gap-4">
            <button onClick={logout} className="text-slate-400 hover:text-[var(--text-h)]">Logout</button>
          </div>
        </header>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/bingo" element={<Bingo game={game} socket={socket} playerId={playerId} bingo={bingo} />} />
          <Route path="/profile" element={<Profile user={user} onUpdateDisplayName={updateDisplayName} />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
