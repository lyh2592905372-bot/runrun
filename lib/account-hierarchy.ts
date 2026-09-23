import type { SupabaseClient } from '@supabase/supabase-js';

export type AccountHierarchy = {
  category_id: string;
  school_id: string;
  running_type_id?: string | null;
  face_option_id?: string | null;
};

export async function validateAccountHierarchy(supabase: SupabaseClient, values: AccountHierarchy) {
  const { data: school, error: schoolError } = await supabase
    .from('schools')
    .select('id')
    .eq('id', values.school_id)
    .maybeSingle();
  if (schoolError || !school) {
    return '所选学校不存在';
  }

  if (!values.running_type_id) {
    return values.face_option_id ? '选择是否人脸前请先选择跑步类型' : null;
  }

  const { data: runningType, error: runningTypeError } = await supabase
    .from('running_types')
    .select('id')
    .eq('id', values.running_type_id)
    .maybeSingle();
  if (runningTypeError || !runningType) {
    return '所选跑步类型不存在';
  }

  if (!values.face_option_id) return null;

  const { data: faceOption, error: faceOptionError } = await supabase
    .from('face_options')
    .select('running_type_id')
    .eq('id', values.face_option_id)
    .maybeSingle();
  if (faceOptionError || !faceOption || faceOption.running_type_id !== values.running_type_id) {
    return '所选人脸类型不属于当前跑步类型';
  }

  return null;
}
