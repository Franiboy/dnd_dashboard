import { io } from 'socket.io-client';
import { request } from 'http';

function post(path, body) {
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: 'localhost',
      port: 3001,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data ? JSON.parse(data) : {}));
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  const login = await post('/api/login', { username: 'admin', password: 'Schoengleina4812!' });
  if (!login.token) {
    console.log('Login failed', login);
    return;
  }
  console.log('Login ok:', login.user.displayName);

  const socket = io('http://localhost:3001', { auth: { token: login.token } });
  socket.on('connect', () => {
    console.log('socket connected, auto join');
    socket.emit('join');
  });
  socket.on('joined', (id) => {
    console.log('joined as player', id);
  });
  socket.on('state', (g) => {
    console.log('state players:', g.players.map((p) => p.name));
    console.log('status:', g.status);
  });
  socket.on('error', (msg) => console.log('error', msg));

  setTimeout(() => {
    console.log('timeout');
    socket.disconnect();
  }, 3000);
}

main().catch(console.error);
