// 시험 환경 도구 공통 설정. 운영 프로젝트에는 절대 연결하지 않는다.
// 시험 도구는 운영과 분리된 별도 작업 폴더(git worktree)에서 실행한다. 그 폴더의 .env.local 이 시험용 값이 된다.
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const productionRef = 'yievsveuxjnbygatvjtb';

/** 시험 프로젝트 ID: 환경변수 PARTNER_HUB_TEST_PROJECT_REF (Supabase 대시보드 주소의 20글자). */
export function testProjectRef() {
  const ref = process.env.PARTNER_HUB_TEST_PROJECT_REF ?? '';
  if (!/^[a-z0-9]{20}$/.test(ref))
    throw new Error('PARTNER_HUB_TEST_PROJECT_REF 에 시험용 Supabase 프로젝트 ID(20글자)를 넣어 주세요.');
  if (ref === productionRef) throw new Error('운영 프로젝트입니다. 시험 도구는 운영에 연결하지 않습니다.');
  return ref;
}

/** 이미 저장된 시험 .env.local 이 시험 프로젝트를 가리키는지 확인한다. */
export function assertTestEnvironment() {
  const ref = testProjectRef();
  const url = new URL(process.env.SUPABASE_DATABASE_URL ?? 'postgresql://invalid');
  if (
    url.username !== `postgres.${ref}` ||
    process.env.SUPABASE_URL !== `https://${ref}.supabase.co`
  )
    throw new Error('.env.local 이 시험용 프로젝트가 아닙니다. 중단합니다.');
  return { ref, url };
}
