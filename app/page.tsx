import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/server-auth';
export default async function Home() {
  const { role, response } = await requireUser();
  if (response) redirect('/login');
  redirect(role === 'admin' ? '/admin' : '/accounts');
}
