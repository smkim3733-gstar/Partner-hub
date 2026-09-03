'use client';
import { useEffect, useRef, useState } from 'react';
import { RecoverOriginal } from '@/components/recover-original';
import type { RecoveryControls } from '@/lib/file-recovery';
import { Archive, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  inventoryStates,
  inventoryNotes,
  type InventoryFilter,
  type InventoryPage,
  type InventoryPresence,
} from '@/lib/file-inventory';
import {
  readFileInventoryPageResponse,
  readFileInventoryPresenceResponse,
} from '@/lib/file-inventory-response';

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '시각 확인 필요'
    : new Intl.DateTimeFormat('ko-KR', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'Asia/Seoul',
      }).format(date);
}
function sizeLabel(value: number | null) {
  return value === null
    ? '크기 미확인'
    : `${value.toLocaleString('ko-KR')} bytes`;
}
export function AdminFileInventory(controls: RecoveryControls) {
  const [opened, setOpened] = useState(false);
  const [filter, setFilter] = useState<InventoryFilter>('unlinked');
  const [page, setPage] = useState<InventoryPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [checks, setChecks] = useState<
    Record<string, InventoryPresence | string>
  >({});
  const [checking, setChecking] = useState<string | null>(null);
  const sequence = useRef(0);
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );

  async function load(nextFilter: InventoryFilter, cursor?: string | null) {
    const attempt = ++sequence.current;
    setOpened(true);
    setBusy(true);
    setFilter(nextFilter);
    setError('');
    setPage(null);
    setChecks({});
    setChecking(null);
    try {
      const params = new URLSearchParams({ status: nextFilter });
      if (cursor) params.set('cursor', cursor);
      const response = await fetch(`/api/admin/file-inventory?${params}`, {
        cache: 'no-store',
      });
      const result = await readFileInventoryPageResponse(response, nextFilter);
      if (attempt === sequence.current) setPage(result);
    } catch (issue) {
      if (attempt === sequence.current)
        setError(
          issue instanceof Error ? issue.message : '조회하지 못했습니다.',
        );
    } finally {
      if (attempt === sequence.current) setBusy(false);
    }
  }
  async function check(id: string) {
    const attempt = sequence.current;
    setChecking(id);
    try {
      const response = await fetch(
        `/api/admin/file-inventory/${encodeURIComponent(id)}/presence`,
        { cache: 'no-store' },
      );
      const result = await readFileInventoryPresenceResponse(response, id);
      if (attempt === sequence.current)
        setChecks((current) => ({ ...current, [id]: result }));
    } catch (issue) {
      if (attempt === sequence.current)
        setChecks((current) => ({
          ...current,
          [id]: issue instanceof Error ? issue.message : '확인 실패',
        }));
    } finally {
      if (attempt === sequence.current) setChecking(null);
    }
  }
  return (
    <Card className="mt-6 border-sky-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Archive className="size-5" aria-hidden="true" /> 원본 보관 현황 ·
          대표 전용
        </CardTitle>
        <CardDescription>
          신청·자료 목록에 연결되지 않은 업로드와 보관 기록을 확인합니다. 조건이
          맞는 원본만 대표 확인 후 기존 신청에 회수하며 자동 삭제하지 않습니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!opened ? (
          <Button variant="outline" onClick={() => void load('unlinked')}>
            미연결 원본 확인
          </Button>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <label className="grid gap-1 text-sm font-medium">
                보관 상태
                <select
                  value={filter}
                  disabled={busy || controls.recoveryBusy}
                  onChange={(event) =>
                    void load(event.target.value as InventoryFilter)
                  }
                  className="min-h-11 rounded-lg border bg-background px-3"
                >
                  <option value="all">전체 확인 대상</option>
                  {Object.entries(inventoryStates).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                variant="outline"
                disabled={busy || controls.recoveryBusy}
                onClick={() => void load(filter)}
              >
                <RefreshCw
                  className={`size-4 ${busy ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />{' '}
                처음부터 새로 조회
              </Button>
            </div>
            <p className="rounded-lg bg-sky-50 p-3 text-sm leading-6 text-sky-950">
              <ShieldCheck className="mr-1 inline size-4" aria-hidden="true" />
              연결 확인 필요는 삭제 가능 판정이 아닙니다. 목록은 DB 기록
              기준이며, 원본 존재 확인은 파일 본문을 읽지 않고 존재·크기만
              조회합니다.
            </p>
            {busy && (
              <output className="block">보관 기록을 확인하고 있습니다.</output>
            )}
            {error && (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            )}
            {page && (
              <>
                <p className="text-xs text-muted-foreground">
                  현재 페이지 {page.items.length}건 · 조회{' '}
                  {dateLabel(page.checkedAt)} · 페이지당 최대 25건
                </p>
                {!page.items.length ? (
                  <p className="rounded-xl border border-dashed p-6 text-sm">
                    이 조건의 확인 대상이 없습니다. 다른 보관 상태로도 확인할 수
                    있습니다.
                  </p>
                ) : (
                  <div className="grid gap-3 lg:grid-cols-2">
                    {page.items.map((item) => {
                      const presence = checks[item.id];
                      return (
                        <article
                          key={item.id}
                          className="min-w-0 space-y-3 rounded-xl border p-4"
                        >
                          <div>
                            <span
                              className={`inline-flex rounded-md px-2 py-1 text-xs font-bold ${item.status === 'linked' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}
                            >
                              {inventoryStates[item.status]}
                            </span>
                            <h3 className="mt-2 break-words text-sm font-bold">
                              {item.fileName ||
                                '파일명 미확인 · 업로드 요청 기록'}
                            </h3>
                            <p className="mt-1 break-words text-xs text-muted-foreground">
                              {item.company || '기업정보 미확인'} ·{' '}
                              {item.title || '자료정보 미확인'}
                            </p>
                          </div>
                          <dl className="grid gap-2 text-xs">
                            <div>
                              <dt className="text-muted-foreground">
                                업로드 계정
                              </dt>
                              <dd className="break-words">{item.uploader}</dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">
                                보관 기록
                              </dt>
                              <dd>
                                {dateLabel(item.createdAt)} ·{' '}
                                {sizeLabel(item.sizeBytes)}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">파일 ID</dt>
                              <dd className="break-all font-mono">{item.id}</dd>
                            </div>
                            {item.caseId && (
                              <div>
                                <dt className="text-muted-foreground">
                                  진행 연결값 · 접수 완료 여부와 별개
                                </dt>
                                <dd className="break-all font-mono">
                                  {item.caseId}
                                </dd>
                              </div>
                            )}
                          </dl>
                          <p className="text-xs leading-5 text-muted-foreground">
                            {inventoryNotes[item.status]}
                          </p>
                          {(item.documentLinked || item.flowLinked) && (
                            <p className="text-xs font-medium">
                              직접 참조:{' '}
                              {[
                                item.documentLinked && '자료 목록',
                                item.flowLinked && '상담 파일',
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </p>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={
                              checking !== null || busy || controls.recoveryBusy
                            }
                            onClick={() => void check(item.id)}
                          >
                            {checking === item.id
                              ? '확인 중…'
                              : '원본 존재 확인'}
                          </Button>
                          {presence && (
                            <output className="block text-xs leading-5">
                              {typeof presence === 'string'
                                ? presence
                                : `${presence.exists ? '원본 존재' : '원본 없음'} · ${sizeLabel(presence.sizeBytes)}${presence.sizeMatches === false ? ' · 기록과 크기 불일치: 추가 확인 필요' : ''} · ${dateLabel(presence.checkedAt)}`}
                            </output>
                          )}
                          {item.status === 'unlinked' && (
                            <RecoverOriginal
                              fileId={item.id}
                              {...controls}
                              recoveryDisabled={
                                controls.recoveryDisabled ||
                                busy ||
                                checking !== null
                              }
                            />
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}
                {page.nextCursor && (
                  <Button
                    variant="outline"
                    disabled={busy || controls.recoveryBusy}
                    onClick={() => void load(filter, page.nextCursor)}
                  >
                    다음 25건
                  </Button>
                )}
                <p className="text-xs leading-5 text-muted-foreground">
                  조회 중 다른 창에서 변경하면 다음 페이지의 분류가 달라질 수
                  있습니다. DB 기록이 없는 저장소 객체와 상담 산출물 전체를 전수
                  조사하는 화면은 아닙니다. 자동 삭제·만료·복구 정책은 적용하지
                  않습니다.
                </p>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
