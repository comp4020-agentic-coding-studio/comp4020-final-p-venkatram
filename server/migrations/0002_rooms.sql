CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

-- Every user who has ever been in a room, so "rooms you're part of" survives
-- a reconnect or a next-day visit (the crit 9 returning-user question) —
-- separate from live presence, which is purely in-memory and only ever
-- reflects who is connected right now.
CREATE TABLE room_members (
  room_id TEXT NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, user_id)
);
