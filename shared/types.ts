export interface Task {
  id: string;
  text: string;
  createdAt: string;
  isPrivate?: boolean;
  assignedTo?: string[];
  /**
   * Pool this task belongs to. Absent means the regular player pool.
   * Dungeon masters fill their boards exclusively from the 'dm' pool;
   * those tasks describe moments the DM observes at the table.
   */
  audience?: TaskAudience;
}

export type TaskAudience = 'players' | 'dm';

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

// ---------------------------------------------------------------------------
// Whiteboard
// ---------------------------------------------------------------------------

export type WhiteboardElementType =
  'note' | 'task' | 'arrow' | 'link' | 'shape' | 'stroke' | 'text';

export type WhiteboardZone = 'public' | 'private';

export type WhiteboardTaskStatus = 'open' | 'in_progress' | 'done';

/** Kind of vector outline rendered for elements of type "shape". */
export type WhiteboardShapeKind = 'rect' | 'ellipse' | 'triangle' | 'diamond';

/**
 * One element on the shared whiteboard canvas.
 * Notes, tasks and links occupy the box (x, y, width, height); arrows run from
 * (x, y) to (x2, y2) and may be anchored to other elements via fromId/toId,
 * in which case the endpoints follow those elements on every render.
 *
 * Shapes (rect/ellipse/triangle/diamond) render an outline inside the box,
 * optionally filled with fillColor. Freehand strokes store their points
 * normalized to the box (each coordinate 0..1 relative to width/height), so
 * moving and resizing only touches x/y/width/height.
 */
