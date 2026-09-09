import { isPostgresDatabase } from './database-dialect';

type MemberPredicate = {
  state: `?${number}`;
  member: `?${number}` | 'l.member_id';
  email: `?${number}` | 'l.email';
  status: 'active' | 'not-suspended';
};

// Only fixed source-code expressions are interpolated. User values stay bound.
// Keep the duplicate-ID check inside the same transaction as the auth write.
export function portalMemberExistsSql(db: D1Database, input: MemberPredicate) {
  const { state, member, email, status } = input;
  if (!/^\?[1-9]\d*$/.test(state) ||
      !(member === 'l.member_id' || /^\?[1-9]\d*$/.test(member)) ||
      !(email === 'l.email' || /^\?[1-9]\d*$/.test(email)) ||
      !['active', 'not-suspended'].includes(status))
    throw new Error('INVALID_MEMBER_SQL_EXPRESSION');
  const statusComparison = status === 'active' ? "= '활성'" : "!= '정지'";
  if (!isPostgresDatabase(db)) {
    return `EXISTS (SELECT 1 FROM portal_state s, json_each(s.payload, '$.members') m
      WHERE s.id = ${state} AND json_extract(m.value, '$.id') = ${member}
      AND (SELECT COUNT(*) FROM json_each(s.payload, '$.members') all_m
        WHERE json_extract(all_m.value, '$.id') = ${member}) = 1
      AND lower(trim(json_extract(m.value, '$.email'))) = ${email}
      AND json_extract(m.value, '$.status') ${statusComparison})`;
  }
  const members = `jsonb_array_elements(CASE WHEN jsonb_typeof(s.payload::jsonb -> 'members') = 'array'
    THEN s.payload::jsonb -> 'members' ELSE '[]'::jsonb END)`;
  return `EXISTS (SELECT 1 FROM portal_state s, ${members} m(value)
    WHERE s.id = ${state} AND jsonb_typeof(m.value -> 'id') = 'string'
    AND m.value ->> 'id' = ${member}
    AND (SELECT COUNT(*) FROM ${members} all_m(value)
      WHERE jsonb_typeof(all_m.value -> 'id') = 'string'
        AND all_m.value ->> 'id' = ${member}) = 1
    AND jsonb_typeof(m.value -> 'email') = 'string'
    AND lower(trim(m.value ->> 'email')) = ${email}
    AND jsonb_typeof(m.value -> 'status') = 'string'
    AND m.value ->> 'status' ${statusComparison})`;
}
