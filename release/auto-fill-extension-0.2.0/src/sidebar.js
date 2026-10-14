import { fieldLabels, pageKey, mappedValues } from './mappings.js';

const $ = id => document.getElementById(id);
let currentTab, mappings = {}, draft = {}, fieldErrors = {}, busy = false, ready = false;
let refreshId = 0, draftTimer, pickerTimer, pickingTab;
const status = (message, error = false) => {
  $('status').textContent = message; $('status').hidden = !message;
  $('status').dataset.error = String(error);
};
async function activeTab() { return (await chrome.tabs.query({ active: true, currentWindow: true }))[0]; }
function content() { return { ...draft }; }
async function saveDraft() {
  clearTimeout(draftTimer);
  await chrome.storage.local.set({ draft: content() });
  $('save-state').textContent = '内容已保存，填写后请核对。';
}
function resizeInput(input) {
  input.style.height = 'auto';
  input.style.height = `${Math.max(36, input.scrollHeight + input.offsetHeight - input.clientHeight)}px`;
}
function resizeInputs() {
  document.querySelectorAll('#content-fields textarea').forEach(resizeInput);
}
function renderFields(fields) {
  const keys = Object.keys(fields).filter(field => Object.hasOwnProperty.call(fieldLabels, field));
  const container = $('content-fields');
  for (const row of [...container.children]) {
    if (!keys.includes(row.dataset.field)) row.remove();
  }
  for (const field of keys) {
    // Keep existing textareas intact so rule refreshes preserve focus and unsaved typing.
    if ($(`value-${field}`)) continue;
    const row = document.createElement('div'); row.className = 'form-field'; row.dataset.field = field;
    const header = document.createElement('div'); header.className = 'field-header';
    const label = document.createElement('label'); label.htmlFor = `value-${field}`; label.textContent = fieldLabels[field];
    const actions = document.createElement('div'); actions.className = 'field-actions';
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'edit secondary'; edit.textContent = '修改';
    edit.setAttribute('aria-label', `修改${fieldLabels[field]}绑定`);
    edit.onclick = () => startPicking(field);
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove'; remove.textContent = '删除';
    remove.setAttribute('aria-label', `删除${fieldLabels[field]}绑定`);
    remove.onclick = () => removeBinding(pageKey(currentTab.url), field);
    actions.append(edit, remove); header.append(label, actions);
    const input = document.createElement('textarea'); input.id = label.htmlFor; input.dataset.field = field; input.rows = 1;
    input.value = Array.isArray(draft[field]) ? draft[field].join(' ') : draft[field] || '';
    input.placeholder = ['topics', 'tags'].includes(field) ? '多个内容以空格分隔' : `输入${fieldLabels[field]}`;
    const error = document.createElement('p'); error.id = `error-${field}`; error.className = 'error-text'; error.hidden = true;
    input.setAttribute('aria-describedby', error.id);
    row.append(header, input, error); container.append(row);
  }
  $('empty-fields').hidden = !!keys.length;
  renderError();
  resizeInputs();
}
function renderError() {
  for (const input of document.querySelectorAll('#content-fields textarea')) {
    const field = input.dataset.field, error = fieldErrors[field];
    input.setAttribute('aria-invalid', String(!!error));
    $(`error-${field}`).textContent = error || ''; $(`error-${field}`).hidden = !error;
  }
}
function endPicking() {
  clearTimeout(pickerTimer); pickingTab = undefined;
  $('pick-label').textContent = '绑定元素';
}
async function cancelPicking() {
  const tab = pickingTab; endPicking();
  if (tab) { try { await command(tab, { type: 'cancel-picker' }); } catch { /* Page may have navigated. */ } }
}

function removeBinding(key, field) {
  run(async () => {
    await cancelPicking();
    await saveDraft();
    const response = await chrome.runtime.sendMessage({ type: 'remove-binding', pageKey: key, field });
    if (!response?.ok) throw new Error(response?.error || '删除失败');
    await refresh(); status('绑定已删除');
  });
}

function ruleRow(key, field, binding) {
  const row = document.createElement('div'); row.className = 'rule';
  const title = document.createElement('strong'); title.textContent = `${fieldLabels[field] || field} ← ${binding.label}`;
  const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove'; remove.textContent = '删除';
  remove.setAttribute('aria-label', `删除${fieldLabels[field] || field}绑定`);
  remove.onclick = () => removeBinding(key, field);
  row.append(title, remove); return row;
}

async function refresh() {
  const request = ++refreshId;
  const [tab, data] = await Promise.all([activeTab(), chrome.storage.local.get('mappings')]);
  if (request !== refreshId) return;
  const changed = currentTab && (currentTab.id !== tab?.id || currentTab.url !== tab?.url);
  currentTab = tab; mappings = data.mappings || {};
  if (changed) { await cancelPicking(); fieldErrors = {}; renderError(); status(''); }
  let key;
  try { key = pageKey(tab?.url); } catch { /* Protected pages have no mapping. */ }
  const fields = mappings[key]?.fields || {};
  renderFields(fields);
  $('platform').textContent = key ? `${new URL(key).hostname} · ${Object.keys(fields).length} 个绑定` : '请打开普通网页';
  $('scope').textContent = key ? new URL(key).pathname + new URL(key).hash : '';
  $('rule-count').textContent = Object.keys(fields).length;
  $('bindings').replaceChildren(...Object.entries(fields).map(([field, binding]) => ruleRow(key, field, binding)));
  if (!Object.keys(fields).length) $('bindings').textContent = '尚未绑定';
  const others = Object.entries(mappings).filter(([scope]) => scope !== key);
  $('saved-rules').hidden = !others.length;
  const expandedScopes = new Set([...$('all-rules').children].filter(group => group.open).map(group => group.dataset.scope));
  $('all-rules').replaceChildren(...others.map(([scope, entry]) => {
    const group = document.createElement('details'), summary = document.createElement('summary');
    group.dataset.scope = scope;
    group.open = expandedScopes.has(scope);
    summary.textContent = scope;
    group.append(summary, ...Object.entries(entry.fields).map(([field, binding]) => ruleRow(scope, field, binding)));
    return group;
  }));
  updateButtons();
}
function updateButtons() {
  let valid = false;
  try { pageKey(currentTab?.url); valid = true; } catch { /* Not an ordinary web page. */ }
  for (const id of ['pick', 'fill']) $(id).disabled = !ready || busy || !valid;
  if (!$('content-fields').children.length) $('fill').disabled = true;
  $('field').disabled = !ready || busy;
  for (const input of document.querySelectorAll('#content-fields textarea')) input.disabled = !ready || busy;
  for (const el of document.querySelectorAll('.remove, .edit')) el.disabled = !ready || busy;
}
async function run(action) {
  if (busy) return;
  busy = true; updateButtons();
  try { await action(); } catch (error) { status(error.message, true); }
  finally { busy = false; $('fill-label').textContent = '一键填写'; updateButtons(); }
}

