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
  role?: UserRole;
  status: 'lobby' | 'playing' | 'bingo';
  board: Cell[][] | null;
  locked: boolean;
  online: boolean;
  joinedAt: string;
  wins?: number;
  /** True once this player's first bingo of the current round has been counted as a win. */
  winCounted?: boolean;
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

// Role of a user within the campaign. Every user starts as a guest;
// admins can promote users to dungeon master or player in the admin panel.
// Players and dungeon masters are permanent bingo participants: they always
// appear in the bingo player list and may join a running game at any time.
export type UserRole = 'guest' | 'dungeon_master' | 'player';

export const USER_ROLES: readonly UserRole[] = ['guest', 'dungeon_master', 'player'];

export interface User {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string | null;
  discordId: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
  isApproved: boolean;
  role: UserRole;
  disabledApps: string[];
  activePerson: string | null;
  autoSessionToDiary: boolean;
  autoAcceptSessionDiary: boolean;
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
  role: UserRole;
  disabledApps: string[];
  activePerson: string | null;
  autoSessionToDiary: boolean;
  autoAcceptSessionDiary: boolean;
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
  updateTask: (payload: {
    taskId: string;
    text?: string;
    isPrivate?: boolean;
    assignedTo?: string[];
  }) => void;
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

export type RecordingStatus =
  'recording' | 'pending_transcription' | 'processing' | 'completed' | 'error';

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

export interface SessionDiaryTransfer {
  entryId: number;
  transferredAt: string;
  autoAccepted: boolean;
  isOutdated: boolean;
}

export interface SessionDiaryEntryLink {
  entryId: number;
  userId: string;
  displayName: string;
  title: string;
  autoAccepted: boolean;
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
  transcribedTrimStartSeconds: number | null;
  transcribedTrimEndSeconds: number | null;
  transcriptImprovedAt: string | null;
  summary: string | null;
  summaryGeneratedAt: string | null;
  longSummary: string | null;
  longSummaryGeneratedAt: string | null;
  /** AI-detected start of the actual game play, in seconds from recording start. */
  gameStartSeconds: number | null;
  /** AI-detected end of the actual game play, in seconds from recording start. */
  gameEndSeconds: number | null;
  gameBoundaryDetectedAt: string | null;
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
  sessionDraftFor?: number | null;
  sessionDraftForName?: string | null;
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

/** Origin of a knowledge entry, if it was extracted from a source text. */
export type KnowledgeOriginType = 'diary' | 'session';

export interface EntityKnowledgeEntry {
  id: number;
  entityType: EntityType;
  entityName: string;
  title: string | null;
  content: string;
  source: string;
  status: 'active' | 'deleted';
  statusReason: string | null;
  /** Where this entry was extracted from, if known. Display-only, never linked. */
  originType: KnowledgeOriginType | null;
  originId: number | null;
  /** Title/name of the origin (diary entry title or session name) at display time. */
  originTitle: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BingoSuggestion {
  id: number;
  text: string;
  source: string;
  createdAt: string;
}
