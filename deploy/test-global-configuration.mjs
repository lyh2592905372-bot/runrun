import assert from 'node:assert/strict';
import { accountInputSchema } from '../lib/account-input.ts';
import { deduplicateConfigurationsByName } from '../lib/configuration-crud.ts';

const schools = deduplicateConfigurationsByName([
  { id: 'legacy-school', category_id: 'category-a', name: '南通大学' },
  { id: 'global-school', category_id: null, name: '南通大学' },
  { id: 'other-school', category_id: 'category-b', name: '山东师范大学' },
], 'category_id');

assert.deepEqual(schools.map((item) => item.id), ['global-school', 'other-school']);

const runningTypes = deduplicateConfigurationsByName([
  { id: 'type-a', school_id: 'school-a', name: '非晨跑' },
  { id: 'type-b', school_id: 'school-b', name: '非晨跑' },
  { id: 'type-global', school_id: null, name: '操场跑' },
], 'school_id');

assert.deepEqual(runningTypes.map((item) => item.id), ['type-a', 'type-global']);

const parsed = accountInputSchema.safeParse({
  category: { id: null, name: '支付宝阳光跑' },
  school: { id: null, name: '南通大学' },
  running_type: { id: null, name: '非晨跑' },
  face_option: null,
  username: '',
  password: '',
  distance_per_run: 2,
  order_count: 10,
  order_time: '2026-09-23T12:00:00.000Z',
});

assert.equal(parsed.success, true, '支付宝阳光跑输入应允许账号和密码为空');
console.log('Global configuration compatibility checks passed.');
