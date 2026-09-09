import { redirect } from 'next/navigation';

type SearchParams = {
  return_to?: string;
};

function normalizeReturnPath(value: string | undefined): string {
  if (!value) return '/';
  if (value.startsWith('//') || value.includes('://')) return '/';
  if (!value.startsWith('/')) return '/';
  return value;
}

export default function SignInWithChatGPTPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  redirect(normalizeReturnPath(searchParams.return_to));
}
