import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

let context, worker, site, panel, profile;
const origin = 'https://weibo.com';
const key = origin + '/mapping-demo';
const fixture = await fs.readFile(new URL('./fixture.html', import.meta.url), 'utf8');
test.beforeAll(async () => {
  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-fill-test-'));
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${process.cwd()}`, `--load-extension=${process.cwd()}`]
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await context.route('https://weibo.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  await context.route('https://tv.sohu.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
});
test.afterAll(async () => {
  await context?.close();
  if (profile) await fs.rm(profile, { recursive: true, force: true });
});
test.beforeEach(async () => {
  await worker.evaluate(() => chrome.storage.local.clear());
  site = await context.newPage();
  await site.goto(key);
  panel = await context.newPage();
  await panel.goto(`chrome-extension://${new URL(worker.url()).hostname}/src/sidebar.html`);
  await site.bringToFront();
  await expect(panel.locator('#platform')).toContainText('weibo.com');
});
test.afterEach(async () => { await panel.close(); await site.close(); });

async function bind(field, selector) {
  await panel.locator('#field').selectOption(field);
  await panel.locator('#pick').click();
  await expect(panel.locator('#status')).toContainText('请在网页上点击');
  await site.locator(selector).click();
  await expect(panel.locator('#bindings')).toContainText(selector === '#subject' ? '主题' : '←');
  await expect.poll(async () => worker.evaluate(({ key, field }) => chrome.storage.local.get('mappings').then(x => !!x.mappings?.[key]?.fields[field]), { key: new URL(site.url()).origin + new URL(site.url()).pathname, field })).toBe(true);
}
async function raw(message) {
  return worker.evaluate(async message => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return chrome.tabs.sendMessage(tab.id, message, { frameId: 0 });
  }, message);
}
async function binding() { return worker.evaluate(key => chrome.storage.local.get('mappings').then(x => x.mappings[key].fields.title), key); }

test('真实扩展：点选、保存、刷新恢复、一键填写和删除', async () => {
  await bind('title', '#subject'); await bind('description', '#body'); await bind('topics', '#keywords');
  await panel.locator('#title').fill('新能源汽车试驾');
  await panel.locator('#description').fill('第一行\n第二行');
  await panel.locator('#topics').fill('新能源 试驾');
  await panel.locator('#save').click();
  await panel.reload(); await site.bringToFront();
  await expect(panel.locator('#title')).toHaveValue('新能源汽车试驾');
  await site.reload();
  await expect(panel.locator('#platform')).toContainText('3 个');
  await panel.locator('#fill').click();
  await expect(panel.locator('#status')).toContainText('标题：已填写');
  await expect(site.locator('#subject')).toHaveValue('新能源汽车试驾');
  await expect(site.locator('#body')).toHaveValue('第一行\n第二行');
  await expect(site.locator('#keywords')).toHaveValue('新能源 试驾');
  expect(await site.evaluate(() => window.events)).toEqual(expect.arrayContaining(['subject:input', 'subject:change', 'subject:blur']));
  expect(await site.evaluate(() => window.submitCount)).toBe(0);
  await panel.screenshot({ path: 'test-results/sidebar.png', fullPage: true });
  await panel.locator('#bindings .remove').first().click();
  await expect(panel.locator('#platform')).toContainText('2 个');
});

test('不同路径、域名隔离；查询参数复用规则', async () => {
  await bind('title', '#subject');
  await site.goto(key + '?draft=123');
  await expect(panel.locator('#platform')).toContainText('1 个');
  await site.goto(origin + '/other');
  await expect(panel.locator('#platform')).toContainText('0 个');
  await site.goto('https://tv.sohu.com/mapping-demo');
  await expect(panel.locator('#platform')).toContainText('0 个');
  await site.goto(key); await expect(panel.locator('#platform')).toContainText('1 个');
});

test('点选不触发提交，Esc 退出，密码框不能绑定', async () => {
  await panel.locator('#pick').click();
  await expect(panel.locator('#status')).toContainText('请在网页');
  await site.locator('#submit').click();
  expect(await site.evaluate(() => window.submitCount)).toBe(0);
  await site.locator('#secret').click();
  expect(await worker.evaluate(() => chrome.storage.local.get('mappings'))).toEqual({});
  await site.keyboard.press('Escape');
  await site.locator('#subject').fill('手动编辑');
  await expect(site.locator('#subject')).toHaveValue('手动编辑');
});

test('重复注入不重复注册，属性变化拒绝填写', async () => {
  await bind('title', '#subject');
  await panel.locator('#pick').click(); await panel.locator('#cancel').click();
  await site.locator('#subject').evaluate(el => el.setAttribute('placeholder', '新用途'));
  await panel.locator('#title').fill('测试');
  await panel.locator('#fill').click();
  await expect(panel.locator('#status')).toContainText('属性已变化');
  await expect(site.locator('#subject')).toHaveValue('');
});

test('空字段跳过、超长拒绝、重复匹配拒绝', async () => {
  await bind('title', '#subject');
  await site.locator('#subject').fill('已有内容');
  await panel.locator('#fill').click();
  await expect(panel.locator('#status')).toContainText('内容为空，跳过');
  await expect(site.locator('#subject')).toHaveValue('已有内容');
  await panel.locator('#title').fill('长'.repeat(81)); await panel.locator('#fill').click();
  await expect(panel.locator('#status')).toContainText('超过页面 80 字限制');
  await site.locator('#subject').evaluate(el => el.after(el.cloneNode()));
  await panel.locator('#title').fill('测试'); await panel.locator('#fill').click();
  await expect(panel.locator('#status')).toContainText('多个元素');
});

test('可编辑区域填写，异步渲染等待，失效规则明确报错', async () => {
  await bind('description', '#rich');
  await panel.locator('#description').fill('可编辑区域正文');
  await panel.locator('#fill').click();
  await expect(site.locator('#rich')).toHaveText('可编辑区域正文');
  await bind('title', '#subject');
  const b = await binding();
  await site.locator('#subject').evaluate(el => { el.remove(); setTimeout(() => document.body.append(el), 500); });
  const response = await raw({ type: 'fill-mappings', pageKey: key, values: [{ label: '标题', binding: b, value: '异步填写' }] });
  expect(response.results).toContain('标题：已填写');
  await site.locator('#subject').evaluate(el => el.remove());
  const missing = await raw({ type: 'fill-mappings', pageKey: key, values: [{ label: '标题', binding: b, value: '测试' }] });
  expect(missing.results[0]).toContain('仍未找到元素');
});

test('绑定无稳定属性的元素，错误页面消息被拒绝', async () => {
  await site.evaluate(() => { const el = document.createElement('textarea'); document.body.append(el); });
  await bind('title', 'body > textarea');
  await panel.locator('#title').fill('结构定位'); await panel.locator('#fill').click();
  await expect(site.locator('body > textarea')).toHaveValue('结构定位');
  const result = await raw({ type: 'fill-mappings', pageKey: key + '/other', values: [] });
  expect(result.ok).toBe(false); expect(result.error).toContainText;
  expect(result.error).toContain('页面已变化');
});
