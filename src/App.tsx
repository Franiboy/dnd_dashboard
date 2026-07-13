import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { useSocket } from './hooks/useSocket';
import { Login } from './pages/Login';
import { Home } from './pages/Home';
import { Bingo } from './pages/Bingo';

function App() {
  const [password, setPassword] = useState<string | null>(localStorage.getItem('dnd_password'));
  const [loginError, setLoginError] = useState<string | null>(null);
  const { game, socket, playerId, bingo, error } = useSocket(password);

  useEffect(() => {
    if (error) setLoginError(error);
  }, [error]);

  const handleLogin = async (pw: string) => {
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      if (res.ok) {
        setPassword(pw);
        localStorage.setItem('dnd_password', pw);
        setLoginError(null);
      } else {
        setLoginError('Falsches Passwort');
      }
    } catch {
      setLoginError('Server nicht erreichbar');
    }
  };

  if (!password) {
    return <Login onLogin={handleLogin} error={loginError} />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/bingo" element={<Bingo game={game} socket={socket} playerId={playerId} bingo={bingo} />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
