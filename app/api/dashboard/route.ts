import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server-auth';

export async function GET() {
  const { supabase, response } = await requireUser(); if (response) return response;
  const [{ data: accounts, error }, { count: schools }] = await Promise.all([
    supabase.from('accounts').select('order_count,distance_per_run,progress(completed_runs)').is('deleted_at', null),
    supabase.from('schools').select('id', { count: 'exact', head: true })
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = accounts || []; const stats = rows.reduce((a, row) => { const completed = Array.isArray(row.progress) ? row.progress[0]?.completed_runs || 0 : (row.progress as { completed_runs?: number } | null)?.completed_runs || 0; a.orders += row.order_count || 0; a.totalDistance += (row.order_count || 0) * (row.distance_per_run || 0); a.completedRuns += completed; a.remainingRuns += Math.max(0, (row.order_count || 0) - completed); return a; }, { orders: 0, totalDistance: 0, completedRuns: 0, remainingRuns: 0 });
  return NextResponse.json({ stats: { accounts: rows.length, schools: schools || 0, ...stats } });
}
