export const FLOW_FILE_STORAGE_PREFIX = 'consulting-flow/';

export function flowFileStorageKey(id: string) {
  return `${FLOW_FILE_STORAGE_PREFIX}${id}`;
}

export function storedFlowFileKeyMatches(id: unknown, key: unknown) {
  return (
    typeof id === 'string' &&
    typeof key === 'string' &&
    key === flowFileStorageKey(id)
  );
}
