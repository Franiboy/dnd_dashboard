# Features

## Bingo Game Flow

1. **Setup phase:** Admins add tasks and choose the grid size (3–5). Private tasks can be assigned to multiple players; they are hidden from other players and from admins without the "Show Hidden" toggle.
2. **Join:** Players join via `join` with their Discord display name.
3. **Fill board:** Each player draws tasks from the pool onto their board.
4. **Lock board:** Once the board is complete the player locks it.
5. **Start:** Admin starts the game once all online players have locked their boards and enough tasks exist (`gridSize * gridSize`).
6. **Play:** Tasks are confirmed globally (`confirmTask` / `confirmTaskFor`); completed tasks are marked on all boards.
7. **Bingo:** Once a row, column or diagonal is fully confirmed the player wins. A `bingo` event is emitted with the player name.
8. **New round:** Admin can end and reset the game (`resetGame`); tasks are kept, boards are cleared.

### Important Socket.io Events

**Server → Client (`ServerToClientEvents`):**

- `state` – current `BingoGame` state
- `error` – error message for the client
- `joined` – own `playerId` after `join`
- `bingo` – a player got bingo (`playerName`)

**Client → Server (`ClientToServerEvents`):**

- `join` – join the game
- `addTask` – add a task (`{ text, isPrivate?, assignedTo?: string[] }`)
- `removeTask` – remove a task
- `updateTask` – edit a task (`{ taskId, text?, isPrivate?, assignedTo? }`)
- `setGridSize` – change grid size (admin, setup only)
- `startGame` – start the game (admin, setup only)
- `updateBoard` / `lockBoard` / `unlockBoard` – edit the board
- `confirmTask` / `unconfirmTask` – confirm / reset tasks
- `confirmTaskFor` – confirm a task for another player (e.g. admin)
- `resetGame` – end and reset the game (admin)

## Diary & World Module

### Diary (`/tagebuch`)

- Users can create, edit and delete HTML-based diary entries.
- AI can rewrite entries (`rewriteTextWithAi`) and refine them with a command (`improveRewrittenWithCommand`).
- AI generates a short summary (`summarizeTextWithAi`, max. 500 characters).
- AI extracts people, organizations and places (`extractEntitiesFromDiary`).
- Rewrites are stored as files under `rewritten/` (`server/diaryFiles.ts`).
- Entries are visible only to the owning user.

### World (`/welt`)

- Shows all known entities (people, organizations, places).
- Each entity has:
  - Summary (`entitySummaries`)
  - Knowledge entries (`entityKnowledge`)
  - Linked diary entries
  - Aliases
- Entities can be edited, merged, reclassified and blacklisted.
- Knowledge distribution takes free text (e.g. from the diary) and assigns facts to entities.

### AI Workflow

1. Prompts in `server/ai/rewrite.ts` / `server/ai/knowledge.ts` instruct the AI to query background information via MCP tools before storing data.
2. `runOpenCode` in `server/ai/opencode.ts` spawns `opencode run` and passes a short-lived MCP session token.
3. `server/mcp/index.ts` provides the tools (e.g. `get_entity`, `set_diary_summary`, `create_knowledge`).
4. The scheduler `server/scheduler/entitySummaries.ts` regularly updates entity summaries.

### MCP Scopes

| Scope | Allowed tools |
|-------|---------------|
| `diary:read` | `get_diary_entry`, `search_diary_entries`, `get_previous_diary_entries` |
| `diary:summarize` | `set_diary_summary` |
| `diary:rewrite` | `set_diary_rewrite` |
| `entity:read` | `list_entities`, `get_entity` |
| `entity:extract` | `link_diary_entity` |
| `entity:summary` | `set_entity_summary` |
| `knowledge:distribute` | `create_knowledge`, `delete_knowledge` |

## Recording Module

- Activation: `DISCORD_BOT_TOKEN` and `DISCORD_GUILD_ID` must be set.
- The bot joins a voice channel and records each speaker as a separate PCM file.
- Recordings are stored in the `recordings/` directory.
- A scheduler (`server/discord/scheduler.ts`) transcribes finished recordings with OpenAI Whisper.
- Transcripts can be trimmed and saved as text.
- Recordings are only visible to admins.
