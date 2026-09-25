import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';
import { renderWithProviders } from '../test-utils/renderWithProviders';

function renderModal(ui: React.ReactElement, language: 'de' | 'en' = 'de') {
  return renderWithProviders(ui, { language, router: false });
}

describe('Modal', () => {
  it('renders nothing when closed', () => {
    const { container } = renderModal(
      <Modal isOpen={false} title="Details" onClose={vi.fn()}>
        Content
      </Modal>
    );
    expect(container.firstChild).toBeNull();
  });

  it('bounds the panel and scrolls content independently of wrapping actions', () => {
    renderModal(
      <Modal
        isOpen
        title={'LongTitle'.repeat(30)}
        onClose={vi.fn()}
        actions={<button>Save changes</button>}
      >
        <p>Long content</p>
      </Modal>
    );
    const panel = screen.getByRole('dialog');
    expect(panel.classList.contains('max-h-full')).toBe(true);
    expect(panel.classList.contains('overflow-y-auto')).toBe(true);
    const title = screen.getByRole('heading');
    expect(title.classList.contains('wrap-anywhere')).toBe(true);
    expect(
      screen.getByText('Long content').parentElement!.classList.contains('overflow-y-auto')
    ).toBe(true);
    const actions = screen.getByRole('button', { name: 'Save changes' }).parentElement!;
    expect(actions.classList.contains('shrink-0')).toBe(true);
    expect(actions.classList.contains('flex-wrap')).toBe(true);
  });

  it('preserves custom content constraints and closes via a touch-sized button', () => {
    const onClose = vi.fn();
    renderModal(
      <Modal isOpen title="Details" onClose={onClose} contentClassName="max-h-[65vh]">
        <p>Content</p>
      </Modal>
    );
    expect(screen.getByText('Content').parentElement!.classList.contains('max-h-[65vh]')).toBe(
      true
    );
    const close = screen.getByRole('button', { name: 'Schließen' });
    expect(close.classList.contains('size-11')).toBe(true);
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('localizes the default close label in English', () => {
    renderModal(
      <Modal isOpen title="Details" onClose={vi.fn()}>
        Content
      </Modal>,
      'en'
    );
    expect(screen.getByRole('button', { name: 'Close' })).toBeDefined();
  });
});
