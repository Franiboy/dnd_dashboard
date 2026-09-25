import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ErrorProvider } from './ErrorProvider';
import { useError } from '../hooks/useError';

function Probe() {
  const { toast, showError } = useError();
  return (
    <>
      <output data-testid="toast">{toast?.message ?? ''}</output>
      <button type="button" onClick={() => showError('Falsche Anmeldedaten')}>
        Show
      </button>
    </>
  );
}

afterEach(() => {
  document.documentElement.lang = '';
  window.localStorage.clear();
});

describe('ErrorProvider server message localization', () => {
  it.each([
    ['de', 'Falsche Anmeldedaten'],
    ['en', 'Invalid credentials'],
  ] as const)('localizes legacy server errors for %s', (language, expected) => {
    document.documentElement.lang = language;
    render(
      <ErrorProvider>
        <Probe />
      </ErrorProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByTestId('toast').textContent).toBe(expected);
  });
});
