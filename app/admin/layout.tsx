import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/server-auth';
import { DashboardShell } from '@/components/layout/dashboard-shell';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, role, response } = await requireAdmin();
  if (!user) redirect('/login');
  if (response || role !== 'admin') redirect('/accounts');
  return <DashboardShell user={{ email: user.email || '管理员', role }}>{children}</DashboardShell>;
}
