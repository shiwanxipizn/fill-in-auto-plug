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
    executablePath: process.env.TEST_CHROMIUM_PATH || undefined,
    args: ['--disable-features=DisableLoadExtensionCommandLineSwitch', `--disable-extensions-except=${process.cwd()}`, `--load-extension=${process.cwd()}`]
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await expect.poll(() => worker.evaluate(() => typeof chrome !== 'undefined' && !!chrome.storage?.local)).toBe(true);
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
  await panel.setViewportSize({ width: 390, height: 900 });
  await panel.goto(`chrome-extension://${new URL(worker.url()).hostname}/src/sidebar.html`);
  await site.bringToFront();
  await expect(panel.locator('#platform')).toContainText('weibo.com');
  await expect(panel.locator('#field')).toBeEnabled();
});
test.afterEach(async () => { await panel?.close(); await site?.close(); });

async function bind(field, selector) {
  await panel.locator('#field').selectOption(field);
  await panel.locator('#pick').click();
  await expect(panel.locator('#status')).toContainText('请在网页上点击');
  await site.locator(selector).click();
  await expect(panel.locator('#bindings')).toContainText(selector === '#subject' ? '主题' : '←');
  await expect.poll(async () => worker.evaluate(({ key, field }) => chrome.storage.local.get('mappings').then(x => !!x.mappings?.[key]?.fields[field]), { key: new URL(site.url()).origin + new URL(site.url()).pathname, field })).toBe(true);
  await expect(panel.locator(`#value-${field}`)).toBeVisible();
}
async function raw(message) {
  return worker.evaluate(async message => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return chrome.tabs.sendMessage(tab.id, message, { frameId: 0 });
  }, message);
}
async function binding() { return worker.evaluate(key => chrome.storage.local.get('mappings').then(x => x.mappings[key].fields.title), key); }

async function edit(field, value) {
  await panel.locator(`#value-${field}`).fill(value);
}

test('真实扩展：点选、保存、刷新恢复、一键填写和删除', async () => {
  await expect(panel.locator('#content-fields textarea')).toHaveCount(0);
  await expect(panel.locator('#fill')).toBeDisabled();
  await panel.locator('#field').selectOption('description');
  await expect(panel.locator('#content-fields textarea')).toHaveCount(0);
  await bind('title', '#subject');
  await expect(panel.locator('#content-fields textarea')).toHaveCount(1);
  await edit('title', '新能源汽车试驾');
  await bind('description', '#body');
  await expect(panel.locator('#content-fields textarea')).toHaveCount(2);
  await expect(panel.locator('#value-title')).toHaveValue('新能源汽车试驾');
  await bind('topics', '#keywords');
  await expect(panel.locator('#content-fields textarea')).toHaveCount(3);
  await edit('title', '新能源汽车试驾');
  await edit('description', '第一行\n第二行');
  await edit('topics', '新能源 试驾');
  await expect(panel.locator('#save-state')).toContainText('内容已保存');
  await panel.reload(); await site.bringToFront();
  await expect(panel.locator('#value-title')).toHaveValue('新能源汽车试驾');
  await expect(panel.locator('#value-description')).toHaveValue('第一行\n第二行');
  await expect(panel.locator('#content-fields textarea')).toHaveCount(3);
  await site.reload();
  await expect(panel.locator('#platform')).toContainText('3 个');
  await panel.locator('#fill').click();
  await expect(panel.locator('#status')).toContainText('已填写 3 项');
  await expect(site.locator('#subject')).toHaveValue('新能源汽车试驾');
  await expect(site.locator('#body')).toHaveValue('第一行\n第二行');
  await expect(site.locator('#keywords')).toHaveValue('新能源 试驾');
  expect(await site.evaluate(() => window.events)).toEqual(expect.arrayContaining(['subject:input', 'subject:change', 'subject:blur']));
  expect(await site.evaluate(() => window.submitCount)).toBe(0);
  await panel.screenshot({ path: 'test-results/sidebar.png', fullPage: true });
  await panel.setViewportSize({ width: 300, height: 640 });
  expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel.screenshot({ path: 'test-results/sidebar-narrow.png', fullPage: true });
  await panel.locator('#rules > summary').click();
  await panel.locator('#bindings').getByRole('button', { name: '删除标题绑定' }).click();
  await expect(panel.locator('#platform')).toContainText('2 个');
  await expect(panel.locator('#value-title')).toHaveCount(0);
  await expect(panel.locator('#content-fields textarea')).toHaveCount(2);
  await bind('title', '#subject');
  await expect(panel.locator('#value-title')).toHaveValue('新能源汽车试驾');
});

