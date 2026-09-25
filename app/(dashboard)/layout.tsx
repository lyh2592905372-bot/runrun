import { DashboardShell } from '@/components/layout/dashboard-shell';
import { requireUser } from '@/lib/server-auth';
import { redirect } from 'next/navigation';

export default async function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { user, role, response } = await requireUser();
  if (response || !user || !role) redirect('/login');
  return <DashboardShell user={{ email: user.email || '用户', role }}>{children}</DashboardShell>;
}
