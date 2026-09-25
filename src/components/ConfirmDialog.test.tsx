import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';
import { renderWithProviders } from '../test-utils/renderWithProviders';

function renderDialog(ui: React.ReactElement, language: 'de' | 'en' = 'de') {
  return renderWithProviders(ui, { language, router: false });
}

describe('ConfirmDialog', () => {
  it('keeps actions outside the scrolling content and allows them to wrap', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    renderDialog(
      <ConfirmDialog title="Confirm changes" onCancel={onCancel} onConfirm={onConfirm}>
        <p>Long content</p>
      </ConfirmDialog>
    );
    const panel = screen.getByRole('dialog');
    expect(panel.classList.contains('max-h-full')).toBe(true);
    expect(
      screen.getByText('Long content').parentElement!.classList.contains('overflow-y-auto')
    ).toBe(true);
    const confirm = screen.getByRole('button', { name: 'Bestätigen' });
    expect(confirm.parentElement!.classList.contains('flex-wrap')).toBe(true);
    expect(confirm.parentElement!.classList.contains('shrink-0')).toBe(true);
    fireEvent.click(confirm);
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('uses translated default actions in English', () => {
    renderDialog(
      <ConfirmDialog title="Confirm changes" onCancel={vi.fn()} onConfirm={vi.fn()}>
        Content
      </ConfirmDialog>,
      'en'
    );
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined();
  });

  it('disables both actions while loading', () => {
    renderDialog(
      <ConfirmDialog title="Confirm changes" loading onCancel={vi.fn()} onConfirm={vi.fn()}>
        Content
      </ConfirmDialog>
    );
    for (const button of screen.getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByRole('button', { name: 'Bitte warten...' })).toBeDefined();
  });
});
