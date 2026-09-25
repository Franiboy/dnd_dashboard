import { beforeEach, describe, expect, it } from 'vitest';
import { getAiLanguage } from '../ai/languageConfig.js';
import { db } from '../database.js';
import { getAiSettings, setAiLanguageSettings, setAiModelSettings } from './aiSettings.js';

describe('AI settings', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM ai_settings WHERE id = 1').run();
  });

  it('defaults the global language to German when no settings row exists', () => {
    expect(getAiSettings()).toEqual({ model: null, language: 'de' });
    expect(getAiLanguage()).toBe('de');
  });

  it('stores the language and model independently', () => {
    setAiLanguageSettings('en');
    expect(setAiModelSettings('opencode/test-model')).toEqual({
      model: 'opencode/test-model',
      language: 'en',
    });

    setAiModelSettings(null);
    expect(getAiLanguage()).toBe('en');
  });

  it('falls back to German for an invalid stored language', () => {
    db.prepare('INSERT INTO ai_settings (id, model, language) VALUES (1, NULL, ?)').run('fr');
    expect(getAiLanguage()).toBe('de');
  });
});
