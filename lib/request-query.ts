export class QueryRequestError extends Error {
  readonly status = 400;

  constructor() {
    super('요청 주소의 입력값을 확인해 주세요.');
  }
}

export function readSingleQueryParam(url: URL, key: string, maxLength: number) {
  const values = url.searchParams.getAll(key);
  if (values.length > 1) throw new QueryRequestError();
  const value = values[0] ?? null;
  if (value !== null && value.length > maxLength) throw new QueryRequestError();
  return value;
}

export function readExactQueryFlag(url: URL, key: string, expectedValue = '1') {
  const value = readSingleQueryParam(
    url,
    key,
    Math.max(20, expectedValue.length),
  );
  if (value === null) return false;
  if (value !== expectedValue) throw new QueryRequestError();
  return true;
}