test('不同路径、域名隔离；查询参数复用规则', async () => {
  await bind('title', '#subject');
  await site.goto(key + '?draft=123');
  await expect(panel.locator('#platform')).toContainText('1 个');
  await site.goto(origin + '/other');
  await expect(panel.locator('#platform')).toContainText('0 个');
  await expect(panel.locator('#content-fields textarea')).toHaveCount(0);
  await site.goto('https://tv.sohu.com/mapping-demo');
  await expect(panel.locator('#platform')).toContainText('0 个');
  await site.goto(key); await expect(panel.locator('#platform')).toContainText('1 个');
});

test('点选不触发提交，Esc 退出，密码框不能绑定', async () => {
  await panel.locator('#pick').click();
  await expect(panel.locator('#status')).toContainText('请在网页');
  await site.screenshot({ path: 'test-results/picker-centered.png' });
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
  await edit('title', '保留内容');
  await bind('title', '#subject');
  await expect(panel.locator('#content-fields textarea')).toHaveCount(1);
  await expect(panel.locator('#value-title')).toHaveValue('保留内容');
  await panel.locator('#pick').click(); await panel.locator('#pick').click();
  await site.locator('#subject').evaluate(el => el.setAttribute('placeholder', '新用途'));
  await edit('title', '测试');
  await panel.locator('#fill').click();
  await expect(panel.locator('#error-title')).toContainText('属性已变化');
  await expect(site.locator('#subject')).toHaveValue('');
});

test('空字段跳过、超长拒绝、重复匹配拒绝', async () => {
  await bind('title', '#subject');
  await site.locator('#subject').fill('已有内容');
  await panel.locator('#fill').click();
  await expect(panel.locator('#status')).toContainText('内容为空，已跳过');
  await expect(site.locator('#subject')).toHaveValue('已有内容');
  await edit('title', '长'.repeat(81)); await panel.locator('#fill').click();
  await expect(panel.locator('#error-title')).toContainText('超过页面 80 字限制');
  await expect(panel.locator('#value-title')).toHaveAttribute('aria-invalid', 'true');
  await expect(panel.locator('#value-title')).toHaveCSS('border-top-color', 'rgb(220, 38, 38)');
  await panel.locator('#value-title').focus();
  await expect(panel.locator('#value-title')).toHaveCSS('border-top-color', 'rgb(220, 38, 38)');
  await panel.screenshot({ path: 'test-results/sidebar-error.png', fullPage: true });
  await site.locator('#subject').evaluate(el => el.after(el.cloneNode()));
  await edit('title', '测试');
  await expect(panel.locator('#value-title')).toHaveAttribute('aria-invalid', 'false');
  await panel.locator('#fill').click();
  await expect(panel.locator('#error-title')).toContainText('多个元素');
});

test('可编辑区域填写，异步渲染等待，失效规则明确报错', async () => {
  await bind('description', '#rich');
  await edit('description', '可编辑区域正文');
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
  await edit('title', '结构定位'); await panel.locator('#fill').click();
  await expect(site.locator('body > textarea')).toHaveValue('结构定位');
  const result = await raw({ type: 'fill-mappings', pageKey: key + '/other', values: [] });
  expect(result.ok).toBe(false);
  expect(result.error).toContain('页面已变化');
});

