import { describe, expect, it } from 'vitest';
import {
  checkLoginAllowed,
  createAdminUser,
  createDiscordUser,
  findUserByUsername,
  recordFailedLogin,
  resetFailedLogins,
  setUserRole,
  toSafeUser,
  verifyPassword,
} from './users.js';

describe('users', () => {
  it('creates an admin user that can be found and verified', async () => {
    const user = await createAdminUser('testadmin', 'Test Admin', 'secure-password');
    expect(user.username).toBe('testadmin');
    expect(user.isAdmin).toBe(true);

    const fullUser = findUserByUsername('testadmin');
    expect(fullUser).toBeTruthy();
    expect(await verifyPassword(fullUser!, 'secure-password')).toBe(true);
    expect(await verifyPassword(fullUser!, 'wrong-password')).toBe(false);
  });

  it('returns a safe user without password or discord tokens', async () => {
    await createAdminUser('safeadmin', 'Safe Admin', 'password');
    const safe = toSafeUser(findUserByUsername('safeadmin')!);

    expect(safe.username).toBe('safeadmin');
    expect('passwordHash' in safe).toBe(false);
    expect(safe.isInitialAdmin).toBe(false);
  });

  it('defaults new users to the guest role', async () => {
    const admin = await createAdminUser('roleadmin', 'Role Admin', 'password');
    expect(admin.role).toBe('guest');

    const discord = createDiscordUser('discord-role-1', 'roleuser', 'Role User', null);
    expect(discord.role).toBe('guest');
  });

  it('assigns and changes user roles', async () => {
    await createAdminUser('assignable', 'Assignable User', 'password');

    const master = setUserRole(findUserByUsername('assignable')!.id, 'dungeon_master');
    expect(master?.role).toBe('dungeon_master');

    const player = setUserRole(findUserByUsername('assignable')!.id, 'player');
    expect(player?.role).toBe('player');

    const guest = setUserRole(findUserByUsername('assignable')!.id, 'guest');
    expect(guest?.role).toBe('guest');
  });

  it('rejects unknown roles', async () => {
    await createAdminUser('rolereject', 'Role Reject', 'password');
    const id = findUserByUsername('rolereject')!.id;

    const invalid = setUserRole(id, 'wizard' as never);
    expect(invalid).toBeNull();

    const stillGuest = findUserByUsername('rolereject')!;
    expect(stillGuest.role).toBe('guest');
  });

  it('tracks failed logins and lockout', async () => {
    await createAdminUser('lockeduser', 'Locked User', 'password');

    for (let i = 0; i < 5; i += 1) {
      const current = findUserByUsername('lockeduser')!;
      recordFailedLogin(current);
    }

    const lockedUser = findUserByUsername('lockeduser')!;
    const result = checkLoginAllowed(lockedUser);
    expect(result.allowed).toBe(false);

    resetFailedLogins(lockedUser);
    const afterReset = checkLoginAllowed(findUserByUsername('lockeduser')!);
    expect(afterReset.allowed).toBe(true);
  });
});
