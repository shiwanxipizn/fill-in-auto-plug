import { fieldLabels, pageKey } from './mappings.js';

chrome.runtime.onInstalled.addListener(() => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }));

// Serialize mutations so concurrent bindings do not overwrite each other.
let mutations = Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!['picked-field', 'remove-binding'].includes(message.type)) return;
  const work = mutations.then(async () => {
    if (!Object.hasOwnProperty.call(fieldLabels, message.field)) throw new Error('无效的字段名称');
    let key;
    if (message.type === 'picked-field') {
      if (!sender.tab || sender.frameId !== 0) throw new Error('只支持当前页面主文档中的字段');
      key = pageKey(sender.url);
      if (key !== message.pageKey || typeof message.binding?.selector !== 'string') throw new Error('页面已变化，请重新绑定');
    } else {
      if (sender.tab) throw new Error('请从侧栏管理规则');
      key = pageKey(message.pageKey);
    }
    const { mappings = {} } = await chrome.storage.local.get('mappings');
    const entry = mappings[key] || { fields: {} };
    if (message.type === 'picked-field') entry.fields[message.field] = message.binding;
    else delete entry.fields[message.field];
    if (Object.keys(entry.fields).length) mappings[key] = { ...entry, updatedAt: Date.now() };
    else delete mappings[key];
    await chrome.storage.local.set({ mappings });
    return { ok: true };
  });
  mutations = work.catch(() => {});
  work.then(respond, error => respond({ ok: false, error: error.message }));
  return true;
});
