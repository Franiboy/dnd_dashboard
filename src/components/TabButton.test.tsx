import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TabButton } from './TabButton';

describe('TabButton', () => {
  it('renders its label as a button', () => {
    render(
      <TabButton active onClick={() => {}}>
        Feld
      </TabButton>
    );
    expect(screen.getByRole('button', { name: 'Feld' })).toBeTruthy();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(
      <TabButton active={false} onClick={onClick}>
        Aufgaben
      </TabButton>
    );
    screen.getByRole('button').click();
    expect(onClick).toHaveBeenCalledOnce();
  });
});
