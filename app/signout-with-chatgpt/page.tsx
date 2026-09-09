import { redirect } from 'next/navigation';

type SearchParams = {
  return_to?: string;
};

function normalizeReturnPath(value: string | undefined): string {
  if (!value) return '/account';
  if (value.startsWith('//') || value.includes('://')) return '/account';
  if (!value.startsWith('/')) return '/account';
  return value;
}

export default function SignOutWithChatGPTPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  redirect(normalizeReturnPath(searchParams.return_to));
}
