import {
  inventorySources,
  inventoryStates,
  type InventoryFilter,
  type InventoryItem,
  type InventoryPage,
  type InventoryPresence,
} from './file-inventory';

type JsonObject = Record<string, unknown>;

export class FileInventoryResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'FileInventoryResponseError';
  }
}

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function boundedText(value: unknown, maxLength: number, allowEmpty = false) {
  return (
    typeof value === 'string' &&
    value.length <= maxLength &&
    (allowEmpty || value.trim().length > 0)
  );
}

function nullableText(value: unknown, maxLength: number) {
  return value === null || boundedText(value, maxLength, true);
}

function nullableSize(value: unknown) {
  return value === null || (Number.isSafeInteger(value) && Number(value) >= 0);
}

function validDate(value: unknown) {
  return (
    boundedText(value, 100) && Number.isFinite(Date.parse(value as string))
  );
}

function parseItem(value: unknown): InventoryItem | null {
  const item = asObject(value);
  if (
    !item ||
    !boundedText(item.id, 120) ||
    !/^[A-Za-z0-9_-]{1,120}$/.test(item.id as string) ||
    typeof item.source !== 'string' ||
    !Object.hasOwn(inventorySources, item.source) ||
    !nullableText(item.fileName, 500) ||
    !nullableText(item.company, 500) ||
    !nullableText(item.title, 500) ||
    !nullableText(item.category, 200) ||
    !nullableSize(item.sizeBytes) ||
    !validDate(item.createdAt) ||
    !nullableText(item.assignedTrainee, 200) ||
    !nullableText(item.partnerMemberId, 200) ||
    !boundedText(item.uploader, 500) ||
    !nullableText(item.caseId, 200) ||
    typeof item.documentLinked !== 'boolean' ||
    typeof item.flowLinked !== 'boolean' ||
    typeof item.status !== 'string' ||
    !Object.hasOwn(inventoryStates, item.status)
  )
    return null;

  return {
    id: item.id as string,
    source: item.source as InventoryItem['source'],
    fileName: item.fileName as string | null,
    company: item.company as string | null,
    title: item.title as string | null,
    category: item.category as string | null,
    sizeBytes: item.sizeBytes as number | null,
    createdAt: item.createdAt as string,
    assignedTrainee: item.assignedTrainee as string | null,
    partnerMemberId: item.partnerMemberId as string | null,
    uploader: item.uploader as string,
    caseId: item.caseId as string | null,
    documentLinked: item.documentLinked,
    flowLinked: item.flowLinked,
    status: item.status as InventoryItem['status'],
  };
}

async function readJson(response: Response, subject: string) {
  try {
    return await response.json();
  } catch {
    throw new FileInventoryResponseError(
      `${subject} 응답을 읽지 못했습니다. 잠시 후 다시 확인해 주세요.`,
      response.status,
    );
  }
}

function errorMessage(value: unknown, fallback: string) {
  const payload = asObject(value);
  return boundedText(payload?.error, 1_000)
    ? (payload?.error as string)
    : fallback;
}

function invalid(status: number, subject: string) {
  return new FileInventoryResponseError(
    `${subject} 응답 형식이 올바르지 않습니다. 처음부터 다시 조회해 주세요.`,
    status,
  );
}

export async function readFileInventoryPageResponse(
  response: Response,
  expectedFilter: InventoryFilter,
): Promise<InventoryPage> {
  const raw = await readJson(response, '보관 목록');
  if (!response.ok)
    throw new FileInventoryResponseError(
      errorMessage(raw, '보관 목록을 불러오지 못했습니다.'),
      response.status,
    );

  const payload = asObject(raw);
  if (
    !payload ||
    !Array.isArray(payload.items) ||
    payload.items.length > 25 ||
    (payload.nextCursor !== null &&
      (!boundedText(payload.nextCursor, 600) ||
        !/^[A-Za-z0-9_-]+$/.test(payload.nextCursor as string))) ||
    !validDate(payload.checkedAt)
  )
    throw invalid(response.status, '보관 목록');

  const items = payload.items.map(parseItem);
  if (
    items.some((item) => item === null) ||
    new Set(items.map((item) => item?.id)).size !== items.length ||
    (expectedFilter !== 'all' &&
      items.some((item) => item?.status !== expectedFilter))
  )
    throw invalid(response.status, '보관 목록');

  return {
    items: items as InventoryItem[],
    nextCursor: payload.nextCursor as string | null,
    checkedAt: payload.checkedAt as string,
  };
}

export async function readFileInventoryPresenceResponse(
  response: Response,
  expectedId: string,
): Promise<InventoryPresence> {
  const raw = await readJson(response, '원본 존재 확인');
  if (!response.ok)
    throw new FileInventoryResponseError(
      errorMessage(raw, '원본 존재를 확인하지 못했습니다.'),
      response.status,
    );

  const payload = asObject(raw);
  if (
    !payload ||
    payload.id !== expectedId ||
    typeof payload.exists !== 'boolean' ||
    !nullableSize(payload.sizeBytes) ||
    !nullableSize(payload.expectedSizeBytes) ||
    (payload.sizeMatches !== null &&
      typeof payload.sizeMatches !== 'boolean') ||
    (payload.integrityMode !== null &&
      payload.integrityMode !== 'metadata' &&
      payload.integrityMode !== 'etag') ||
    (payload.integrityMatches !== null &&
      typeof payload.integrityMatches !== 'boolean') ||
    !validDate(payload.checkedAt) ||
    (payload.exists
      ? payload.sizeBytes === null
      : payload.sizeBytes !== null || payload.sizeMatches !== null) ||
    (payload.exists && payload.expectedSizeBytes === null
      ? payload.sizeMatches !== null
      : payload.exists && payload.sizeMatches === null) ||
    (payload.expectedSizeBytes === null
      ? payload.integrityMode !== null || payload.integrityMatches !== null
      : payload.exists
        ? payload.integrityMatches === null
          ? payload.integrityMode !== null
          : payload.integrityMatches === true && payload.integrityMode === null
        : payload.integrityMatches !== null)
  )
    throw invalid(response.status, '원본 존재 확인');

  return {
    id: payload.id as string,
    exists: payload.exists,
    sizeBytes: payload.sizeBytes as number | null,
    expectedSizeBytes: payload.expectedSizeBytes as number | null,
    sizeMatches: payload.sizeMatches as boolean | null,
    integrityMode: payload.integrityMode as InventoryPresence['integrityMode'],
    integrityMatches: payload.integrityMatches as boolean | null,
    checkedAt: payload.checkedAt as string,
  };
}
