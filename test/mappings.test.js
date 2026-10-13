import assert from 'assert';
import fs from 'fs';
import { pageKey, mappedValues } from '../src/mappings.js';
import { platformFor } from '../src/rules.js';

assert.equal(pageKey('https://example.com/publish?id=1#field'), 'https://example.com/publish');
assert.equal(pageKey('https://example.com/publish?id=2'), 'https://example.com/publish');
assert.notEqual(pageKey('https://example.com/publish'), pageKey('https://example.com/settings'));
assert.notEqual(pageKey('https://a.example.com/publish'), pageKey('https://b.example.com/publish'));
assert.equal(pageKey('https://example.com/#/editor?id=2'), 'https://example.com/#/editor');
assert.notEqual(pageKey('https://example.com/#/editor'), pageKey('https://example.com/#/settings'));
assert.throws(() => pageKey('chrome://extensions'));
assert.equal(platformFor('https://evil.example/?weibo.com'), 'unknown');
assert.equal(platformFor('https://weibo.com.evil.example'), 'unknown');
assert.deepEqual(mappedValues({ title: '主题', topics: ['甲', '乙'] }, { title: {}, topics: {}, password: {} }).map(x => x.value), ['主题', '甲 乙']);
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
assert.equal(manifest.manifest_version, 3);
for (const path of [manifest.background.service_worker, manifest.side_panel.default_path, ...manifest.content_scripts.flatMap(x => x.js)]) {
  assert.ok(fs.existsSync(new URL('../' + path, import.meta.url)), `Missing ${path}`);
}
console.log('mapping scope, field conversion and manifest ok');
