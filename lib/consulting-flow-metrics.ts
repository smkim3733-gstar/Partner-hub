import { flowDatabase } from '@/lib/consulting-flow-store';

export type ConsultingFlowMetricRow = {
  case_id: string;
  first_completed_at: unknown;
  analysis_report_id: unknown;
  analysis_admin_at: unknown;
  analysis_partner_at: unknown;
  latest_stage1_report_id: unknown;
};

/** One narrow FLOW scan shared by administrator summaries. */
export async function readConsultingFlowMetricRows() {
  return (
    await (
      await flowDatabase()
    )
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
           LIMIT 1) AS latest_stage1_report_id
        FROM consulting_flows f
      `)
      .all<ConsultingFlowMetricRow>()
  ).results;
}
