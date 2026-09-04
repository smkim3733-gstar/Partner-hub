-- Additive only. Store a one-way key for the stable ChatGPT user ID; never expose it in portal_state.
CREATE TABLE IF NOT EXISTS portal_chatgpt_member_bindings (
  member_id TEXT PRIMARY KEY NOT NULL,
  user_key TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
