import type { SupabaseClient } from '@supabase/supabase-js';

export type ConfigurationTable = 'account_categories' | 'schools' | 'running_types' | 'face_options';

export function normalizedConfigurationName(name: string) {
  return name.trim();
}

export function deduplicateConfigurationsByName<T extends { name: string }>(
  records: T[],
  parentColumn?: keyof T,
) {
  const unique = new Map<string, T>();
  for (const record of records) {
    const key = normalizedConfigurationName(record.name);
    const current = unique.get(key);
    if (!current || (parentColumn && current[parentColumn] != null && record[parentColumn] == null)) {
      unique.set(key, record);
    }
  }
  return Array.from(unique.values());
}

export async function findConfigurationsByName(
  supabase: SupabaseClient,
  table: ConfigurationTable,
  name: string,
  parent?: { column: string; id: string },
) {
  let query = supabase.from(table).select('*');
  if (parent) query = query.eq(parent.column, parent.id);
  const { data, error } = await query;
  if (error) throw error;
  const normalizedName = normalizedConfigurationName(name);
  return (data as { id: string; name: string; [key: string]: unknown }[] | null)
    ?.filter((record) => normalizedConfigurationName(record.name) === normalizedName) || [];
}

export async function findConfigurationByName(
  supabase: SupabaseClient,
  table: ConfigurationTable,
  name: string,
  parent?: { column: string; id: string },
) {
  return (await findConfigurationsByName(supabase, table, name, parent))[0] || null;
}

export function configurationError(context: string, error: unknown) {
  if (process.env.NODE_ENV === 'development') console.error(context, error);
}
