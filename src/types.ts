import type { Socket as SocketIoSocket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/types';

export type Socket = SocketIoSocket<ServerToClientEvents, ClientToServerEvents>;
