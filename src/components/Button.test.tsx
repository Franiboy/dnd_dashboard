import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  it('renders its children as a button', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: /Click me/i })).toBeDefined();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click</Button>);
    const button = screen.getByRole('button', { name: /Click/i });
    button.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('supports a disabled state', () => {
    render(<Button disabled>Disabled</Button>);
    const button = screen.getByRole('button', { name: /Disabled/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
