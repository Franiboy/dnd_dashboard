// Declarative target schema for the SQLite database.
// The migration engine diffs the live database against this definition and
// applies the missing tables, columns and indexes automatically.
// Data-level migrations (e.g. format transforms) live as code hooks in
// server/migrations.ts.

export interface ColumnDef {
  type: string;
  notNull?: boolean;
  primaryKey?: boolean;
  autoIncrement?: boolean;
  default?: string;
}

export interface IndexDef {
  name: string;
  columns: string[];
  unique?: boolean;
}

export interface ReferenceDef {
  columns: string[];
  table: string;
  references: string[];
  onDelete?: 'CASCADE' | 'SET NULL' | 'RESTRICT';
}

export interface TableDef {
  columns: Record<string, ColumnDef>;
  references?: ReferenceDef[];
  indexes?: IndexDef[];
  check?: string;
}

export const schema: Record<string, TableDef> = {
  users: {
    columns: {
      id: { type: 'TEXT', primaryKey: true },
      username: { type: 'TEXT', notNull: true },
      display_name: { type: 'TEXT', notNull: true },
      password_hash: { type: 'TEXT' },
      discord_id: { type: 'TEXT' },
      avatar_url: { type: 'TEXT' },
      is_admin: { type: 'INTEGER', notNull: true, default: '0' },
      is_approved: { type: 'INTEGER', notNull: true, default: '0' },
      role: { type: 'TEXT', notNull: true, default: "'guest'" },
      failed_login_attempts: { type: 'INTEGER', notNull: true, default: '0' },
      locked_until: { type: 'TEXT' },
      created_at: { type: 'TEXT', notNull: true },
      disabled_apps: { type: 'TEXT' },
      discord_access_token: { type: 'TEXT' },
      discord_refresh_token: { type: 'TEXT' },
      discord_token_expires_at: { type: 'TEXT' },
      active_person: { type: 'TEXT' },
      auto_session_to_diary: { type: 'INTEGER', notNull: true, default: '0' },
      auto_accept_session_diary: { type: 'INTEGER', notNull: true, default: '0' },
    },
  },

  games: {
    columns: {
      id: { type: 'INTEGER', primaryKey: true },
      data: { type: 'TEXT', notNull: true },
    },
  },

  recording_sessions: {
    columns: {
      id: { type: 'INTEGER', primaryKey: true, autoIncrement: true },
      name: { type: 'TEXT', notNull: true },
      status: { type: 'TEXT', notNull: true, default: "'recording'" },
      guild_id: { type: 'TEXT', notNull: true },
      channel_id: { type: 'TEXT', notNull: true },
      created_by: { type: 'TEXT', notNull: true },
      started_at: { type: 'TEXT', notNull: true },
      stopped_at: { type: 'TEXT' },
      directory: { type: 'TEXT', notNull: true },
      transcript: { type: 'TEXT' },
      error: { type: 'TEXT' },
      trim_start_seconds: { type: 'REAL', default: '0' },
      trim_end_seconds: { type: 'REAL' },
      transcribed_trim_start_seconds: { type: 'REAL' },
      transcribed_trim_end_seconds: { type: 'REAL' },
      transcript_improved_at: { type: 'TEXT' },
      summary: { type: 'TEXT' },
      summary_generated_at: { type: 'TEXT' },
      long_summary: { type: 'TEXT' },
      long_summary_generated_at: { type: 'TEXT' },
      // AI-detected boundaries of the actual game play within the recording
      // (seconds from the recording start, i.e. the transcript timestamp scale).
      // The recording contains pre-session team discussion / small talk and
      // post-session chit-chat that should be excluded from summarization.
      game_start_seconds: { type: 'REAL' },
      game_end_seconds: { type: 'REAL' },
      game_boundary_detected_at: { type: 'TEXT' },
      updated_at: { type: 'TEXT' },
    },
  },

  recording_files: {
    columns: {
      id: { type: 'INTEGER', primaryKey: true, autoIncrement: true },
      session_id: { type: 'INTEGER', notNull: true },
      user_id: { type: 'TEXT', notNull: true },
      display_name: { type: 'TEXT', notNull: true },
      pcm_path: { type: 'TEXT', notNull: true },
      wav_path: { type: 'TEXT' },
      duration: { type: 'REAL' },
      transcript_path: { type: 'TEXT' },
    },
    references: [
      {
        columns: ['session_id'],
        table: 'recording_sessions',
        references: ['id'],
        onDelete: 'CASCADE',
      },
    ],
  },

  recording_config: {
    columns: {
      id: { type: 'INTEGER', primaryKey: true },
      channel_id: { type: 'TEXT' },
      updated_at: { type: 'TEXT' },
    },
  },

  diary_entries: {
    columns: {
      id: { type: 'INTEGER', primaryKey: true, autoIncrement: true },
      user_id: { type: 'TEXT', notNull: true },
      title: { type: 'TEXT', notNull: true },
      content: { type: 'TEXT', notNull: true },
      summary: { type: 'TEXT' },
      rewritten_content: { type: 'TEXT' },
      created_at: { type: 'TEXT', notNull: true },
      updated_at: { type: 'TEXT', notNull: true },
      rewritten_file_path: { type: 'TEXT' },
      rewrite_session_id: { type: 'TEXT' },
      ai_dirty: { type: 'INTEGER', notNull: true, default: '0' },
      ai_processed_at: { type: 'TEXT' },
      session_draft_for: { type: 'INTEGER' },
    },
    indexes: [
      {
        name: 'idx_diary_entries_session_draft_for',
        columns: ['session_draft_for'],
      },
    ],
  },

  persons: {
    columns: {
      id: { type: 'INTEGER', primaryKey: true, autoIncrement: true },
      name: { type: 'TEXT', notNull: true },
    },
  },

  diary_entry_persons: {
    columns: {
      diary_entry_id: { type: 'INTEGER', notNull: true, primaryKey: true },
      person_id: { type: 'INTEGER', notNull: true, primaryKey: true },
    },
    references: [
      {
        columns: ['diary_entry_id'],
        table: 'diary_entries',
        references: ['id'],
        onDelete: 'CASCADE',
      },
      {
        columns: ['person_id'],
        table: 'persons',
        references: ['id'],
        onDelete: 'CASCADE',
      },
    ],
  },

  organizations: {
    columns: {
      id: { type: 'INTEGER', primaryKey: true, autoIncrement: true },
      name: { type: 'TEXT', notNull: true },
    },
  },

  diary_entry_organizations: {
    columns: {
      diary_entry_id: { type: 'INTEGER', notNull: true, primaryKey: true },
      organization_id: { type: 'INTEGER', notNull: true, primaryKey: true },
    },
    references: [
      {
        columns: ['diary_entry_id'],
        table: 'diary_entries',
        references: ['id'],
        onDelete: 'CASCADE',
      },
      {
        columns: ['organization_id'],
        table: 'organizations',
        references: ['id'],
        onDelete: 'CASCADE',
      },
    ],
  },

  locations: {
    columns: {
      id: { type: 'INTEGER', primaryKey: true, autoIncrement: true },
      name: { type: 'TEXT', notNull: true },
    },
  },

  diary_entry_locations: {
    columns: {
      diary_entry_id: { type: 'INTEGER', notNull: true, primaryKey: true },
      location_id: { type: 'INTEGER', notNull: true, primaryKey: true },
    },
    references: [
      {
        columns: ['diary_entry_id'],
        table: 'diary_entries',
        references: ['id'],
        onDelete: 'CASCADE',
      },
      {
        columns: ['location_id'],
        table: 'locations',
        references: ['id'],
        onDelete: 'CASCADE',
      },
    ],
  },

  entity_blacklist: {
    columns: {
      type: { type: 'TEXT', notNull: true, primaryKey: true },
      name: { type: 'TEXT', notNull: true, primaryKey: true },
    },
    check: "type IN ('persons', 'organizations', 'locations')",
  },

  entity_aliases: {
    columns: {
      type: { type: 'TEXT', notNull: true, primaryKey: true },
      alias: { type: 'TEXT', notNull: true, primaryKey: true },
      canonical: { type: 'TEXT', notNull: true },
    },
    check: "type IN ('persons', 'organizations', 'locations')",
  },

  entity_knowledge_entries: {
    columns: {
      id: { type: 'INTEGER', primaryKey: true, autoIncrement: true },
      entity_type: { type: 'TEXT', notNull: true },
      entity_name: { type: 'TEXT', notNull: true },
      title: { type: 'TEXT' },
      content: { type: 'TEXT', notNull: true },
      source: { type: 'TEXT', notNull: true, default: "'manual'" },
      status: { type: 'TEXT', notNull: true, default: "'active'" },
      status_reason: { type: 'TEXT' },
      // Optional reference to the text this entry was extracted from.
      // Display-only provenance; never used for navigation.
      origin_type: { type: 'TEXT' },
      origin_id: { type: 'INTEGER' },
      created_at: { type: 'TEXT', notNull: true },
      updated_at: { type: 'TEXT', notNull: true },
    },
    check:
      "entity_type IN ('persons', 'organizations', 'locations') AND status IN ('active', 'deleted')",
    indexes: [
      {
        name: 'idx_entity_knowledge_entries_lookup',
        columns: ['entity_type', 'entity_name'],
      },
    ],
  },

  entity_summaries: {
    columns: {
      entity_type: { type: 'TEXT', notNull: true, primaryKey: true },
      entity_name: { type: 'TEXT', notNull: true, primaryKey: true },
      summary: { type: 'TEXT' },
      is_dirty: { type: 'INTEGER', notNull: true, default: '1' },
      updated_at: { type: 'TEXT' },
      mini_summary: { type: 'TEXT' },
    },
    check: "entity_type IN ('persons', 'organizations', 'locations')",
  },

  logs: {
    columns: {
      id: { type: 'INTEGER', primaryKey: true, autoIncrement: true },
      timestamp: { type: 'TEXT', notNull: true },
      level: { type: 'TEXT', notNull: true },
      category: { type: 'TEXT', notNull: true },
      message: { type: 'TEXT', notNull: true },
      args: { type: 'TEXT', notNull: true, default: "'[]'" },
    },
    indexes: [
      { name: 'idx_logs_id', columns: ['id'] },
      { name: 'idx_logs_level_id', columns: ['level', 'id'] },
    ],
  },

  bingo_suggestions: {
    columns: {
      id: { type: 'INTEGER', primaryKey: true, autoIncrement: true },
      text: { type: 'TEXT', notNull: true },
      source: { type: 'TEXT', notNull: true, default: "'ai'" },
      created_at: { type: 'TEXT', notNull: true },
      accepted_at: { type: 'TEXT' },
      rejected_at: { type: 'TEXT' },
      // Target pool of the suggestion ('players' or 'dm'); the migration adds
      // the column with a default so existing rows stay in the player pool.
      audience: { type: 'TEXT', notNull: true, default: "'players'" },
    },
    indexes: [
      { name: 'idx_bingo_suggestions_created_at', columns: ['created_at'] },
      {
        name: 'idx_bingo_suggestions_status',
        columns: ['accepted_at', 'rejected_at', 'created_at'],
      },
    ],
  },

  ai_settings: {
    columns: {
      id: { type: 'INTEGER', primaryKey: true },
      model: { type: 'TEXT' },
      updated_at: { type: 'TEXT' },
    },
  },

  session_diary_transfers: {
    columns: {
      session_id: { type: 'INTEGER', notNull: true, primaryKey: true },
      user_id: { type: 'TEXT', notNull: true, primaryKey: true },
      entry_id: { type: 'INTEGER' },
      auto_accepted: { type: 'INTEGER', notNull: true, default: '0' },
      created_at: { type: 'TEXT', notNull: true },
    },
    indexes: [{ name: 'idx_session_diary_transfers_user', columns: ['user_id'] }],
  },

  bingo_suggestion_batches: {
    columns: {
      id: { type: 'TEXT', primaryKey: true },
      status: { type: 'TEXT', notNull: true, default: "'pending'" },
      created_at: { type: 'TEXT', notNull: true },
      audience: { type: 'TEXT', notNull: true, default: "'players'" },
    },
  },

  bingo_suggestion_batch_results: {
    columns: {
      id: { type: 'INTEGER', primaryKey: true, autoIncrement: true },
      batch_id: { type: 'TEXT', notNull: true },
      text: { type: 'TEXT', notNull: true },
      source: { type: 'TEXT', notNull: true, default: "'ai'" },
      created_at: { type: 'TEXT', notNull: true },
    },
    references: [
      {
        columns: ['batch_id'],
        table: 'bingo_suggestion_batches',
        references: ['id'],
        onDelete: 'CASCADE',
      },
    ],
    indexes: [
      {
        name: 'idx_bingo_suggestion_batch_results_batch_id',
        columns: ['batch_id'],
      },
    ],
  },

  whiteboard_elements: {
    columns: {
      id: { type: 'TEXT', primaryKey: true },
      type: { type: 'TEXT', notNull: true },
      zone: { type: 'TEXT', notNull: true, default: "'private'" },
      owner_id: { type: 'TEXT', notNull: true },
      owner_name: { type: 'TEXT', notNull: true, default: "''" },
      x: { type: 'REAL', notNull: true, default: '0' },
      y: { type: 'REAL', notNull: true, default: '0' },
      x2: { type: 'REAL' },
      y2: { type: 'REAL' },
      width: { type: 'REAL', notNull: true, default: '200' },
      height: { type: 'REAL', notNull: true, default: '160' },
      color: { type: 'TEXT', notNull: true, default: "'#facc15'" },
      text: { type: 'TEXT', notNull: true, default: "''" },
      description: { type: 'TEXT' },
      status: { type: 'TEXT' },
      url: { type: 'TEXT' },
      from_id: { type: 'TEXT' },
      to_id: { type: 'TEXT' },
      created_at: { type: 'TEXT', notNull: true },
      updated_at: { type: 'TEXT', notNull: true },
    },
    check:
      "type IN ('note', 'task', 'arrow', 'link') AND zone IN ('public', 'private') " +
      "AND status IN ('open', 'in_progress', 'done')",
    indexes: [
      {
        name: 'idx_whiteboard_elements_owner_zone',
        columns: ['owner_id', 'zone'],
      },
    ],
  },
};
