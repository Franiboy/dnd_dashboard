# App Navigator

Visible apps are maintained centrally in `src/lib/apps.ts`. The initial admin (`admin`) does not see apps with `hideForInitialAdmin`. The `recordings` module requires `recordingEnabled=true` (`requiresFeature`).

The `label` values in the table below are taken directly from `src/lib/apps.ts` and are currently German because the application UI is in German.

| ID           | Label     | Route         | Admin only | Disableable | Hide for initial admin | Requires feature   | Icon ID      |
| ------------ | --------- | ------------- | ---------- | ----------- | ---------------------- | ------------------ | ------------ |
| `dashboard`  | Dashboard | `/`           | no         | no          | yes                    | -                  | -            |
| `notes`      | Tagebuch  | `/tagebuch`   | no         | yes         | yes                    | -                  | -            |
| `bingo`      | Bingo     | `/bingo`      | no         | yes         | yes                    | -                  | -            |
| `world`      | Welt      | `/welt`       | no         | yes         | yes                    | -                  | -            |
| `recordings` | Aufnahmen | `/recordings` | yes        | yes         | no                     | `recordingEnabled` | `recordings` |
| `admin`      | Admin     | `/admin`      | yes        | no          | no                     | -                  | `admin`      |

## Admin & User Rules

- On first start a default admin `admin` is created with the password from `ADMIN_PASSWORD`.
- New Discord users must be approved by an admin before they can log in.
- Admin login is reachable via an Easter egg on the login page: click the title 5 times.
- The initial admin (`admin`) is the only one who needs `/admin-login`; promoted admins use the normal Discord login. The login checks the stored password hash and applies the same account lockout as Discord login.
- Promoted admins can participate in Bingo like normal players.
- The initial admin `admin` may not join Bingo as a player.
- Admins can approve/lock users, grant/revoke admin rights, delete users and disable individual apps per user (`disabledApps`).
- `/admin` is admin-only and shows user management and logs.
- `/bingo`, `/tagebuch`, `/welt`, `/recordings` can be locked per user via `disabledApps`.
