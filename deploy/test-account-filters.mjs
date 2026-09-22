import assert from 'node:assert/strict';
import {
  accountMatchesFilters,
  faceOptionsForSelection,
  runningTypesForSelection,
  schoolsForCategory,
} from '../lib/account-filters.ts';

const schools = [
  { id: 'school-a', category_id: 'category-a', name: '南通大学' },
  { id: 'school-b', category_id: 'category-b', name: '测试大学' },
];
const runningTypes = [
  { id: 'type-a', school_id: 'school-a', name: '操场跑' },
  { id: 'type-b', school_id: 'school-b', name: '自由跑' },
];
const faceOptions = [
  { id: 'face-a', running_type_id: 'type-a', name: '需要人脸' },
  { id: 'face-b', running_type_id: 'type-b', name: '不需要人脸' },
];

const categorySchools = schoolsForCategory(schools, 'category-a');
assert.deepEqual(categorySchools.map((item) => item.id), ['school-a']);
assert.deepEqual(runningTypesForSelection(runningTypes, categorySchools, 'category-a', '').map((item) => item.id), ['type-a']);
assert.deepEqual(runningTypesForSelection(runningTypes, schools, '', 'school-b').map((item) => item.id), ['type-b']);
assert.deepEqual(faceOptionsForSelection(faceOptions, [runningTypes[0]], 'category-a', 'school-a', '').map((item) => item.id), ['face-a']);
assert.deepEqual(faceOptionsForSelection(faceOptions, runningTypes, '', '', 'type-b').map((item) => item.id), ['face-b']);

const account = {
  id: 'account-a', category_id: 'category-a', school_id: 'school-a', running_type_id: 'type-a', face_option_id: 'face-a',
  username: 'runner-001', order_time: '2026-09-20T10:00:00.000Z', school: schools[0],
};
const matching = {
  search: '南通', category: 'category-a', school: 'school-a', runningType: 'type-a', faceOption: 'face-a',
  dateFilter: 'custom', dateFrom: '2026-09-20', dateTo: '2026-09-20',
};
assert.equal(accountMatchesFilters(account, matching, new Date('2026-09-20T12:00:00.000Z')), true);
for (const [key, value] of [
  ['search', '不存在'], ['category', 'category-b'], ['school', 'school-b'], ['runningType', 'type-b'],
  ['faceOption', 'face-b'], ['dateFrom', '2026-09-21'],
]) {
  assert.equal(accountMatchesFilters(account, { ...matching, [key]: value }, new Date('2026-09-20T12:00:00.000Z')), false, `${key} must use AND filtering`);
}

console.log('Account cascade and AND-filter checks passed.');