export interface WhiteboardElement {
  id: string;
  type: WhiteboardElementType;
  zone: WhiteboardZone;
  ownerId: string;
  ownerName: string;
  x: number;
  y: number;
  x2: number | null;
  y2: number | null;
  width: number;
  height: number;
  color: string;
  text: string;
  description: string | null;
  status: WhiteboardTaskStatus | null;
  url: string | null;
  fromId: string | null;
  toId: string | null;
  /** Outline variant for type "shape"; null for all other types. */
  shapeKind: WhiteboardShapeKind | null;
  /** Interior fill for type "shape"; null renders a transparent interior. */
  fillColor: string | null;
  /** Outline width in world units for types "shape" and "stroke". */
  strokeWidth: number;
  /** Normalized [x, y] pairs (0..1) of a freehand stroke; null otherwise. */
  points: [number, number][] | null;
  /**
   * Stacking order among non-arrow elements; higher values render on top.
   * Ties fall back to creation order, so legacy rows (0) keep their order.
   */
  zIndex: number;
  /** Pinned elements cannot be moved or resized until unlocked. */
  locked: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Editable subset of a whiteboard element used by update operations. */
export interface WhiteboardPatch {
  x?: number;
  y?: number;
  x2?: number | null;
  y2?: number | null;
  width?: number;
  height?: number;
  color?: string;
  text?: string;
  description?: string | null;
  status?: WhiteboardTaskStatus | null;
  url?: string | null;
  fromId?: string | null;
  toId?: string | null;
  shapeKind?: WhiteboardShapeKind;
  fillColor?: string | null;
  strokeWidth?: number;
  points?: [number, number][] | null;
  /** Layer ordering: higher renders on top of other non-arrow elements. */
  zIndex?: number;
  locked?: boolean;
  /** Moving an element across the divider switches its zone. */
  zone?: WhiteboardZone;
}

/**
 * World y coordinate of the divider between the public band (above) and the
 * private area (below). Shared so client visuals and server-side zone
 * defaults stay consistent.
 */
export const WHITEBOARD_DIVIDER_Y = 0;

export interface ServerToClientEvents {
  state: (game: BingoGame) => void;
  error: (message: string) => void;
  bingo: (playerName: string) => void;
  joined: (playerId: string) => void;
  wbElements: (elements: WhiteboardElement[]) => void;
  wbUpsert: (element: WhiteboardElement) => void;
  wbRemoved: (id: string) => void;
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
  /** Local development only: the backend offers an automatic admin login. */
  devAutoLogin?: boolean;
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
  addTask: (payload: {
    text: string;
    isPrivate?: boolean;
    assignedTo?: string[];
    audience?: TaskAudience;
  }) => void;
  removeTask: (taskId: string) => void;
  updateTask: (payload: {
    taskId: string;
    text?: string;
    isPrivate?: boolean;
    assignedTo?: string[];
    audience?: TaskAudience;
  }) => void;
  setGridSize: (gridSize: number) => void;
  startGame: () => void;
  updateBoard: (board: Cell[][]) => void;
  lockBoard: () => void;
  unlockBoard: () => void;
  confirmTask: (taskId: string) => void;
  confirmTaskFor: (payload: { playerId: string; taskId: string }) => void;
  unconfirmTask: (taskId: string) => void;
  /** DM-only: mark a dm-pool task on the own board without affecting others. */
  confirmOwnTask: (taskId: string) => void;
  unconfirmOwnTask: (taskId: string) => void;
  resetGame: () => void;
  wbCreate: (element: WhiteboardElement) => void;
  wbUpdate: (payload: { id: string; patch: WhiteboardPatch }) => void;
  wbRemove: (id: string) => void;
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
  /** Monotonic in-game day of the campaign this session belongs to (sortable). */
  gameDay: number | null;
  /** Inclusive end of the in-game day range (for multi-day sessions). */
  gameDayEnd: number | null;
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
  items: string[];
  /** Monotonic in-game day of this entry ("Eintrag = Spieltag"). */
  gameDay: number | null;
  createdAt: string;
  updatedAt: string;
}

export type EntityType = 'persons' | 'organizations' | 'locations' | 'items';

/**
 * One known entity of the world knowledge graph.
 *
 * Names alone are not unique in a campaign (two different beings can both be
 * called "Kerigan"). The optional qualifier disambiguates them, e.g.
 * "Kerigan" + "Begleiter von Calzone". Uniqueness is (name, qualifier);
 * an empty qualifier means the plain, unambiguous name.
 */
export interface EntityListItem {
  name: string;
  qualifier: string;
}

/** Formatted display form of an entity: "Name" or "Name (Qualifier)". */
export type EntityLabel = string;

export interface EntitiesResponse {
  persons: EntityListItem[];
  organizations: EntityListItem[];
  locations: EntityListItem[];
  items: EntityListItem[];
}

export interface EntityDetail {
  type: EntityType;
  canonical: string;
  qualifier: string;
  aliases: string[];
}

export interface EntityMapping {
  type: EntityType;
  canonical: string;
  qualifier: string;
  /** Display form "Name" or "Name (Qualifier)" used wherever entities are listed. */
  label: EntityLabel;
  aliases: string[];
  miniSummary: string | null;
}

export interface EntityUpdatePayload {
  type: EntityType;
  oldName: string;
  oldQualifier?: string;
  newName: string;
  newQualifier?: string;
  aliases: string[];
}

/** Origin of a knowledge entry, if it was extracted from a source text. */
export type KnowledgeOriginType = 'diary' | 'session';

/** One in-game day of the central campaign timeline. */
export interface CampaignDay {
  day: number;
}

export interface EntityKnowledgeEntry {
  id: number;
  entityType: EntityType;
  entityName: string;
  /** Disambiguator of the entity; '' targets the plain name. */
  entityQualifier: string;
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
  /**
   * First in-game day (recording_sessions.game_day) the fact holds (inclusive).
   * NULL means timeless/from the beginning.
   */
  validFrom: number | null;
  /**
   * First in-game day the fact no longer holds (EXCLUSIVE). NULL means still
   * current/open-ended. A non-null validUntil marks a fact that changed over
   * time (see timeline); a replacement fact may start on the same day without
   * overlapping.
   */
  validUntil: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface BingoSuggestion {
  id: number;
  text: string;
  source: string;
  createdAt: string;
  audience?: TaskAudience;
}
