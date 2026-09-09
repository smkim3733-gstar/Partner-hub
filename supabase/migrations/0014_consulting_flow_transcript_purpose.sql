begin;

-- Preserve applied 0013. save_transcript uploads use the dedicated transcript
-- purpose from flowUploadReceiptRules; new recording attachments use recording.
create or replace function partner_hub.flow_recording_effect_valid(previous json, proposed json, command_id text, action text, updated_at text)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare context json; recording json; old_recording json; file_ids text[] := array[]::text[]; primary_file json; audio_file json;
  item json; expected json; history json; reason text; audit_detail text; enabled boolean; position integer; target_position integer; recording_id text; old_files integer;
begin
  if action is null or action not in ('save_recording','save_transcript') or command_id is null
    or not coalesce(partner_hub.valid_utc_millisecond(updated_at),false)
    or not partner_hub.flow_core_shape_valid(previous) or not partner_hub.flow_core_shape_valid(proposed)
    or json_typeof(proposed #> '{ai,enabled}') is distinct from 'boolean' or previous -> 'contract' is not null then return false; end if;
  context := partner_hub.flow_business_context(previous);
  if context is null or partner_hub.flow_business_context(proposed) is null then return false; end if;
  enabled := (proposed #>> '{ai,enabled}')::boolean; old_files := json_array_length(previous -> 'files');
  recording := proposed -> 'recordings' -> (json_array_length(proposed -> 'recordings') - 1); recording_id := recording ->> 'id';
  if recording_id is null or not partner_hub.flow_text_valid(recording -> 'transcript',0,60000) then return false; end if;
  if action = 'save_recording' then
    if recording_id <> command_id || '-recording' or recording ->> 'createdAt' is distinct from updated_at or recording ->> 'consentAt' is distinct from updated_at
      or not exists(select 1 from json_array_elements(previous -> 'meetings') entry where entry.value ->> 'id' = recording ->> 'meetingId' and entry.value ->> 'status' = 'completed') then return false; end if;
    if recording ->> 'transcript' <> '' then
      if length(recording ->> 'transcript') < 20 or exists(select 1 from json_array_elements(previous -> 'recordings') entry
        where entry.value ->> 'meetingId' = recording ->> 'meetingId' and entry.value ->> 'transcript' = recording ->> 'transcript') then return false; end if;
      if recording ->> 'transcriptReviewedAt' is distinct from updated_at or not partner_hub.flow_text_valid(recording -> 'transcriptReviewedBy',1,200) then return false; end if;
    elsif recording -> 'transcriptReviewedAt' is not null or recording -> 'transcriptReviewedBy' is not null then return false; end if;
    if recording -> 'fileId' is not null then
      if not partner_hub.flow_text_valid(recording -> 'fileId',1,200) then return false; end if;
      file_ids := array_append(file_ids,recording ->> 'fileId');
      primary_file := proposed -> 'files' -> old_files;
    end if;
    if recording -> 'audioFileId' is not null then
      if not partner_hub.flow_text_valid(recording -> 'audioFileId',1,200) then return false; end if;
      if recording ->> 'audioFileId' is distinct from recording ->> 'fileId' then file_ids := array_append(file_ids,recording ->> 'audioFileId'); end if;
    end if;
    if json_array_length(proposed -> 'files') <> old_files + cardinality(file_ids) or not partner_hub.flow_json_array_prefix(previous -> 'files',proposed -> 'files') then return false; end if;
    for position in 1..cardinality(file_ids) loop
      item := proposed -> 'files' -> (old_files + position - 1);
      if item ->> 'id' is distinct from file_ids[position] or item ->> 'purpose' is distinct from 'recording' or item ->> 'createdAt' is distinct from updated_at
        or (select count(*) from json_each(item)) <> 7
        or exists(select 1 from json_each(item) property where property.key not in ('id','name','contentType','size','key','createdAt','purpose')) then return false; end if;
    end loop;
    if cardinality(file_ids) = 0 and length(recording ->> 'transcript') < 20 then return false; end if;
    if coalesce(primary_file ->> 'name','') ~* '\.(docx|txt)$' then
      if recording ->> 'transcriptFileId' is distinct from recording ->> 'fileId' or length(recording ->> 'transcript') < 20 then return false; end if;
    elsif recording -> 'transcriptFileId' is not null then return false; end if;
    if coalesce(primary_file ->> 'name','') ~* '\.(mp3|m4a|wav)$' then
      if recording ->> 'audioFileId' is distinct from recording ->> 'fileId' then return false; end if;
    elsif recording -> 'audioFileId' is not null and recording ->> 'audioFileId' is not distinct from recording ->> 'fileId' then return false; end if;
    if recording -> 'audioFileId' is not null then
      select entry.value into audio_file from json_array_elements(proposed -> 'files') entry where entry.value ->> 'id' = recording ->> 'audioFileId';
      if not coalesce(audio_file ->> 'name' ~* '\.(mp3|m4a|wav)$',false) then return false; end if;
    end if;
    expected := json_build_object('id',recording_id,'meetingId',recording ->> 'meetingId');
    if recording -> 'fileId' is not null then expected := partner_hub.flow_json_object_edit(expected,json_build_object('fileId',recording ->> 'fileId')); end if;
    if recording -> 'transcriptFileId' is not null then expected := partner_hub.flow_json_object_edit(expected,json_build_object('transcriptFileId',recording ->> 'transcriptFileId')); end if;
    if recording -> 'audioFileId' is not null then expected := partner_hub.flow_json_object_edit(expected,json_build_object('audioFileId',recording ->> 'audioFileId')); end if;
    expected := partner_hub.flow_json_object_edit(expected,json_build_object('transcript',recording ->> 'transcript'));
    if recording ->> 'transcript' <> '' then expected := partner_hub.flow_json_object_edit(expected,json_build_object('transcriptReviewedAt',updated_at,'transcriptReviewedBy',recording ->> 'transcriptReviewedBy')); end if;
    expected := partner_hub.flow_json_object_edit(expected,json_build_object('consentAt',updated_at,'createdAt',updated_at));
    if partner_hub.flow_json_compact(recording) is distinct from partner_hub.flow_json_compact(expected) then return false; end if;
    audit_detail := case when recording ->> 'transcript' <> '' then '확인한 상담 전사문 저장 · 4차 심화보고서 생성 요청' else '보조 음성 보관 · 전사문 대기 (음성 자동전사 미실행)' end;
    reason := case when recording ->> 'transcript' = '' then '전사문 대기: Word·TXT를 첨부하거나 본문을 입력해 주세요. 음성은 보관만 하며 자동전사는 미연결입니다.'
      when not enabled then '김성민 대표의 외부 AI 자동생성 승인이 필요합니다.' else '' end;
    expected := json_build_object('id',command_id || '-job','stage',4,'sourceRecordingId',recording_id,'sourceReportId',context #>> '{r1,id}',
      'status',case when reason = '' then 'queued' else 'blocked' end,'reason',reason,'createdAt',updated_at);
    if context #>> '{r1,id}' is null or json_array_length(proposed -> 'jobs') <> json_array_length(previous -> 'jobs') + 1
      or not partner_hub.flow_json_array_prefix(previous -> 'jobs',proposed -> 'jobs')
      or partner_hub.flow_json_compact(proposed -> 'jobs' -> json_array_length(previous -> 'jobs')) is distinct from partner_hub.flow_json_compact(expected) then return false; end if;
  else
    old_recording := previous -> 'recordings' -> (json_array_length(previous -> 'recordings') - 1);
    if proposed -> 'commandReceipts' -> command_id ->> 'targetId' is distinct from recording_id or old_recording ->> 'id' is distinct from recording_id
      or not partner_hub.flow_text_valid(recording -> 'transcript',20,60000) or old_recording ->> 'transcript' is not distinct from recording ->> 'transcript'
      or recording ->> 'transcriptReviewedAt' is distinct from updated_at or not partner_hub.flow_text_valid(recording -> 'transcriptReviewedBy',1,200)
      or exists(select 1 from json_array_elements(previous -> 'jobs') entry where entry.value ->> 'sourceRecordingId' = recording_id and entry.value ->> 'status' in ('processing','complete')) then return false; end if;
    -- Preserve upload behavior as well as the old job-only SQL guard: one new
    -- transcript attachment or unchanged existing transcript-file reference.
    if json_array_length(proposed -> 'files') = old_files then
      if not partner_hub.flow_json_field_equal(previous,proposed,'files')
        or not partner_hub.flow_json_field_equal(old_recording,recording,'transcriptFileId')
        or json_typeof(old_recording -> 'transcriptFileId') is distinct from json_typeof(recording -> 'transcriptFileId') then return false; end if;
    else
      if not partner_hub.flow_attachment_effect_valid(previous -> 'files',proposed -> 'files',recording ->> 'transcriptFileId','transcript',updated_at,true) then return false; end if;
      item := proposed -> 'files' -> old_files;
      if not coalesce(item ->> 'name' ~* '\.(docx|txt)$',false) then return false; end if;
    end if;
    if json_array_length(proposed -> 'jobs') <> json_array_length(previous -> 'jobs') then return false; end if;
    select (entry.position - 1)::integer into target_position from json_array_elements(previous -> 'jobs') with ordinality entry(value,position)
      where entry.value ->> 'sourceRecordingId' = recording_id order by entry.position desc limit 1;
    audit_detail := case when previous -> 'jobs' -> target_position ->> 'status' = 'failed' and not enabled
      then '전사문 보완 · AI 재승인 후 재시도 필요' else '전사문 보완 · 4차 생성 준비' end;
    for position in 0..json_array_length(previous -> 'jobs') - 1 loop
      item := previous -> 'jobs' -> position; expected := item;
      if position = target_position and not (item ->> 'status' = 'failed' and not enabled) then
        if json_typeof(item -> 'failureEvidence') = 'object' then
          history := coalesce(item -> 'failureEvidenceHistory','[]'::json);
          if json_typeof(history) is distinct from 'array' or json_array_length(history) >= 20 then return false; end if;
          history := (left(partner_hub.flow_json_compact(history),length(partner_hub.flow_json_compact(history)) - 1)
            || case when json_array_length(history) > 0 then ',' else '' end || partner_hub.flow_json_compact(item -> 'failureEvidence') || ']')::json;
          expected := partner_hub.flow_json_object_edit(expected,json_build_object('failureEvidenceHistory',history));
        end if;
        expected := partner_hub.flow_json_object_edit(expected,json_build_object('status',case when enabled then 'queued' else 'blocked' end,
          'reason',case when enabled then '' else '대표의 AI 자동생성 승인이 필요합니다.' end),array['failureEvidence','startedAt']);
      end if;
      if partner_hub.flow_json_compact(proposed -> 'jobs' -> position) is distinct from partner_hub.flow_json_compact(expected) then return false; end if;
    end loop;
  end if;
  if (select count(*) from json_array_elements(proposed -> 'audit') entry where entry.value ->> 'id' = command_id
    and entry.value ->> 'action' = action and entry.value ->> 'at' = updated_at and entry.value ->> 'detail' = audit_detail) <> 1 then return false; end if;
  return true;
exception when data_exception then return false;
end;
$$;

revoke all on function partner_hub.flow_recording_effect_valid(json,json,text,text,text) from public,anon,authenticated;
grant execute on function partner_hub.flow_recording_effect_valid(json,json,text,text,text) to service_role;

commit;

