import { postCompanyFile } from '@/lib/company-file-post';

export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return postCompanyFile(request);
}
