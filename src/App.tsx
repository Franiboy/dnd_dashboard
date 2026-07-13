import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { useState } from 'react';
import { useAuth, useSocket } from './hooks/useSocket';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Home } from './pages/Home';
import { Bingo } from './pages/Bingo';
import { Admin } from './pages/Admin';
import { Profile } from './pages/Profile';
import { Toast } from './components/Toast';

function App() {
  const { user, token, loading, error, login, register, updateDisplayName, logout, setError } = useAuth();
  const { game, socket, playerId, bingo } = useSocket(token, user);
  const [showRegister, setShowRegister] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-slate-400">Lade...</div>;
  }

  const handleLogin = async (username: string, password: string) => {
    await login(username, password);
  };

  const handleRegister = async (username: string, displayName: string, password: string) => {
    setError(null);
    const msg = await register(username, displayName, password);
    if (msg) {
      setToast(msg);
      setShowRegister(false);
    }
    return msg;
  };

  if (!user) {
    return (
      <>
        <Toast message={toast} onClose={() => setToast(null)} />
        {showRegister ? (
          <Register onRegister={handleRegister} onBack={() => setShowRegister(false)} error={error} />
        ) : (
          <Login onLogin={handleLogin} onRegister={() => setShowRegister(true)} error={error} />
        )}
      </>
    );
  }

  return (
    <BrowserRouter>
      <Toast message={toast} onClose={() => setToast(null)} />
      <div className="min-h-screen flex flex-col">
        <header className="flex items-center justify-between px-6 py-3 border-b border-[var(--border)] bg-[var(--panel)]">
          <Link to="/profile" className="font-semibold text-[var(--text-h)] hover:text-[var(--accent)]">{user.displayName}</Link>
          <div className="flex gap-4">
            {user.isAdmin && (
              <Link to="/admin" className="text-slate-400 hover:text-[var(--text-h)]">Admin</Link>
            )}
            <button onClick={logout} className="text-slate-400 hover:text-[var(--text-h)]">Logout</button>
          </div>
        </header>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/bingo" element={<Bingo game={game} socket={socket} playerId={playerId} bingo={bingo} />} />
          <Route path="/admin" element={user.isAdmin ? <Admin currentUser={user} /> : <Navigate to="/" />} />
          <Route path="/profile" element={<Profile user={user} onUpdateDisplayName={updateDisplayName} />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
