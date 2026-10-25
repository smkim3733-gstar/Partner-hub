// 시험용 Supabase 프로젝트에만 스키마(supabase/migrations 전체)와 비공개 Storage 버킷을 만든다.
// 안전장치: .env.local 이 시험 프로젝트가 아니면 즉시 중단한다. 비밀값은 출력하지 않는다.
// 실행 (작업 폴더에서): node --env-file=.env.local tools/test-env/setup-test-db.mjs
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { assertTestEnvironment, repoDir } from './common.mjs';

const { url } = assertTestEnvironment();
// DDL은 세션 풀러(5432)로 실행한다.
const sql = postgres({
  host: url.hostname, port: 5432, database: 'postgres',
  username: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
  ssl: 'require', prepare: false, max: 1, onnotice: () => {},
});
try {
  const [{ exists }] = await sql`select exists(select 1 from information_schema.schemata where schema_name = 'partner_hub') as exists`;
  const dir = path.join(repoDir, 'supabase', 'migrations');
  const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  if (exists) {
    console.log('partner_hub 스키마가 이미 있습니다. 마이그레이션은 건너뜁니다.');
  } else {
    for (const file of files) {
      await sql.unsafe(readFileSync(path.join(dir, file), 'utf8'));
      console.log(`적용: ${file}`);
    }
  }
  const [{ tables }] = await sql`select count(*)::int as tables from information_schema.tables where table_schema = 'partner_hub'`;
  const [{ rls }] = await sql`select count(*)::int as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'partner_hub' and c.relkind = 'r' and c.relrowsecurity`;
  console.log(`partner_hub 테이블 ${tables}개, RLS 활성 ${rls}개`);
} finally {
  await sql.end({ timeout: 5 });
}

// 비공개 Storage 버킷 (운영과 같은 설정)
const base = `${process.env.SUPABASE_URL}/storage/v1`;
const headers = { apikey: process.env.SUPABASE_SECRET_KEY, 'content-type': 'application/json' };
const bucket = process.env.SUPABASE_STORAGE_BUCKET;
let r = await fetch(`${base}/bucket/${bucket}`, { headers });
if (r.status !== 200) {
  r = await fetch(`${base}/bucket`, {
    method: 'POST', headers,
    body: JSON.stringify({ id: bucket, name: bucket, public: false, file_size_limit: 26214400, allowed_mime_types: ['application/octet-stream'] }),
  });
  console.log(`버킷 생성 응답: ${r.status}`);
  r = await fetch(`${base}/bucket/${bucket}`, { headers });
}
const b = await r.json();
console.log(`버킷: ${b.id} public=${b.public} limit=${b.file_size_limit} mime=${JSON.stringify(b.allowed_mime_types)}`);
