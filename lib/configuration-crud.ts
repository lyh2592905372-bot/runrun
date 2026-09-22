import type { SupabaseClient } from '@supabase/supabase-js';

export type ConfigurationTable = 'account_categories' | 'schools' | 'running_types' | 'face_options';

export async function findConfigurationByName(
  supabase: SupabaseClient,
  table: ConfigurationTable,
  name: string,
  parent?: { column: string; id: string },
) {
  let query = supabase.from(table).select('*');
  if (parent) query = query.eq(parent.column, parent.id);
  const { data, error } = await query;
  if (error) throw error;
  return (data as { id: string; name: string; [key: string]: unknown }[] | null)
    ?.find((record) => record.name.trim() === name.trim()) || null;
}

export function configurationError(context: string, error: unknown) {
  if (process.env.NODE_ENV === 'development') console.error(context, error);
}
