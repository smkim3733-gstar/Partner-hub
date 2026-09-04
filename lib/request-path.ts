export class RouteParamError extends Error {
  public readonly status = 400;
}

export function readRouteParam(
  value: unknown,
  maxLength = 120,
  message = '요청 경로의 식별값을 확인해 주세요.',
) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxLength ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  )
    throw new RouteParamError(message);
  return value;
}
