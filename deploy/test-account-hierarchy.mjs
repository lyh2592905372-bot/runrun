import assert from 'node:assert/strict';
import { validateAccountHierarchy } from '../lib/account-hierarchy.ts';

function clientWith(rows) {
  return {
    from(table) {
      return {
        select() { return this; },
        eq(_column, id) { this.id = id; return this; },
        async maybeSingle() {
          return { data: rows[table]?.[this.id] || null, error: null };
        },
      };
    },
  };
}

const client = clientWith({
  schools: {
    'school-a': { category_id: 'category-a' },
    'school-b': { category_id: 'category-b' },
  },
  running_types: {
    'type-a': { school_id: 'school-a' },
    'type-b': { school_id: 'school-b' },
  },
  face_options: {
    'face-a': { running_type_id: 'type-a' },
    'face-b': { running_type_id: 'type-b' },
  },
});

assert.equal(await validateAccountHierarchy(client, { category_id: 'category-a', school_id: 'school-a', running_type_id: 'type-a', face_option_id: 'face-a' }), null);
assert.equal(await validateAccountHierarchy(client, { category_id: 'category-a', school_id: 'school-b' }), null);
assert.equal(await validateAccountHierarchy(client, { category_id: 'category-a', school_id: 'school-a', running_type_id: 'type-b' }), null);
assert.equal(await validateAccountHierarchy(client, { category_id: 'category-a', school_id: 'school-missing' }), '所选学校不存在');
assert.equal(await validateAccountHierarchy(client, { category_id: 'category-a', school_id: 'school-a', running_type_id: 'type-missing' }), '所选跑步类型不存在');
assert.equal(await validateAccountHierarchy(client, { category_id: 'category-a', school_id: 'school-a', face_option_id: 'face-a' }), '选择是否人脸前请先选择跑步类型');
assert.equal(await validateAccountHierarchy(client, { category_id: 'category-a', school_id: 'school-a', running_type_id: 'type-a', face_option_id: 'face-b' }), '所选人脸类型不属于当前跑步类型');

console.log('Account hierarchy validation checks passed.');
