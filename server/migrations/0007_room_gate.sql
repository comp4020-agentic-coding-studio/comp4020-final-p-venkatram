-- A mandatory password set by the room's organizer at creation time, like a
-- Meet/Zoom link needing a passcode. Reuses the exact hashing scheme
-- server/auth.ts already uses for account passwords (hashSecret/verifySecret)
-- so there's one password-hashing code path in the app, not two.
--
-- password_set_at is nullable on purpose: a room created before this
-- migration has no password a human ever chose, so it gets '' hash/salt and
-- a NULL password_set_at — "no password yet, unusable via the join-request
-- gate until the owner sets one" (server/routes/rooms.ts exposes a
-- set-password route for exactly this). This is a one-time migration nuance
-- documented here rather than silently faking a password for old rooms.
ALTER TABLE rooms ADD COLUMN password_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE rooms ADD COLUMN password_salt TEXT NOT NULL DEFAULT '';
ALTER TABLE rooms ADD COLUMN password_set_at INTEGER;
