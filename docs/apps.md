# App Navigator

Visible apps are maintained centrally in `src/lib/apps.ts`. **Admins have unrestricted access**: app visibility rules (`disabledApps`, `adminOnly`, feature flags) never apply to them. For regular users, `disabledApps` hides individual apps and the `sessions` module requires `recordingEnabled=true` (`requiresFeature`).

The `label` values in the table below are taken directly from `src/lib/apps.ts` and are currently German because the application UI is in German.

| ID           | Label      | Route         | Admin only | Disableable | Requires feature   | Icon ID    |
| ------------ | ---------- | ------------- | ---------- | ----------- | ------------------ | ---------- |
| `dashboard`  | Dashboard  | `/`           | no         | no          | -                  | -          |
| `notes`      | Tagebuch   | `/tagebuch`   | no         | yes         | -                  | -          |
| `bingo`      | Bingo      | `/bingo`      | no         | yes         | -                  | -          |
| `world`      | Welt       | `/welt`       | no         | yes         | -                  | -          |
| `sessions`   | Sessions   | `/sessions`   | no         | yes         | `recordingEnabled` | `sessions` |
| `whiteboard` | Whiteboard | `/whiteboard` | no         | yes         | -                  | -          |
| `admin`      | Admin      | `/admin`      | yes        | no          | -                  | `admin`    |

## Admin & User Rules

- On first start a default admin `admin` is created with the password from `ADMIN_PASSWORD`.
- New Discord users must be approved by an admin before they can log in.
- Admin login is reachable via an Easter egg on the login page: click the title 5 times.
- The initial admin (`admin`) is the only one who needs `/admin-login`; promoted admins use the normal Discord login. The login checks the stored password hash and applies the same account lockout as Discord login.
- Admins can open every app; neither `disabledApps`, `adminOnly` nor feature flags restrict them.
- Promoted admins can participate in Bingo like normal players.
- The initial admin `admin` may not join Bingo as a player.
- Admins can approve/lock users, grant/revoke admin rights, delete users and disable individual apps per user (`disabledApps`).
- `/admin` is admin-only and shows user management and logs.
- `/bingo`, `/tagebuch`, `/welt`, `/whiteboard` can be locked for regular users via `disabledApps`.
