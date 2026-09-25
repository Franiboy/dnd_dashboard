import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LanguageSwitcher } from './LanguageSwitcher';
import { I18nContext, type I18nContextValue } from '../i18n/I18nContext';
import { createTranslator } from '../i18n/messages';

function renderSwitcher(
  language: 'de' | 'en' = 'de',
  languagePreference: 'de' | 'en' | null = language
) {
  const setLanguage = vi.fn().mockResolvedValue(undefined);
  const value: I18nContextValue = {
    language,
    languagePreference,
    locale: language === 'de' ? 'de-DE' : 'en-US',
    t: createTranslator(language),
    setLanguage,
    formatDate: vi.fn(),
    formatTime: vi.fn(),
    formatDateTime: vi.fn(),
    formatNumber: vi.fn(),
  };
  render(
    <I18nContext.Provider value={value}>
      <LanguageSwitcher />
    </I18nContext.Provider>
  );
  return setLanguage;
}

describe('LanguageSwitcher', () => {
  it('uses the German label and native language names in German', () => {
    renderSwitcher();

    expect(screen.getByRole('combobox', { name: 'Sprache' })).toBeDefined();
    expect(screen.getByRole('option', { name: 'Deutsch' })).toBeDefined();
    expect(screen.getByRole('option', { name: 'English' })).toBeDefined();
  });

  it('uses the English label in English', () => {
    renderSwitcher('en');

    expect(screen.getByRole('combobox', { name: 'Language' })).toBeDefined();
  });

  it('allows returning to automatic browser selection', () => {
    const setLanguage = renderSwitcher('en', null);

    expect(screen.getByRole('option', { name: 'Automatic' })).toBeDefined();
    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), {
      target: { value: 'de' },
    });
    expect(setLanguage).toHaveBeenCalledWith('de');

    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), {
      target: { value: 'auto' },
    });
    expect(setLanguage).toHaveBeenLastCalledWith(null);
  });

  it('saves the selected supported language', () => {
    const setLanguage = renderSwitcher();

    fireEvent.change(screen.getByRole('combobox', { name: 'Sprache' }), {
      target: { value: 'en' },
    });

    expect(setLanguage).toHaveBeenCalledWith('en');
  });
});
