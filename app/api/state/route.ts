import { readPortalState, writePortalState } from '@/lib/portal-state';
import {
  mergeStateForPortalUser,
  PortalAccessError,
  requirePortalUser,
  stateForPortalUser,
} from '@/lib/portal-auth';

const MAX_STATE_BYTES = 900_000;

export const dynamic = 'force-dynamic';

function accessErrorResponse(error: unknown) {
  if (error instanceof PortalAccessError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return null;
}

export async function GET(request: Request) {
  try {
    const state = await readPortalState();
    const currentUser = requirePortalUser(request, state);
    return Response.json({ state: stateForPortalUser(state, currentUser), currentUser });
  } catch (error) {
    const accessResponse = accessErrorResponse(error);
    if (accessResponse) return accessResponse;
    console.error('Failed to read portal state', error);
    return Response.json({ error: '저장된 운영 데이터를 불러오지 못했습니다.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const currentState = await readPortalState();
    const currentUser = requirePortalUser(request, currentState);
    const bodyText = await request.text();
    if (!bodyText || new TextEncoder().encode(bodyText).byteLength > MAX_STATE_BYTES) {
      return Response.json({ error: '저장 데이터의 크기가 허용 범위를 초과했습니다.' }, { status: 413 });
    }

    const body = JSON.parse(bodyText) as { state?: unknown };
    if (!body.state || typeof body.state !== 'object' || Array.isArray(body.state)) {
      return Response.json({ error: '저장할 운영 데이터 형식이 올바르지 않습니다.' }, { status: 400 });
    }

    const nextState = mergeStateForPortalUser(currentState, body.state, currentUser);
    return Response.json({ ok: true, updatedAt: await writePortalState(nextState) });
  } catch (error) {
    const accessResponse = accessErrorResponse(error);
    if (accessResponse) return accessResponse;
    console.error('Failed to write portal state', error);
    return Response.json({ error: '운영 데이터를 저장하지 못했습니다.' }, { status: 500 });
  }
}
