-- Preserve existing login statistics while constraining every future insert and update.
CREATE TRIGGER IF NOT EXISTS portal_login_stats_insert_envelope_guard
BEFORE INSERT ON portal_login_stats
WHEN typeof(NEW.member_id) <> 'text'
  OR NEW.member_id = ''
  OR trim(NEW.member_id) <> NEW.member_id
  OR typeof(NEW.last_login_at) <> 'text'
  OR length(NEW.last_login_at) <> 24
  OR substr(NEW.last_login_at, 5, 1) <> '-'
  OR substr(NEW.last_login_at, 8, 1) <> '-'
  OR substr(NEW.last_login_at, 11, 1) <> 'T'
  OR substr(NEW.last_login_at, 14, 1) <> ':'
  OR substr(NEW.last_login_at, 17, 1) <> ':'
  OR substr(NEW.last_login_at, 20, 1) <> '.'
  OR substr(NEW.last_login_at, 24, 1) <> 'Z'
  OR julianday(NEW.last_login_at) IS NULL
  OR typeof(NEW.login_count) <> 'integer'
  OR NEW.login_count <> 1
BEGIN
  SELECT RAISE(ABORT, 'portal login stat insert envelope is invalid');
END;

CREATE TRIGGER IF NOT EXISTS portal_login_stats_identity_immutable
BEFORE UPDATE ON portal_login_stats
WHEN NEW.member_id IS NOT OLD.member_id
BEGIN
  SELECT RAISE(ABORT, 'portal login stat identity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS portal_login_stats_update_envelope_guard
BEFORE UPDATE ON portal_login_stats
WHEN NEW.member_id IS OLD.member_id
  AND (
    typeof(NEW.last_login_at) <> 'text'
    OR length(NEW.last_login_at) <> 24
    OR substr(NEW.last_login_at, 5, 1) <> '-'
    OR substr(NEW.last_login_at, 8, 1) <> '-'
    OR substr(NEW.last_login_at, 11, 1) <> 'T'
    OR substr(NEW.last_login_at, 14, 1) <> ':'
    OR substr(NEW.last_login_at, 17, 1) <> ':'
    OR substr(NEW.last_login_at, 20, 1) <> '.'
    OR substr(NEW.last_login_at, 24, 1) <> 'Z'
    OR julianday(NEW.last_login_at) IS NULL
    OR typeof(NEW.login_count) <> 'integer'
    OR NEW.login_count < 1
    OR NEW.login_count > 9007199254740991
    OR NEW.last_login_at < OLD.last_login_at
    OR NOT (
      NEW.login_count = OLD.login_count
      OR (
        NEW.login_count = OLD.login_count + 1
        AND NEW.last_login_at >= strftime(
          '%Y-%m-%dT%H:%M:%fZ',
          OLD.last_login_at,
          '+30 minutes'
        )
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'portal login stat update envelope is invalid');
END;
