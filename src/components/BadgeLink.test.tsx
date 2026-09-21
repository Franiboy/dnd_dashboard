import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { BadgeLink } from './BadgeLink';

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('BadgeLink', () => {
  it('renders its children as a link to the referenced item', () => {
    renderWithRouter(<BadgeLink to="/tagebuch?entry=7">Tagebuch</BadgeLink>);
    const link = screen.getByRole('link', { name: 'Tagebuch' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/tagebuch?entry=7');
  });

  it('forwards onClick before navigating', () => {
    const onClick = vi.fn();
    renderWithRouter(
      <BadgeLink to="/sessions?session=3" onClick={onClick}>
        Session
      </BadgeLink>
    );
    screen.getByRole('link', { name: 'Session' }).click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('exposes the title as tooltip', () => {
    renderWithRouter(
      <BadgeLink to="/sessions" title="Springe zur Session">
        Session
      </BadgeLink>
    );
    expect(screen.getByRole('link', { name: 'Session' }).getAttribute('title')).toBe(
      'Springe zur Session'
    );
  });
});
