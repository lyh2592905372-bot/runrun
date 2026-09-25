import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server-auth';

export async function GET() {
  const { user, role, response } = await requireUser();
  if (response || !user) return response!;
  return NextResponse.json({ user: { id: user.id, email: user.email, role }, home: role === 'admin' ? '/admin' : '/accounts' });
}
