import {
  readPortalLoginStats,
  readPortalState,
  readPortalStateSnapshot,
  recordPortalLogin,
  mutatePortalState,
  PortalStateConflict,
  type PortalDraftGuard,
} from '@/lib/portal-state';
import {
  assertSameOrigin,
  stateWithConsultingFlows,
} from '@/lib/consulting-flow-store';
import { FlowError } from '@/lib/consulting-flow';
import { portalRevision } from '@/lib/portal-revision';
import { assertRecoveryProofUnchanged } from '@/lib/file-recovery-proof';
import { assertNewDraftCases } from '@/lib/application-draft-store';
import {
  ApplicationDetailsError,
  preserveApplicationDetails,
} from '@/lib/application-details';
import {
  membersRevisionOf,
  sameMemberRecords,
} from '@/lib/partner-registration';
import {
  mergeStateForPortalUser,
  PortalAccessError,
  requirePortalUser,
  stateForPortalUser,
  stateWithPortalLoginStats,
} from '@/lib/portal-auth';
import {
  PORTAL_STATE_LIMIT_BYTES,
  portalStorageTelemetry,
} from '@/lib/pilot-readiness';
import {
  issuePortalConflictReceipt,
  PORTAL_CONFLICT_RECEIPT_TTL_SECONDS,
  readPortalSaveConflictSummary,
  schedulePortalConflictRecovery,
  schedulePortalSaveConflict,
  type PortalConflictActorRole,
} from '@/lib/portal-conflict-metrics';
import { portalConflictReceiptFromRequest } from '@/lib/portal-conflict-receipt';
import { HeaderRequestError, readIfMatchRevision } from '@/lib/request-header';
import { chatGPTIdentityFromRequest } from '@/lib/request-auth';
import { readPasswordLinkSummary } from '@/lib/password-link-metrics';
import {
  protectApplicationSubmissionTimes,
  readApplicationConsultationSummary,
} from '@/lib/application-consultation-metrics';
import { draftCaseId } from '@/lib/application-draft';
import { readDuplicateRequestSummary } from '@/lib/duplicate-request-metrics';
import { readConsultingFlowMetricRows } from '@/lib/consulting-flow-metrics';
import { readJointAnalysisConfirmationSummary } from '@/lib/joint-analysis-confirmation-metrics';
import { readDocumentReviewWaitSummary } from '@/lib/document-review-wait-metrics';
import {
  protectSupportRequestTracking,
  readSupportRequestSummary,
  SupportRequestError,
} from '@/lib/support-request-metrics';
import {
  PipelineLifecycleError,
  protectPipelineLifecycle,
  readPipelineDropoffSummary,
} from '@/lib/pipeline-dropoff-metrics';
import { JsonRequestError, readBoundedJsonObject } from '@/lib/request-json';
import { privateJsonResponse } from '@/lib/private-response';
import {
  passwordAccessRevocationForStateChange,
  passwordAccessRevocationStatements,
  passwordCredentialEmailConflictForStateChange,
  passwordCredentialEmailConflictMessage,
} from '@/lib/password-store';

const privateJson = privateJsonResponse;

export const dynamic = 'force-dynamic';

function accessErrorResponse(error: unknown, request: Request) {
  if (error instanceof PortalAccessError) {
    const authenticatedEmail =
      error.status === 403
        ? chatGPTIdentityFromRequest(request)?.email
        : undefined;
    return privateJson(
      { error: error.message, authenticatedEmail },
      { status: error.status },
    );
  }
  return null;
}

