import { flowDatabase } from '@/lib/consulting-flow-store';
import { isPostgresDatabase } from '@/lib/database-dialect';

export type ConsultingFlowMetricRow = {
  case_id: string;
  first_completed_at: unknown;
  analysis_report_id: unknown;
  analysis_admin_at: unknown;
  analysis_partner_at: unknown;
  latest_stage1_report_id: unknown;
  request_metrics_json: unknown;
};

/** One narrow FLOW scan shared by administrator summaries. */
export async function readConsultingFlowMetricRows() {
  const db = await flowDatabase();
  if (isPostgresDatabase(db)) {
    // Project only the fields used by administrator summaries, never source
    // text, reports, file paths, command receipts or the full FLOW payload.
    return (
      await db
        .prepare(`
      SELECT f.case_id,
        (SELECT MIN(m.value->>'completedAt')
         FROM jsonb_array_elements(f.payload::jsonb->'meetings') m(value)
         WHERE m.value->>'kind' = 'first' AND m.value->>'status' = 'completed'
           AND jsonb_typeof(m.value->'completedAt') = 'string') AS first_completed_at,
        f.payload::jsonb #>> '{analysis,reportId}' AS analysis_report_id,
        f.payload::jsonb #>> '{analysis,adminAt}' AS analysis_admin_at,
        f.payload::jsonb #>> '{analysis,partnerAt}' AS analysis_partner_at,
        (SELECT r.value->>'id'
         FROM jsonb_array_elements(f.payload::jsonb->'reports') WITH ORDINALITY r(value, position)
         WHERE r.value->'stage' = '1'::jsonb
         ORDER BY r.position DESC LIMIT 1) AS latest_stage1_report_id,
        (SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'status', q.value->'status',
          'hasFile', CASE WHEN jsonb_typeof(q.value->'fileId') = 'string'
            AND q.value->>'fileId' <> '' THEN 1 ELSE 0 END,
          'receivedAt', q.value->'receivedAt',
          'reviewedAt', q.value->'reviewedAt'
        ) ORDER BY q.position), '[]'::jsonb)::text
         FROM jsonb_array_elements(f.payload::jsonb->'requests') WITH ORDINALITY q(value, position)) AS request_metrics_json
      FROM consulting_flows f
    `)
        .all<ConsultingFlowMetricRow>()
    ).results;
  }
  return (
    await db
      .prepare(`
        SELECT f.case_id,
          (SELECT MIN(json_extract(m.value, '$.completedAt'))
           FROM json_each(f.payload, '$.meetings') m
           WHERE json_extract(m.value, '$.kind') = 'first'
             AND json_extract(m.value, '$.status') = 'completed'
             AND json_type(m.value, '$.completedAt') = 'text') AS first_completed_at,
          json_extract(f.payload, '$.analysis.reportId') AS analysis_report_id,
          json_extract(f.payload, '$.analysis.adminAt') AS analysis_admin_at,
          json_extract(f.payload, '$.analysis.partnerAt') AS analysis_partner_at,
          (SELECT json_extract(r.value, '$.id')
           FROM json_each(f.payload, '$.reports') r
           WHERE json_extract(r.value, '$.stage') = 1
           ORDER BY CAST(r.key AS INTEGER) DESC
           LIMIT 1) AS latest_stage1_report_id,
          (SELECT json_group_array(json_object(
            'status', json_extract(q.value, '$.status'),
            'hasFile', CASE
              WHEN json_type(q.value, '$.fileId') = 'text'
                AND json_extract(q.value, '$.fileId') <> '' THEN 1
              ELSE 0
            END,
            'receivedAt', json_extract(q.value, '$.receivedAt'),
            'reviewedAt', json_extract(q.value, '$.reviewedAt')
          )) FROM json_each(f.payload, '$.requests') q) AS request_metrics_json
        FROM consulting_flows f
      `)
      .all<ConsultingFlowMetricRow>()
  ).results;
}
