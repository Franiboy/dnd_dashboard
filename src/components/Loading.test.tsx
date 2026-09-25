import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Loading } from './Loading';
import { renderWithProviders } from '../test-utils/renderWithProviders';

describe('Loading', () => {
  it('uses a localized default label', () => {
    renderWithProviders(<Loading />, { language: 'de', router: false });
    expect(screen.getByRole('status', { name: 'Lade...' })).toBeDefined();

    renderWithProviders(<Loading />, { language: 'en', router: false });
    expect(screen.getByRole('status', { name: 'Loading...' })).toBeDefined();
  });

  it('keeps an explicit empty label hidden', () => {
    renderWithProviders(<Loading text="" />, { language: 'en', router: false });
    expect(screen.queryByText('Loading...')).toBeNull();
  });
});