test('字段右侧修改与删除：重新选中目标，取消保留旧规则，删除保留草稿', async () => {
  await bind('title', '#subject');
  await edit('title', '保留这段草稿');
  const original = await binding();
  const fields = panel.locator('#content-fields');
  await panel.locator('#field').selectOption('topics');
  await fields.getByRole('button', { name: '修改标题绑定' }).click();
  await expect(panel.locator('#status')).toContainText('「标题」');
  await site.screenshot({ path: 'test-results/picker-edit-centered.png' });
  await site.keyboard.press('Escape');
  await expect(panel.locator('#pick-label')).toHaveText('绑定元素');
  expect(await binding()).toEqual(original);
  await fields.getByRole('button', { name: '修改标题绑定' }).click();
  await expect(panel.locator('#status')).toContainText('请在网页上点击');
  await site.locator('#body').click();
  await expect.poll(async () => (await binding()).selector).not.toBe(original.selector);
  await expect(fields.locator('textarea')).toHaveCount(1);
  await expect(panel.locator('#value-title')).toHaveValue('保留这段草稿');
  await panel.locator('#fill').click();
  await expect(site.locator('#body')).toHaveValue('保留这段草稿');
  await expect(site.locator('#subject')).toHaveValue('');
  // Deleting while a picker is open must cancel it rather than recreate the rule on the next click.
  await fields.getByRole('button', { name: '修改标题绑定' }).click();
  await expect(panel.locator('#pick-label')).toHaveText('取消绑定');
  await fields.getByRole('button', { name: '删除标题绑定' }).click();
  await expect(fields.locator('textarea')).toHaveCount(0);
  await expect(panel.locator('#fill')).toBeDisabled();
  await site.locator('#subject').click();
  expect(await worker.evaluate(() => chrome.storage.local.get('mappings'))).toEqual({ mappings: {} });
  await panel.reload(); await site.bringToFront();
  await expect(panel.locator('#platform')).toContainText('weibo.com');
  await bind('title', '#subject');
  await expect(panel.locator('#value-title')).toHaveValue('保留这段草稿');
});

test('文本框自动增高、缩小，恢复草稿及侧栏宽度变化后重新适配', async () => {
  await bind('description', '#body');
  const input = panel.locator('#value-description');
  const height = () => input.evaluate(el => el.getBoundingClientRect().height);
  const unclipped = () => input.evaluate(el => el.scrollHeight <= el.clientHeight);
  await expect(input).toHaveCSS('height', '36px');
  await edit('description', '第一行\n第二行\n第三行');
  await expect.poll(height).toBeGreaterThan(36);
  await expect.poll(unclipped).toBe(true);
  await expect(panel.locator('#save-state')).toContainText('内容已保存');
  await panel.reload(); await site.bringToFront();
  await expect(input).toHaveValue('第一行\n第二行\n第三行');
  await expect.poll(height).toBeGreaterThan(36);
  await edit('description', '短文字');
  await expect(input).toHaveCSS('height', '36px');
  await edit('description', '这是一段用于检查自动折行的长文本。'.repeat(8));
  const wideHeight = await height();
  await panel.setViewportSize({ width: 300, height: 640 });
  await expect.poll(height).toBeGreaterThan(wideHeight);
  await expect.poll(unclipped).toBe(true);
  await panel.screenshot({ path: 'test-results/sidebar-autogrow.png', fullPage: true });
  await edit('description', '');
  await expect(input).toHaveCSS('height', '36px');
});

test('已保存规则连续删除单项保留展开状态，其他折叠规则不展开', async () => {
  await bind('title', '#subject');
  await bind('description', '#body');
  await bind('topics', '#keywords');
  await site.goto(origin + '/other');
  await expect(panel.locator('#scope')).toHaveText('/other');
  await bind('title', '#subject');
  await site.goto(origin + '/third');
  await expect(panel.locator('#scope')).toHaveText('/third');
  await panel.locator('#rules > summary').click();
  await panel.locator('#saved-rules > summary').click();
  const saved = panel.locator('#all-rules > details').filter({ has: panel.getByText(key, { exact: true }) });
  const other = panel.locator('#all-rules > details').filter({ has: panel.getByText(origin + '/other', { exact: true }) });
  await saved.locator('summary').click();
  await saved.getByRole('button', { name: '删除标题绑定' }).click();
  await expect(saved.getByRole('button', { name: '删除标题绑定' })).toHaveCount(0);
  await expect(saved).toHaveJSProperty('open', true);
  await expect(saved.getByRole('button', { name: '删除简介绑定' })).toBeVisible();
  await expect(other).toHaveJSProperty('open', false);
  await saved.getByRole('button', { name: '删除简介绑定' }).click();
  await expect(saved.getByRole('button', { name: '删除简介绑定' })).toHaveCount(0);
  await expect(saved).toHaveJSProperty('open', true);
  await expect(saved.getByRole('button', { name: '删除话题绑定' })).toBeVisible();
  await expect(panel.locator('#rules')).toHaveJSProperty('open', true);
  await expect(panel.locator('#saved-rules')).toHaveJSProperty('open', true);
  await saved.getByRole('button', { name: '删除话题绑定' }).click();
  await expect(saved).toHaveCount(0);
  await expect(other).toHaveJSProperty('open', false);
});
