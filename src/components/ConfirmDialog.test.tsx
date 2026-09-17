import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('keeps actions outside the scrolling content and allows them to wrap', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog title="Confirm changes" onCancel={onCancel} onConfirm={onConfirm}>
        <p>Long content</p>
      </ConfirmDialog>
    );
    const panel = screen.getByRole('heading').parentElement!;
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

  it('disables both actions while loading', () => {
    render(
      <ConfirmDialog title="Confirm changes" loading onCancel={vi.fn()} onConfirm={vi.fn()}>
        Content
      </ConfirmDialog>
    );
    for (const button of screen.getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
