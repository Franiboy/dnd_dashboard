import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UserCheckboxList } from './UserCheckboxList';
import { createTestUser, renderWithProviders } from '../test-utils/renderWithProviders';
import type { SafeUser } from '../../shared/types';

const users: SafeUser[] = [
  createTestUser({ id: 'u1', displayName: 'Ada' }),
  createTestUser({ id: 'u2', displayName: 'Lin' }),
];

describe('UserCheckboxList', () => {
  it('localizes the search placeholder, empty state, and current-user marker', () => {
    renderWithProviders(
      <UserCheckboxList users={users} selected={[]} onChange={vi.fn()} disabledIds={['u1']} />,
      { language: 'de', router: false }
    );
    expect(screen.getByPlaceholderText('Benutzer durchsuchen')).toBeDefined();
    expect(screen.getByText('(Du)')).toBeDefined();

    renderWithProviders(<UserCheckboxList users={[]} selected={[]} onChange={vi.fn()} />, {
      language: 'en',
      router: false,
    });
    expect(screen.getByPlaceholderText('Search users')).toBeDefined();
    expect(screen.getByText('No users.')).toBeDefined();
  });

  it('keeps custom copy and localizes the remove action', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <UserCheckboxList
        users={users}
        selected={['u1']}
        onChange={onChange}
        placeholder="Find people"
        emptyMessage="Nobody"
      />,
      { language: 'en', router: false }
    );
    expect(screen.getByPlaceholderText('Find people')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Ada' }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
