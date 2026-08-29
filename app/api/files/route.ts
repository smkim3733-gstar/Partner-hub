import {
  companyFileBucket,
  companyFileCategories,
  companyFileDatabase,
  CompanyFileError,
  ensureCompanyFileTables,
  mayUploadCompanyFiles,
  safeFileName,
} from '@/lib/company-files';
import { PortalAccessError, requirePortalUser } from '@/lib/portal-auth';
import { readPortalState } from '@/lib/portal-state';

export const dynamic = 'force-dynamic';

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const allowedExtensions = new Set([
  'pdf', 'jpg', 'jpeg', 'png', 'xlsx', 'xls', 'docx', 'txt', 'mp3', 'm4a', 'wav',
]);

function field(form: FormData, key: string, maxLength: number) {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function categoryField(form: FormData) {
  const value = field(form, 'category', 40);
  return companyFileCategories.find((category) => category === value) ?? null;
}

function errorResponse(error: unknown) {
  if (error instanceof PortalAccessError || error instanceof CompanyFileError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return null;
}

function checkSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    throw new CompanyFileError('허용되지 않은 업로드 요청입니다.', 403);
  }
}

export async function POST(request: Request) {
  let storedKey = '';
  try {
    checkSameOrigin(request);
    const state = await readPortalState();
    const currentUser = requirePortalUser(request, state);
    if (!mayUploadCompanyFiles(currentUser)) {
      throw new CompanyFileError('현재 계정에는 기업자료 업로드 권한이 없습니다.', 403);
    }

    const form = await request.formData();
    if (field(form, 'consent', 20) !== 'confirmed') {
      throw new CompanyFileError('기업자료 제출 권한과 개인정보 마스킹 여부를 확인해 주세요.', 400);
    }

    const fileValue = form.get('file');
    if (!(fileValue instanceof File) || fileValue.size === 0) {
      throw new CompanyFileError('업로드할 파일을 선택해 주세요.', 400);
    }
    if (fileValue.size > MAX_FILE_SIZE) {
      throw new CompanyFileError('파일 한 개의 크기는 25MB 이하여야 합니다.', 413);
    }

    const originalName = safeFileName(fileValue.name);
    const extension = originalName.split('.').pop()?.toLowerCase() ?? '';
    if (!originalName || !allowedExtensions.has(extension)) {
      throw new CompanyFileError('PDF·이미지·엑셀·워드·텍스트·녹취 파일만 등록할 수 있습니다.', 400);
    }

    const company = field(form, 'company', 100);
    const title = field(form, 'title', 150);
    const category = categoryField(form);
    if (!company || !title || !category) {
      throw new CompanyFileError('기업명·자료명·자료종류를 모두 확인해 주세요.', 400);
    }

    const requestedAssignee = field(form, 'assignedTrainee', 80);
    const assignedTrainee = currentUser.role === 'admin'
      ? requestedAssignee || '김성민 대표'
      : currentUser.memberName ?? currentUser.displayName;
    const id = crypto.randomUUID();
    storedKey = `company-source/${id}`;
    const createdAt = new Date().toISOString();
    const contentType = fileValue.type || 'application/octet-stream';
    const bucket = companyFileBucket();
    const db = companyFileDatabase();
    await ensureCompanyFileTables(db);

    await bucket.put(storedKey, await fileValue.arrayBuffer(), {
      httpMetadata: { contentType },
      customMetadata: { fileId: id },
    });

    try {
      await db
        .prepare(`
          INSERT INTO company_file_objects (
            id, storage_key, original_name, company, category, title,
            assigned_trainee, uploaded_by_user_id, uploaded_by_email,
            content_type, size_bytes, created_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
        `)
        .bind(
          id,
          storedKey,
          originalName,
          company,
          category,
          title,
          assignedTrainee,
          currentUser.id,
          currentUser.email,
          contentType,
          fileValue.size,
          createdAt,
        )
        .run();
    } catch (error) {
      await bucket.delete(storedKey);
      storedKey = '';
      throw error;
    }

    return Response.json({
      file: {
        id,
        fileName: originalName,
        sizeBytes: fileValue.size,
        contentType,
        createdAt,
        assignedTrainee,
      },
    }, { status: 201 });
  } catch (error) {
    const response = errorResponse(error);
    if (response) return response;
    console.error('Failed to upload company file', { storedKey, error });
    return Response.json({ error: '기업자료를 보안 저장소에 등록하지 못했습니다.' }, { status: 500 });
  }
}
