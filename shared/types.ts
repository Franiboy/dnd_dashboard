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

export const SERVER_MESSAGE_PROTOCOL_VERSION = 2;
export type ServerMessageParam = string | number | boolean | null | undefined;
export type ServerMessageParams = Readonly<Record<string, ServerMessageParam>>;

/**
 * Structured user-facing message shared by HTTP, Socket.io and SSE producers.
 * `message` remains a human-readable fallback for older clients; clients should
 * prefer `errorCode`/`messageKey` and interpolate `params` in their locale.
 */
export interface ServerMessagePayload {
  message: string;
  errorCode?: string;
  messageKey?: string;
  params?: ServerMessageParams;
  /** SSE lifecycle marker; never inferred from a translated message. */
  statusCode?: string;
  /** Raw OpenCode/CLI diagnostics intentionally bypass UI translation. */
  technical?: boolean;
}

export interface ServerToClientEvents {
  state: (game: BingoGame) => void;
  error: (message: string | ServerMessagePayload) => void;
  bingo: (playerName: string) => void;
  joined: (playerId: string) => void;
  wbElements: (elements: WhiteboardElement[]) => void;
  wbUpsert: (element: WhiteboardElement) => void;
  wbRemoved: (id: string) => void;
}

export const SUPPORTED_LANGUAGES = ['de', 'en'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];
/** Whisper's legacy automatic detection is accepted for bootstrap settings. */
export type WhisperLanguage = Language | 'auto';

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
  /** User-chosen theme base color as #rrggbb; null = default theme. */
  themePrimary: string | null;
  /** User-selected UI language; null = automatic browser-based selection. */
  uiLanguage: Language | null;
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
  /** User-chosen theme base color as #rrggbb; null = default theme. */
  themePrimary: string | null;
  /** User-selected UI language; null = automatic browser-based selection. */
  uiLanguage: Language | null;
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

// ---------------------------------------------------------------------------
// Story arcs
// ---------------------------------------------------------------------------

/**
 * Lifecycle of a story arc. Exactly one arc is 'active' at a time: newly
 * created sessions and diary entries are filed into it automatically.
 */
export type StoryArcStatus = 'planned' | 'active' | 'completed';

/**
 * A story arc groups sessions and diary entries into one narrative chapter.
 * The game-day range and the member counts are derived from the members on
 * read; they are never stored.
 */
export interface StoryArc {
  id: number;
  name: string;
  description: string | null;
  status: StoryArcStatus;
  /**
   * Campaign chapter number shown on the chapter chips/timeline. NULL =
   * unnumbered (e.g. special or one-shot arcs); numbers must be unique,
   * unnumbered arcs can coexist.
   */
  chapterNumber: number | null;
  sessionCount: number;
  diaryEntryCount: number;
  /** Number of world entities assigned to this arc (many-to-many). */
  entityCount: number;
  gameDayStart: number | null;
  gameDayEnd: number | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/**
 * One notable campaign happening on the in-game day axis, AI-generated from a
 * session's summaries. Only events worth remembering are extracted - not one
 * per game day.
 */
export interface TimelineEvent {
  id: number;
  /** Campaign day the event happened on (recording_sessions.game_day). */
  gameDay: number;
  /** Story arc of the source session at generation time; NULL when unassigned. */
  arcId: number | null;
  /** Session the event was extracted from. */
  sessionId: number;
  sessionName: string | null;
  title: string;
  /** Short sanitized HTML description. */
  description: string | null;
  generatedAt: string;
  updatedAt: string;
  /** Sub-events ("zoom level") of the source game day, in display order. */
  scenes: TimelineScene[];
  /**
   * Diary entries of the viewing user on the same game day (all entries for
   * admins), resolved at read time because diaries are private per author.
   */
  diaryLinks: TimelineDiaryLink[];
}

/** Sub-event of a timeline event, shown in the event's zoomed mini timeline. */
export interface TimelineScene {
  id: number;
  eventId: number;
  gameDay: number;
  position: number;
  title: string;
  description: string | null;
}

/** Diary entry linked to an event via the shared game day. */
export interface TimelineDiaryLink {
  entryId: number;
  title: string;
  /** Author display name; only set for admins. */
  displayName: string | null;
}

/** Input shape used by the AI write path to replace one session's events. */
export interface TimelineEventInput {
  gameDay: number;
  title: string;
  description: string | null;
  scenes: TimelineSceneInput[];
}

export interface TimelineSceneInput {
  gameDay: number;
  title: string;
  description: string | null;
}

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
  /** Language captured when the recording session was created. */
  transcriptionLanguage: WhisperLanguage | null;
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
  /** Story arc this session was filed into; NULL means unassigned. */
  arcId: number | null;
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
  /** Story arc this entry was filed into; NULL means unassigned. */
  arcId: number | null;
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

// ---------------------------------------------------------------------------
// Global search
// ---------------------------------------------------------------------------

/** Source tables of the global search index. */
export type SearchSource = 'diary' | 'session' | 'knowledge' | 'timeline';

/**
 * A diary entry hit. Snippets carry match markers: \u0001 opens and \u0002
 * closes a highlighted range; clients render them as <mark> or similar.
 */
export interface DiarySearchHit {
  source: 'diary';
  /** diary_entries.id */
  id: number;
  title: string;
  snippet: string;
  createdAt: string;
  gameDay: number | null;
  arcId: number | null;
}

export interface SessionSearchHit {
  source: 'session';
  /** recording_sessions.id */
  id: number;
  title: string;
  snippet: string;
  startedAt: string | null;
  gameDay: number | null;
  arcId: number | null;
  /** Timestamp ([MM:SS] / [HH:MM:SS]) of the first match in the transcript. */
  transcriptTime: string | null;
}

export interface KnowledgeSearchHit {
  source: 'knowledge';
  /** entity_knowledge_entries.id */
  id: number;
  title: string;
  snippet: string;
  entityType: EntityType;
  entityName: string;
  entityQualifier: string;
  validFrom: number | null;
  validUntil: number | null;
}

/**
 * A timeline event hit; scene matches are folded into the parent event's
 * document, so a hit always points at a timeline_events row.
 */
export interface TimelineSearchHit {
  source: 'timeline';
  /** timeline_events.id */
  id: number;
  title: string;
  snippet: string;
  gameDay: number;
  arcId: number | null;
  sessionId: number;
  sessionName: string | null;
}

export type SearchResult =
  DiarySearchHit | SessionSearchHit | KnowledgeSearchHit | TimelineSearchHit;

export interface SearchResponse {
  results: SearchResult[];
}

export interface BingoSuggestion {
  id: number;
  text: string;
  source: string;
  createdAt: string;
  audience?: TaskAudience;
}
