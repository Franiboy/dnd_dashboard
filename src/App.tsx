import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { useState } from 'react';
import { useAuth, useSocket } from './hooks/useSocket';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Home } from './pages/Home';
import { Bingo } from './pages/Bingo';
import { Admin } from './pages/Admin';

function App() {
  const { user, token, loading, error, login, register, logout, setError } = useAuth();
  const { game, socket, playerId, bingo } = useSocket(token);
  const [showRegister, setShowRegister] = useState(false);

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
      setTimeout(() => setShowRegister(false), 2000);
    }
    return msg;
  };

  if (!user) {
    if (showRegister) {
      return <Register onRegister={handleRegister} onBack={() => setShowRegister(false)} error={error} />;
    }
    return <Login onLogin={handleLogin} onRegister={() => setShowRegister(true)} error={error} />;
  }

  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col">
        <header className="flex items-center justify-between px-6 py-3 border-b border-[var(--border)] bg-[var(--panel)]">
          <span className="font-semibold text-[var(--text-h)]">{user.displayName}</span>
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
          <Route path="/admin" element={user.isAdmin ? <Admin /> : <Navigate to="/" />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
