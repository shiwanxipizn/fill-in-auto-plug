import { platformFor, makeDraft, validate } from './rules.js';
import { fieldLabels, pageKey, mappedValues } from './mappings.js';

const $ = id => document.getElementById(id);
const names = { weibo: '微博', baijiahao: '百家号', sohu: '搜狐' };
let currentTab, mappings = {}, busy = false, refreshId = 0, draftTimer;
const status = message => { $('status').textContent = message; };
async function activeTab() { return (await chrome.tabs.query({ active: true, currentWindow: true }))[0]; }
function content() {
  return Object.fromEntries(Object.keys(fieldLabels).map(key => [key,
    ['topics', 'tags'].includes(key) ? $(key).value.trim().split(/\s+/).filter(Boolean) : $(key).value
  ]));
}
async function saveDraft() { clearTimeout(draftTimer); await chrome.storage.local.set({ draft: content() }); }

function ruleRow(key, field, binding) {
  const row = document.createElement('div'); row.className = 'rule';
  const title = document.createElement('strong'); title.textContent = `${fieldLabels[field] || field} ← ${binding.label}`;
  const detail = document.createElement('small'); detail.textContent = binding.selector + (binding.maxLength ? `\n页面长度限制：${binding.maxLength}` : '');
  const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove'; remove.textContent = '删除绑定';
  remove.onclick = () => run(async () => {
    const response = await chrome.runtime.sendMessage({ type: 'remove-binding', pageKey: key, field });
    if (!response?.ok) throw new Error(response?.error || '删除失败');
    await refresh(); status('绑定已删除');
  });
  row.append(title, detail, remove); return row;
}

async function refresh() {
  const request = ++refreshId;
  const [tab, data] = await Promise.all([activeTab(), chrome.storage.local.get('mappings')]);
  if (request !== refreshId) return;
  currentTab = tab; mappings = data.mappings || {};
  let key;
  try { key = pageKey(tab?.url); } catch { /* Protected pages have no editable mapping. */ }
  const fields = mappings[key]?.fields || {};
  const platform = platformFor(tab?.url);
  $('platform').textContent = key ? `${new URL(key).hostname} · ${Object.keys(fields).length} 个已绑定字段` : '当前页面无法绑定，请打开普通网页';
  $('scope').textContent = key ? `匹配范围：${key}（忽略查询参数）${names[platform] && !Object.keys(fields).length ? '；未绑定时使用内置基础适配' : ''}` : '';
  $('bindings').replaceChildren(...Object.entries(fields).map(([field, binding]) => ruleRow(key, field, binding)));
  if (!Object.keys(fields).length) $('bindings').textContent = '当前页面尚未绑定字段。';
  $('all-rules').replaceChildren(...Object.entries(mappings).map(([scope, entry]) => {
    const group = document.createElement('details'), summary = document.createElement('summary');
    summary.textContent = scope;
    group.append(summary, ...Object.entries(entry.fields).map(([field, binding]) => ruleRow(scope, field, binding)));
    return group;
  }));
  if (!Object.keys(mappings).length) $('all-rules').textContent = '暂无规则';
  updateButtons();
}
function updateButtons() {
  let valid = false;
  try { pageKey(currentTab?.url); valid = true; } catch { /* Not an ordinary web page. */ }
  for (const id of ['pick', 'fill', 'cancel']) $(id).disabled = busy || !valid;
  $('save').disabled = busy;
  for (const el of document.querySelectorAll('.remove')) el.disabled = busy;
}
async function run(action) {
  if (busy) return;
  busy = true; updateButtons();
  try { await action(); } catch (error) { status(`操作未完成：${error.message}`); }
  finally { busy = false; updateButtons(); }
}

// Request only the current origin, and do so directly within the user's button gesture.
function permitted(action) {
  if (busy) return;
  const snapshot = currentTab;
  let key, permission;
  try {
    key = pageKey(snapshot?.url);
    permission = chrome.permissions.request({ origins: [new URL(snapshot.url).origin + '/*'] });
  } catch (error) { status(error.message); return; }
  run(async () => {
    if (!await permission) throw new Error('未授权访问当前站点，请再次点击并允许站点访问');
    const latest = await activeTab();
    if (latest?.id !== snapshot.id || pageKey(latest.url) !== key) throw new Error('当前标签页已变化，请重试');
    await chrome.scripting.executeScript({ target: { tabId: snapshot.id }, files: ['src/content.js'] });
    await action(snapshot, key);
  });
}
async function command(tab, message) {
  const result = await chrome.tabs.sendMessage(tab.id, message, { frameId: 0 });
  if (!result?.ok) throw new Error(result?.error || '页面未响应，请刷新网页后重试');
  return result;
}

$('pick').onclick = () => {
  const field = $('field').value;
  permitted(async (tab, key) => {
    await command(tab, { type: 'pick-field', pageKey: key, field, label: fieldLabels[field] });
    status(`请在网页上点击要绑定为「${fieldLabels[field]}」的文本框。保存后会显示在下方规则中。`);
  });
};
$('cancel').onclick = () => run(async () => {
  try { await command(await activeTab(), { type: 'cancel-picker' }); } catch { /* No injected picker to cancel. */ }
  status('已退出点选');
});
$('fill').onclick = () => permitted(async (tab, key) => {
  await saveDraft();
  const data = await chrome.storage.local.get('mappings');
  const fields = data.mappings?.[key]?.fields;
  let message;
  if (fields && Object.keys(fields).length) {
    message = { type: 'fill-mappings', pageKey: key, values: mappedValues(content(), fields) };
  } else {
    const platform = platformFor(tab.url);
    if (platform === 'unknown') throw new Error('请先为当前页面绑定至少一个字段');
    const errors = validate(content(), platform);
    if (errors.length) throw new Error(errors.join('\n'));
    message = { type: 'fill', draft: makeDraft(content(), platform) };
  }
  status('正在填写，请保持当前页面…');
  const result = await command(tab, message);
  status(result.results.join('\n') + '\n请检查网页内容后自行提交。');
});
$('save').onclick = () => run(async () => { await saveDraft(); status('草稿已保存'); });
$('editor').onsubmit = event => event.preventDefault();
$('editor').oninput = () => {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => saveDraft().catch(error => status(`草稿保存失败：${error.message}`)), 300);
};
chrome.tabs.onActivated.addListener(() => refresh().catch(error => status(error.message)));
chrome.tabs.onUpdated.addListener((id, changes) => {
  if (id === currentTab?.id && (changes.url || changes.status === 'complete')) refresh().catch(error => status(error.message));
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.mappings) { refresh().catch(error => status(error.message)); status('本地规则已更新'); }
});
async function init() {
  const { draft = {} } = await chrome.storage.local.get('draft');
  for (const key of Object.keys(fieldLabels)) $(key).value = Array.isArray(draft[key]) ? draft[key].join(' ') : draft[key] || '';
  await refresh();
}
init().catch(error => status(`初始化失败：${error.message}`));
