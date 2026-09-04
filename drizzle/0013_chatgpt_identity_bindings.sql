-- Unify owner and member ChatGPT identities so one stable user ID cannot hold both roles.
CREATE TABLE IF NOT EXISTS portal_chatgpt_identity_bindings (
  subject_type TEXT NOT NULL CHECK (subject_type IN ('owner', 'member')),
  subject_id TEXT NOT NULL,
  user_key TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (subject_type, subject_id),
  CHECK (
    (subject_type = 'owner' AND subject_id = 'primary') OR
    (subject_type = 'member' AND length(subject_id) > 0)
  )
);

-- Preserve bindings if saved version 115 was applied before this migration.
INSERT OR IGNORE INTO portal_chatgpt_identity_bindings
  (subject_type, subject_id, user_key, created_at, updated_at)
SELECT 'member', member_id, user_key, created_at, updated_at
FROM portal_chatgpt_member_bindings;
