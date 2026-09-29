import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Home } from './Home';
import { renderWithProviders, createTestUser } from '../test-utils/renderWithProviders';
import type { SafeUser, VersionInfo } from '../../shared/types';

const version: VersionInfo = { aiEnabled: true, recordingEnabled: true };

function user(overrides: Partial<SafeUser> = {}): SafeUser {
  return createTestUser({ activePerson: 'Ruvan', ...overrides });
}

describe('Home', () => {
  it('renders translated app names and descriptions', () => {
    renderWithProviders(<Home version={version} />, { user: user(), language: 'de' });
    expect(screen.getByRole('heading', { name: 'DnD Dashboard' })).toBeDefined();
    expect(screen.getByText('Wähle einen Bereich')).toBeDefined();
    expect(screen.getByRole('link', { name: /Tagebuch Persönliche/ })).toBeDefined();
    expect(screen.getByText(/Persönliche Tagebucheinträge/)).toBeDefined();

    renderWithProviders(<Home version={version} />, { user: user(), language: 'en' });
    expect(screen.getByRole('link', { name: /Diary Keep personal/ })).toBeDefined();
    expect(screen.getByText(/personal diary entries/)).toBeDefined();
  });

  it('explains a missing character assignment and supports an empty app state', () => {
    const withoutCharacter = user({ activePerson: null });
    const { unmount } = renderWithProviders(<Home version={version} />, {
      user: withoutCharacter,
      language: 'en',
    });
    expect(screen.getByText(/No character has been assigned/)).toBeDefined();
    unmount();

    renderWithProviders(<Home version={version} />, {
      user: user({
        activePerson: null,
        disabledApps: ['bingo', 'world', 'timeline', 'sessions', 'whiteboard'],
      }),
      language: 'de',
    });
    expect(screen.getByText('Keine Bereiche verfügbar.')).toBeDefined();
  });
});
