import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/server-auth';
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { response } = await requireAdmin();
  if (response) redirect('/accounts');
  return children;
}
