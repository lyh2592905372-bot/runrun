import { z } from 'zod';

const configurationId = z.preprocess(
  (value) => value === '' ? null : value,
  z.string().uuid().nullable().optional(),
);

const requiredConfiguration = z.object({
  id: configurationId,
  name: z.string().trim().max(120).default(''),
}).refine((value) => Boolean(value.id || value.name), { message: '配置项不能为空' });

const optionalConfiguration = z.object({
  id: configurationId,
  name: z.string().trim().max(120).default(''),
}).nullable().optional();

export const accountInputSchema = z.object({
  category: requiredConfiguration,
  school: requiredConfiguration,
  running_type: optionalConfiguration,
  face_option: optionalConfiguration,
  username: z.string().trim().max(200).default(''),
  password: z.string().optional().default(''),
  sport_account: z.string().trim().max(200).optional().default(''),
  sport_password: z.string().max(500).optional().default(''),
  distance_per_run: z.coerce.number().positive(),
  order_count: z.coerce.number().int().positive(),
  order_time: z.string(),
  running_time: z.preprocess((value) => value === '' ? null : value, z.string().nullable().optional()),
  campus_name: z.string().trim().max(200).optional().default(''),
  fence_name: z.string().trim().max(200).optional().default(''),
  student_name: z.string().trim().max(200).optional().default(''),
  student_id: z.string().trim().max(200).optional().default(''),
  note: z.string().max(1000).optional().default(''),
});

export type AccountInput = z.infer<typeof accountInputSchema>;

export function accountFieldsFromInput(input: AccountInput) {
  return {
    distance_per_run: input.distance_per_run,
    order_count: input.order_count,
    order_time: input.order_time,
    running_time: input.running_time,
    campus_name: input.campus_name,
    fence_name: input.fence_name,
    student_name: input.student_name,
    student_id: input.student_id,
    note: input.note,
  };
}
