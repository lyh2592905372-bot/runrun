import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccountInput } from '@/lib/account-input';

type ConfigurationChoice = { id?: string | null; name?: string | null } | null | undefined;
type ConfigurationRecord = { id: string; name: string; [key: string]: unknown };

export class ConfigurationResolutionError extends Error {}

function normalizedName(choice: ConfigurationChoice) {
  return choice?.name?.trim() || '';
}

async function findById(
  supabase: SupabaseClient,
  table: string,
  id: string,
  label: string,
  parentColumn?: string,
  parentId?: string,
) {
  const { data, error } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new ConfigurationResolutionError(`${label}已不存在，请重新选择`);
  if (parentColumn && parentId && data[parentColumn] !== parentId) {
    throw new ConfigurationResolutionError(`${label}不属于当前上级选项`);
  }
  return data as ConfigurationRecord;
}

async function findByName(
  supabase: SupabaseClient,
  table: string,
  name: string,
  parentColumn?: string,
  parentId?: string,
) {
  let query = supabase.from(table).select('*');
  if (parentColumn && parentId) query = query.eq(parentColumn, parentId);
  const { data, error } = await query;
  if (error) throw error;
  return (data as ConfigurationRecord[] | null)?.find((record) => record.name.trim() === name) || null;
}

async function resolveOrCreate(
  supabase: SupabaseClient,
  choice: ConfigurationChoice,
  options: {
    table: string;
    label: string;
    parentColumn?: string;
    parentId?: string;
    insertValues?: Record<string, unknown>;
    globallyUniqueName?: boolean;
  },
) {
  if (choice?.id) {
    return findById(supabase, options.table, choice.id, options.label, options.parentColumn, options.parentId);
  }

  const name = normalizedName(choice);
  if (!name) throw new ConfigurationResolutionError(`${options.label}不能为空`);

  const existing = await findByName(supabase, options.table, name, options.parentColumn, options.parentId);
  if (existing) return existing;

  if (options.globallyUniqueName && options.parentColumn) {
    const globalMatch = await findByName(supabase, options.table, name);
    if (globalMatch) throw new ConfigurationResolutionError(`${options.label}“${name}”已属于其他上级选项`);
  }

  const values = {
    ...(options.insertValues || {}),
    ...(options.parentColumn && options.parentId ? { [options.parentColumn]: options.parentId } : {}),
    name,
  };
  const { data, error } = await supabase.from(options.table).insert(values).select('*').single();
  if (!error && data) return data as ConfigurationRecord;

  if (error?.code === '23505') {
    const raced = await findByName(supabase, options.table, name, options.parentColumn, options.parentId);
    if (raced) return raced;
  }
  throw error || new Error(`创建${options.label}失败`);
}

export async function resolveAccountConfiguration(supabase: SupabaseClient, input: AccountInput) {
  const category = await resolveOrCreate(supabase, input.category, {
    table: 'account_categories',
    label: '账号分类',
    insertValues: { color: '#5b5bd6' },
  });
  const school = await resolveOrCreate(supabase, input.school, {
    table: 'schools',
    label: '学校',
    parentColumn: 'category_id',
    parentId: category.id,
    globallyUniqueName: true,
  });

  let runningType: ConfigurationRecord | null = null;
  if (input.running_type?.id || normalizedName(input.running_type)) {
    runningType = await resolveOrCreate(supabase, input.running_type, {
      table: 'running_types',
      label: '跑步类型',
      parentColumn: 'school_id',
      parentId: school.id,
    });
  }

  let faceOption: ConfigurationRecord | null = null;
  if (input.face_option?.id || normalizedName(input.face_option)) {
    if (!runningType) throw new ConfigurationResolutionError('选择是否人脸前请先填写跑步类型');
    faceOption = await resolveOrCreate(supabase, input.face_option, {
      table: 'face_options',
      label: '是否人脸',
      parentColumn: 'running_type_id',
      parentId: runningType.id,
    });
  }

  return {
    category_id: category.id,
    school_id: school.id,
    running_type_id: runningType?.id || null,
    face_option_id: faceOption?.id || null,
  };
}
