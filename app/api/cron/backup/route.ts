import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = createAdminClient();
  const { data: setting } = await supabase.from('backup_settings').select('*').eq('id', true).maybeSingle();
  if (setting && !setting.auto_enabled) return NextResponse.json({ ok: true, skipped: 'auto_backup_disabled' });
  if (setting?.next_run_at && new Date(setting.next_run_at).getTime() > Date.now()) return NextResponse.json({ ok: true, skipped: 'not_due' });

  const [accounts, schools, categories, runningTypes, faceOptions, progress, settings, logs] = await Promise.all([
    supabase.from('accounts').select('*').is('deleted_at', null), supabase.from('schools').select('*'), supabase.from('account_categories').select('*'), supabase.from('running_types').select('*'), supabase.from('face_options').select('*'), supabase.from('progress').select('*'), supabase.from('backup_settings').select('*'), supabase.from('operation_logs').select('*').limit(5000),
  ]);
  const snapshot = { version: 2, created_at: new Date().toISOString(), accounts: accounts.data || [], schools: schools.data || [], categories: categories.data || [], running_types: runningTypes.data || [], face_options: faceOptions.data || [], progress: progress.data || [], backup_settings: settings.data || [], operation_logs: logs.data || [] };
  const path = `system/${Date.now()}.json`;
  const content = JSON.stringify(snapshot);
  const { error: uploadError } = await supabase.storage.from('backups').upload(path, content, { contentType: 'application/json', upsert: false });
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });
  const { error } = await supabase.from('backups').insert({ file_path: path, size_bytes: Buffer.byteLength(content) });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (setting) {
    let nextRun: string | null = null;
    let autoEnabled = setting.auto_enabled;
    const base = setting.next_run_at ? new Date(setting.next_run_at) : new Date();
    if (setting.frequency === 'daily') { base.setDate(base.getDate() + 1); nextRun = base.toISOString(); }
    else if (setting.frequency === 'weekly') { base.setDate(base.getDate() + 7); nextRun = base.toISOString(); }
    else autoEnabled = false;
    await supabase.from('backup_settings').update({ auto_enabled: autoEnabled, next_run_at: nextRun, last_run_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', true);
  }
  return NextResponse.json({ ok: true, path });
}
