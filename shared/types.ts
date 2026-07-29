export interface Task {
  id: string;
  text: string;
  createdAt: string;
  isPrivate?: boolean;
  assignedTo?: string[];
}

export interface Cell {
  taskId: string | null;
  confirmedBy: string | null;
}

export interface Player {
  id: string;
  userId?: string;
  avatarUrl?: string | null;
  name: string;
  status: 'lobby' | 'playing' | 'bingo';
  board: Cell[][] | null;
  locked: boolean;
  online: boolean;
  joinedAt: string;
}

export interface BingoGame {
  id: string;
  status: 'setup' | 'playing' | 'finished';
  tasks: Task[];
  players: Player[];
  gridSize: number;
  createdAt: string;
  finishedAt: string | null;
}

export interface ServerToClientEvents {
  state: (game: BingoGame) => void;
  error: (message: string) => void;
  bingo: (playerName: string) => void;
  joined: (playerId: string) => void;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string | null;
  discordId: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
  isApproved: boolean;
  disabledApps: string[];
  failedLoginAttempts: number;
  lockedUntil: string | null;
  createdAt: string;
}

export interface SafeUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  isApproved: boolean;
  disabledApps: string[];
  isInitialAdmin: boolean;
}

export interface VersionInfo {
  aiEnabled: boolean;
  recordingEnabled: boolean;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id?: number;
  timestamp: string;
  level: LogLevel;
  category: string;
  message: string;
  args: unknown[];
}

export interface ClientToServerEvents {
  join: () => void;
  addTask: (payload: { text: string; isPrivate?: boolean; assignedTo?: string[] }) => void;
  removeTask: (taskId: string) => void;
  updateTask: (payload: { taskId: string; text?: string; isPrivate?: boolean; assignedTo?: string[] }) => void;
  setGridSize: (gridSize: number) => void;
  startGame: () => void;
  updateBoard: (board: Cell[][]) => void;
  lockBoard: () => void;
  unlockBoard: () => void;
  confirmTask: (taskId: string) => void;
  confirmTaskFor: (payload: { playerId: string; taskId: string }) => void;
  unconfirmTask: (taskId: string) => void;
  resetGame: () => void;
}

export type RecordingStatus = 'recording' | 'pending_transcription' | 'processing' | 'completed' | 'error';

export interface RecordingFile {
  id: number;
  sessionId: number;
  userId: string;
  displayName: string;
  pcmPath: string;
  wavPath: string | null;
  duration: number | null;
  transcriptPath: string | null;
}

export interface RecordingSession {
  id: number;
  name: string;
  status: RecordingStatus;
  guildId: string;
  channelId: string;
  createdBy: string;
  startedAt: string;
  stoppedAt: string | null;
  directory: string;
  transcript: string | null;
  error: string | null;
  trimStartSeconds: number | null;
  trimEndSeconds: number | null;
  hasWavFiles?: boolean;
  files?: RecordingFile[];
}

export interface RecordingChannel {
  id: string;
  name: string;
  participants: string[];
}

export interface TranscriptionProgress {
  currentFile: number;
  totalFiles: number;
  fileName: string;
  framesCurrent: number;
  framesTotal: number;
}

export interface DiaryEntry {
  id: number;
  userId: string;
  title: string;
  content: string;
  summary: string | null;
  rewrittenContent: string | null;
  rewrittenFilePath?: string | null;
  rewriteSessionId?: string | null;
  aiDirty?: boolean;
  aiProcessedAt?: string | null;
  persons: string[];
  organizations: string[];
  locations: string[];
  createdAt: string;
  updatedAt: string;
}

export type EntityType = 'persons' | 'organizations' | 'locations';

export interface EntitiesResponse {
  persons: string[];
  organizations: string[];
  locations: string[];
}

export interface EntityDetail {
  type: EntityType;
  canonical: string;
  aliases: string[];
}

export interface EntityMapping {
  type: EntityType;
  canonical: string;
  aliases: string[];
  miniSummary: string | null;
}

export interface EntityUpdatePayload {
  type: EntityType;
  oldName: string;
  newName: string;
  aliases: string[];
}

export interface EntityKnowledgeEntry {
  id: number;
  entityType: EntityType;
  entityName: string;
  title: string | null;
  content: string;
  source: string;
  status: 'active' | 'deleted';
  statusReason: string | null;
  createdAt: string;
  updatedAt: string;
}