// Request the current origin within the user's button gesture.
function permitted(action) {
  if (busy) return;
  const snapshot = currentTab;
  let key, permission;
  try {
    key = pageKey(snapshot?.url);
    const url = new URL(snapshot.url);
    permission = chrome.permissions.request({ origins: [`${url.protocol}//${url.hostname}/*`] });
  } catch (error) { status(error.message, true); return; }
  run(async () => {
    if (!await permission) throw new Error('请允许访问当前站点后重试');
    const latest = await activeTab();
    if (latest?.id !== snapshot.id || pageKey(latest.url) !== key) throw new Error('标签页已变化，请重试');
    await chrome.scripting.executeScript({ target: { tabId: snapshot.id }, files: ['src/content.js'] });
    await action(snapshot, key);
  });
}
async function command(tab, message) {
  const result = await chrome.tabs.sendMessage(tab.id, message, { frameId: 0 });
  if (!result?.ok) throw new Error(result?.error || '页面未响应，请刷新后重试');
  return result;
}

function startPicking(field) {
  $('field').value = field;
  permitted(async (tab, key) => {
    await cancelPicking();
    await command(tab, { type: 'pick-field', pageKey: key, field, label: fieldLabels[field] });
    pickingTab = tab; $('pick-label').textContent = '取消绑定';
    clearTimeout(pickerTimer);
    pickerTimer = setTimeout(() => { endPicking(); status('点选已结束'); }, 60000);
    status(`请在网页上点击「${fieldLabels[field]}」对应的输入框。`);
  });
}
$('pick').onclick = () => {
  if (pickingTab) { run(async () => { await cancelPicking(); status('已取消绑定'); }); return; }
  startPicking($('field').value);
};
$('fill').onclick = () => permitted(async (tab, key) => {
  await cancelPicking(); await saveDraft();
  const data = await chrome.storage.local.get('mappings');
  const fields = data.mappings?.[key]?.fields;
  fieldErrors = {}; renderError();
  if (!fields || !Object.keys(fields).length) throw new Error('请先绑定网页字段');
  const message = { type: 'fill-mappings', pageKey: key, values: mappedValues(content(), fields) };
  $('fill-label').textContent = '填写中…'; status('');
  const result = await command(tab, message);
  const filled = result.results.filter(line => line.endsWith('：已填写'));
  const skipped = result.results.filter(line => line.includes('内容为空，跳过'));
  const errors = result.results.filter(line => !filled.includes(line) && !skipped.includes(line) && !line.startsWith('已定位'));
  for (const line of errors) {
    const field = Object.keys(fieldLabels).find(key => line.startsWith(fieldLabels[key] + '：'));
    if (field) fieldErrors[field] = line.slice(fieldLabels[field].length + 1);
  }
  renderError();
  status(errors.length ? `已填写 ${filled.length} 项，${errors.length} 项需检查。` : filled.length ? `已填写 ${filled.length} 项${skipped.length ? `，跳过 ${skipped.length} 项` : ''}。` : '内容为空，已跳过。', !!errors.length);
});
$('field').onchange = () => { cancelPicking().catch(error => status(error.message, true)); status(''); };
$('editor').onsubmit = event => event.preventDefault();
$('content-fields').oninput = event => {
  const field = event.target.dataset.field, value = event.target.value;
  if (!Object.hasOwnProperty.call(fieldLabels, field)) return;
  resizeInput(event.target);
  draft[field] = ['topics', 'tags'].includes(field) ? value.trim().split(/\s+/).filter(Boolean) : value;
  delete fieldErrors[field]; renderError(); status('');
  $('save-state').textContent = '正在保存…';
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => saveDraft().catch(error => {
    $('save-state').textContent = '保存失败'; status(error.message, true);
  }), 300);
};
window.addEventListener('resize', resizeInputs);
chrome.tabs.onActivated.addListener(() => refresh().catch(error => status(error.message, true)));
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'picker-ended' && sender.tab?.id === pickingTab?.id) {
    endPicking(); status('');
  }
});
chrome.tabs.onUpdated.addListener((id, changes) => {
  if (id === currentTab?.id && (changes.url || changes.status === 'complete')) refresh().catch(error => status(error.message, true));
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.mappings) {
    endPicking(); fieldErrors = {}; renderError();
    refresh().catch(error => status(error.message, true)); status('规则已保存');
  }
});
async function init() {
  const data = await chrome.storage.local.get('draft'); draft = data.draft || {};
  ready = true; await refresh();
}
init().catch(error => status(`初始化失败：${error.message}`, true));
