import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Toggle } from './Toggle';

describe('Toggle', () => {
  it('reflects the checked prop', () => {
    const { rerender } = render(<Toggle checked={false} onChange={() => {}} />);
    const input = screen.getByRole('checkbox') as HTMLInputElement;
    expect(input.checked).toBe(false);

    rerender(<Toggle checked onChange={() => {}} />);
    expect(input.checked).toBe(true);
  });

  it('calls onChange with the new checked value', () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} />);
    const input = screen.getByRole('checkbox') as HTMLInputElement;
    input.click();
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('can be disabled', () => {
    render(<Toggle checked={false} onChange={() => {}} disabled />);
    const input = screen.getByRole('checkbox') as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });
});
