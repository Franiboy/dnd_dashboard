import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

describe('Modal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <Modal isOpen={false} title="Details" onClose={vi.fn()}>
        Content
      </Modal>
    );
    expect(container.firstChild).toBeNull();
  });

  it('bounds the panel and scrolls content independently of wrapping actions', () => {
    render(
      <Modal
        isOpen
        title={'LongTitle'.repeat(30)}
        onClose={vi.fn()}
        actions={<button>Save changes</button>}
      >
        <p>Long content</p>
      </Modal>
    );
    const title = screen.getByRole('heading');
    const panel = title.parentElement!.parentElement!;
    expect(panel.classList.contains('max-h-full')).toBe(true);
    expect(panel.classList.contains('overflow-y-auto')).toBe(true);
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
    render(
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
});
