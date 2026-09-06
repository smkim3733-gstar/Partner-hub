CREATE TRIGGER IF NOT EXISTS consulting_flows_request_document_effect_guard
BEFORE UPDATE ON consulting_flows
WHEN COALESCE(json_array_length(NEW.payload, '$.commandIds'), 0) >
    COALESCE(json_array_length(OLD.payload, '$.commandIds'), 0)
  AND EXISTS (
    WITH command(id, actor_key, action) AS (
      SELECT command.value,
        json_extract(receipt.value, '$.actorKey'),
        json_extract(receipt.value, '$.action')
      FROM json_each(NEW.payload, '$.commandIds') AS command
      JOIN json_each(NEW.payload, '$.commandReceipts') AS receipt
        ON receipt.key IS command.value
      WHERE command.key = json_array_length(OLD.payload, '$.commandIds')
    ), request(value) AS (
      SELECT json_extract(
        NEW.payload,
        '$.requests[' ||
          COALESCE(json_array_length(OLD.payload, '$.requests'), 0) || ']'
      )
    )
    SELECT 1 FROM command, request
    WHERE command.action IS 'request_document'
      AND (
        command.actor_key IS NOT 'admin:primary'
        OR json_type(OLD.payload, '$.contract') IS NOT NULL
        OR json_type(request.value) IS NOT 'object'
        OR (SELECT count(*) FROM json_each(request.value)) IS NOT 9
        OR EXISTS (
          SELECT 1 FROM json_each(request.value) AS field
          WHERE field.key NOT IN (
            'id', 'title', 'required', 'channel', 'recipient', 'dueDate',
            'status', 'note', 'createdAt'
          )
        )
        OR json_extract(request.value, '$.id') IS NOT
          (command.id || '-request')
        OR json_type(request.value, '$.title') IS NOT 'text'
        OR length(trim(json_extract(request.value, '$.title'))) = 0
        OR json_extract(request.value, '$.title') IS NOT
          trim(json_extract(request.value, '$.title'))
        OR length(json_extract(request.value, '$.title')) > 150
        OR json_type(request.value, '$.required') NOT IN ('true', 'false')
        OR json_type(request.value, '$.channel') IS NOT 'text'
        OR json_extract(request.value, '$.channel') NOT IN (
          '카카오톡', '이메일', '기타'
        )
        OR json_type(request.value, '$.recipient') IS NOT 'text'
        OR length(trim(json_extract(request.value, '$.recipient'))) = 0
        OR json_extract(request.value, '$.recipient') IS NOT
          trim(json_extract(request.value, '$.recipient'))
        OR length(json_extract(request.value, '$.recipient')) > 100
        OR json_type(request.value, '$.dueDate') IS NOT 'text'
        OR (
          json_extract(request.value, '$.dueDate') <> ''
          AND (
            length(json_extract(request.value, '$.dueDate')) <> 10
            OR substr(json_extract(request.value, '$.dueDate'), 5, 1) <> '-'
            OR substr(json_extract(request.value, '$.dueDate'), 8, 1) <> '-'
            OR strftime(
              '%Y-%m-%d',
              json_extract(request.value, '$.dueDate'),
              '+0 days'
            ) IS NOT json_extract(request.value, '$.dueDate')
          )
        )
        OR json_extract(request.value, '$.status') IS NOT 'requested'
        OR json_extract(request.value, '$.note') IS NOT ''
        OR json_extract(request.value, '$.createdAt') IS NOT NEW.updated_at
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'consulting flow request document effect is invalid');
END;
