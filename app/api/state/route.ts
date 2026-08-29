import { readPortalState, writePortalState } from '@/lib/portal-state';

const MAX_STATE_BYTES = 900_000;

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return Response.json({ state: await readPortalState() });
  } catch (error) {
    console.error('Failed to read portal state', error);
    return Response.json({ error: '저장된 운영 데이터를 불러오지 못했습니다.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const bodyText = await request.text();
    if (!bodyText || new TextEncoder().encode(bodyText).byteLength > MAX_STATE_BYTES) {
      return Response.json({ error: '저장 데이터의 크기가 허용 범위를 초과했습니다.' }, { status: 413 });
    }

    const body = JSON.parse(bodyText) as { state?: unknown };
    if (!body.state || typeof body.state !== 'object' || Array.isArray(body.state)) {
      return Response.json({ error: '저장할 운영 데이터 형식이 올바르지 않습니다.' }, { status: 400 });
    }

    return Response.json({ ok: true, updatedAt: await writePortalState(body.state) });
  } catch (error) {
    console.error('Failed to write portal state', error);
    return Response.json({ error: '운영 데이터를 저장하지 못했습니다.' }, { status: 500 });
  }
}
