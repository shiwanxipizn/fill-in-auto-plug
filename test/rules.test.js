import assert from 'assert'; import { platformFor, makeDraft, validate } from '../src/rules.js';
assert.equal(platformFor('https://weibo.com/u/1'), 'weibo'); assert.equal(platformFor('https://baijiahao.baidu.com/builder'), 'baijiahao');
assert.equal(makeDraft({ title: 'a'.repeat(40), topics: ['x','y','z','q'] }, 'baijiahao').title.length, 30);
assert.deepEqual(makeDraft({ title: '车', topics: ['新能源'] }, 'weibo').topics, ['#新能源#']); assert.deepEqual(validate({}, 'weibo'), ['标题不能为空']); console.log('rules ok');
