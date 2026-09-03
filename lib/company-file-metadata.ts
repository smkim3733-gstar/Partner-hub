import {
  companyFileCategories,
  type CompanyFileCategory,
} from './company-file-policy';

export const COMPANY_FILE_COMPANY_MAX_LENGTH = 100;
export const COMPANY_FILE_TITLE_MAX_LENGTH = 150;
export const EMPTY_COMPANY_FILE_CATEGORY = '';

export type CompanyFileMetadataInput = {
  company: string;
  title: string;
  category: string;
};

export type PreparedCompanyFileMetadata = {
  company: string;
  title: string;
  category: CompanyFileCategory;
};

export type CompanyFileMetadataResult =
  | { ok: true; value: PreparedCompanyFileMetadata }
  | { ok: false; error: string };

export function prepareCompanyFileMetadata(
  input: CompanyFileMetadataInput,
): CompanyFileMetadataResult {
  const company = input.company.trim();
  if (!company) return { ok: false, error: '기업명을 입력해 주세요.' };
  if (company.length > COMPANY_FILE_COMPANY_MAX_LENGTH)
    return {
      ok: false,
      error: `기업명은 ${COMPANY_FILE_COMPANY_MAX_LENGTH}자 이하로 입력해 주세요.`,
    };

  const title = input.title.trim();
  if (!title) return { ok: false, error: '자료명을 입력해 주세요.' };
  if (title.length > COMPANY_FILE_TITLE_MAX_LENGTH)
    return {
      ok: false,
      error: `자료명은 ${COMPANY_FILE_TITLE_MAX_LENGTH}자 이하로 입력해 주세요.`,
    };

  const category = companyFileCategories.find(
    (candidate) => candidate === input.category,
  );
  if (!category)
    return { ok: false, error: '자료종류를 선택해 주세요.' };

  return { ok: true, value: { company, title, category } };
}
