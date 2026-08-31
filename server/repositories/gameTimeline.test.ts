import { describe, expect, it } from 'vitest';
import { db } from '../database.js';
import {
  ensureCampaignDay,
  getCurrentGameDay,
  getNextGameDay,
  listCampaignDays,
  setDiaryGameDay,
  setSessionGameDay,
} from './gameTimeline.js';

describe('gameTimeline', () => {
  it('lists campaign days in ascending order', () => {
    ensureCampaignDay(10);
    ensureCampaignDay(3);
    const days = listCampaignDays();
    expect(days.map((d) => d.day)).toContain(3);
    expect(days.map((d) => d.day)).toContain(10);
    // sorted ascending
    const nums = days.map((d) => d.day);
    expect(nums).toEqual([...nums].sort((a, b) => a - b));
  });

  it('current game day is the highest registered day', () => {
    ensureCampaignDay(700);
    expect(getCurrentGameDay()).toBe(700);
    expect(getNextGameDay()).toBe(701);
  });

  it('ensureCampaignDay is idempotent', () => {
    ensureCampaignDay(7);
    ensureCampaignDay(7);
    const row = db.prepare('SELECT day FROM campaign_days WHERE day = 7').get() as {
      day: number;
    };
    expect(row.day).toBe(7);
  });

  it('setting a session game day registers it in the timeline', () => {
    const now = new Date().toISOString();
    const sid = Number(
      db
        .prepare(
          `INSERT INTO recording_sessions (name, status, guild_id, channel_id, created_by, started_at, directory)
           VALUES ('TL Session', 'stopped', 'g', 'c', 'tester', ?, 'dir')`
        )
        .run(now).lastInsertRowid
    );
    setSessionGameDay(sid, 12);
    const row = db
      .prepare('SELECT game_day AS d FROM recording_sessions WHERE id = ?')
      .get(sid) as { d: number | null };
    expect(row.d).toBe(12);
    const day = db.prepare('SELECT day FROM campaign_days WHERE day = 12').get();
    expect(day).toBeDefined();
  });

  it('setting a diary game day registers it in the timeline', () => {
    const now = new Date().toISOString();
    const did = Number(
      db
        .prepare(
          `INSERT INTO diary_entries (user_id, title, content, created_at, updated_at)
           VALUES ('tester', 'TL Diary', 'Inhalt', ?, ?)`
        )
        .run(now, now).lastInsertRowid
    );
    setDiaryGameDay(did, 13);
    const row = db.prepare('SELECT game_day AS d FROM diary_entries WHERE id = ?').get(did) as {
      d: number | null;
    };
    expect(row.d).toBe(13);
    const day = db.prepare('SELECT day FROM campaign_days WHERE day = 13').get();
    expect(day).toBeDefined();
  });
});