export async function GET(request: Request) {
  try {
    const snapshot = await readPortalStateSnapshot();
    const rawState = snapshot.state;
    const currentUser = await requirePortalUser(request, rawState);
    const state = await stateWithConsultingFlows(rawState);
    if (currentUser.role === 'trainee' && currentUser.memberId) {
      await recordPortalLogin(currentUser.memberId).catch((error) => {
        // Access telemetry must never block an authorized partner from loading
        // their portal. Keep request and account details out of the log.
        console.error(
          'Failed to record portal login activity',
          error instanceof Error ? error.name : 'unknown',
        );
      });
    }
    const responseState =
      currentUser.role === 'admin'
        ? stateWithPortalLoginStats(state, await readPortalLoginStats())
        : stateForPortalUser(state, currentUser);
    const flowMetricRows =
      currentUser.role === 'admin' ? readConsultingFlowMetricRows() : null;
    const [
      saveConflicts,
      passwordLinks,
      applicationFunnel,
      duplicateRequests,
      jointAnalysisConfirmation,
      documentReviewWait,
      supportRequests,
      pipelineDropoff,
    ] =
      currentUser.role === 'admin'
        ? await Promise.all([
            readPortalSaveConflictSummary().catch((error) => {
              console.error(
                'Failed to read portal save conflict summary',
                error instanceof Error ? error.name : 'unknown',
              );
              return null;
            }),
            readPasswordLinkSummary().catch((error) => {
              console.error(
                'Failed to read password-link summary',
                error instanceof Error ? error.name : 'unknown',
              );
              return null;
            }),
            flowMetricRows!
              .then((rows) =>
                readApplicationConsultationSummary(rawState, rows),
              )
              .catch((error) => {
                console.error(
                  'Failed to read application consultation summary',
                  error instanceof Error ? error.name : 'unknown',
                );
                return null;
              }),
            readDuplicateRequestSummary().catch((error) => {
              console.error(
                'Failed to read duplicate-request summary',
                error instanceof Error ? error.name : 'unknown',
              );
              return null;
            }),
            flowMetricRows!
              .then((rows) =>
                readJointAnalysisConfirmationSummary(rawState, rows),
              )
              .catch((error) => {
                console.error(
                  'Failed to read joint-analysis confirmation summary',
                  error instanceof Error ? error.name : 'unknown',
                );
                return null;
              }),
            flowMetricRows!
              .then((rows) => readDocumentReviewWaitSummary(rawState, rows))
              .catch((error) => {
                console.error(
                  'Failed to read document-review wait summary',
                  error instanceof Error ? error.name : 'unknown',
                );
                return null;
              }),
            Promise.resolve()
              .then(() => readSupportRequestSummary(rawState))
              .catch((error) => {
                console.error(
                  'Failed to read support-request summary',
                  error instanceof Error ? error.name : 'unknown',
                );
                return null;
              }),
            Promise.resolve()
              .then(() => readPipelineDropoffSummary(state))
              .catch((error) => {
                console.error(
                  'Failed to read pipeline dropoff summary',
                  error instanceof Error ? error.name : 'unknown',
                );
                return null;
              }),
          ])
        : [null, null, null, null, null, null, null, null];
    return privateJson({
      state: responseState,
      currentUser,
      stateRevision: await portalRevision(rawState),
      ...(currentUser.role === 'admin'
        ? {
            storage: portalStorageTelemetry({
              payload: snapshot.payload,
              state: rawState,
              expectedUserId: currentUser.id,
            }),
            saveConflicts,
            passwordLinks,
            applicationFunnel,
            duplicateRequests,
            jointAnalysisConfirmation,
            documentReviewWait,
            supportRequests,
            pipelineDropoff,
          }
        : {}),
    });
  } catch (error) {
    const accessResponse = accessErrorResponse(error, request);
    if (accessResponse) return accessResponse;
    console.error(
      'Failed to read portal state',
      error instanceof Error ? error.name : 'unknown',
    );
    return privateJson(
      { error: '저장된 운영 데이터를 불러오지 못했습니다.' },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  let conflictActorRole: PortalConflictActorRole = 'unauthenticated';
  const presentedReceipt = portalConflictReceiptFromRequest(request);
  try {
    assertSameOrigin(request);
    const currentUser = await requirePortalUser(
      request,
      await readPortalState(),
    );
    conflictActorRole = currentUser.role === 'admin' ? 'admin' : 'partner';
    const body = (await readBoundedJsonObject(
      request,
      PORTAL_STATE_LIMIT_BYTES,
    )) as {
      state?: unknown;
      expectedUserId?: unknown;
    } | null;
    if (
      !body?.state ||
      typeof body.state !== 'object' ||
      Array.isArray(body.state)
    ) {
      return privateJson(
        { error: '저장할 운영 데이터 형식이 올바르지 않습니다.' },
        { status: 400 },
      );
    }
    const expectedRevision = readIfMatchRevision(request);

    let draftGuard: PortalDraftGuard | null = null;
    let passwordAccessRevocation = {
      sessionMemberIds: [] as string[],
      setupLinkMemberIds: [] as string[],
      credentialMemberIds: [] as string[],
      chatGPTBindingMemberIds: [] as string[],
    };
    const result = await mutatePortalState(
      async (currentState) => {
        const currentUser = await requirePortalUser(request, currentState);
        const revision = await portalRevision(currentState);
        if (
          body.expectedUserId !== undefined &&
          body.expectedUserId !== currentUser.id
        )
          throw new PortalAccessError(
            '로그인 계정이 변경되었습니다. 작성하던 계정으로 다시 로그인한 후 저장해 주세요.',
            403,
          );
        const currentProjectedState =
          await stateWithConsultingFlows(currentState);
        const merged = preserveApplicationDetails(
          currentState,
          mergeStateForPortalUser(
            currentProjectedState,
            body.state,
            currentUser,
          ),
        ) as Record<string, unknown>;
        draftGuard = await assertNewDraftCases(
          currentState,
          merged,
          currentUser,
        );
        const applicationProtected = protectApplicationSubmissionTimes(
          currentState,
          merged,
          draftGuard ? draftCaseId(draftGuard.draftId) : null,
        );
        const supportProtected = protectSupportRequestTracking(
          currentState,
          applicationProtected,
          currentUser.role === 'admin' ? 'admin' : 'partner',
        );
        if (
          currentUser.role === 'admin' &&
          (await passwordCredentialEmailConflictForStateChange(
            currentState,
            supportProtected,
          ))
        )
          throw new FlowError(passwordCredentialEmailConflictMessage, 409);
        const memberChange =
          currentUser.role === 'admin' &&
          !sameMemberRecords(
            (currentState as Record<string, unknown> | null)?.members,
            supportProtected.members,
          );
        passwordAccessRevocation =
          currentUser.role === 'admin'
            ? passwordAccessRevocationForStateChange(
                currentState,
                supportProtected,
              )
            : {
                sessionMemberIds: [],
                setupLinkMemberIds: [],
                credentialMemberIds: [],
                chatGPTBindingMemberIds: [],
              };
        if (
          memberChange &&
          membersRevisionOf(body.state) !== membersRevisionOf(currentState)
        ) {
          throw new PortalStateConflict(
            '다른 창에서 파트너 명단을 변경했습니다. 저장되지 않은 내용을 확인하고 새로고침 후 다시 수정해 주세요.',
            'member_revision',
          );
        }
        const membersRevision =
          membersRevisionOf(currentState) + (memberChange ? 1 : 0);
        const projectedMerged = await stateWithConsultingFlows({
          ...supportProtected,
          membersRevision,
        });
        const next = protectPipelineLifecycle(
          currentProjectedState,
          projectedMerged as Record<string, unknown>,
          currentUser.role === 'admin' ? 'admin' : 'partner',
        );
        await assertRecoveryProofUnchanged(currentState, next);
        if (expectedRevision !== revision) {
          // An uncertain response may be retried only when it makes no changes.
          if ((await portalRevision(next)) === revision) return currentState;
          throw new PortalStateConflict(
            '다른 창에서 운영 데이터를 변경했거나 화면이 업데이트되었습니다. 현재 입력은 그대로 두고 최신 내용을 확인해 주세요. 신청서는 임시저장한 뒤 새로고침할 수 있습니다.',
            'state_revision',
          );
        }
        return next;
      },
      () => draftGuard,
      (db, committedPayload) =>
        passwordAccessRevocationStatements(
          db,
          passwordAccessRevocation,
          committedPayload,
        ),
    );
    schedulePortalConflictRecovery({
      token: presentedReceipt,
      source: 'state_save',
      actorRole: conflictActorRole,
    });
    return privateJson({
      ok: true,
      updatedAt: result.updatedAt,
      membersRevision: membersRevisionOf(result.state),
      stateRevision: await portalRevision(result.state),
      ...(currentUser.role === 'admin'
        ? {
            storage: portalStorageTelemetry({
              payload: JSON.stringify(result.state),
              state: result.state,
              expectedUserId: currentUser.id,
            }),
          }
        : {}),
    });
  } catch (error) {
    const accessResponse = accessErrorResponse(error, request);
    if (accessResponse) return accessResponse;
    if (error instanceof PortalStateConflict) {
      const metric = {
        source: 'state_save',
        kind: error.kind,
        actorRole: conflictActorRole,
      } as const;
      schedulePortalSaveConflict(metric);
      const recoveryReceipt = await issuePortalConflictReceipt(metric).catch(
        (receiptError) => {
          console.error(
            'Failed to issue portal conflict receipt',
            receiptError instanceof Error ? receiptError.name : 'unknown',
          );
          return null;
        },
      );
      return privateJson(
        {
          error: error.message,
          ...(recoveryReceipt
            ? {
                recoveryReceipt,
                recoveryReceiptExpiresInSeconds:
                  PORTAL_CONFLICT_RECEIPT_TTL_SECONDS,
              }
            : {}),
        },
        { status: 409 },
      );
    }
    if (error instanceof ApplicationDetailsError)
      return privateJson({ error: error.message }, { status: 400 });
    if (error instanceof SupportRequestError)
      return privateJson({ error: error.message }, { status: 400 });
    if (error instanceof PipelineLifecycleError)
      return privateJson({ error: error.message }, { status: 400 });
    if (error instanceof JsonRequestError)
      return privateJson({ error: error.message }, { status: error.status });
    if (error instanceof HeaderRequestError)
      return privateJson({ error: error.message }, { status: error.status });
    if (error instanceof FlowError)
      return privateJson({ error: error.message }, { status: error.status });
    if (error instanceof SyntaxError)
      return privateJson(
        { error: '저장 요청 형식이 올바르지 않습니다.' },
        { status: 400 },
      );
    console.error(
      'Failed to write portal state',
      error instanceof Error ? error.name : 'unknown',
    );
    return privateJson(
      { error: '운영 데이터를 저장하지 못했습니다.' },
      { status: 500 },
    );
  }
}
