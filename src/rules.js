const rules = {
  weibo: { titleMaxLength: 100, maxTopics: 5, topic: x => `#${x}#` },
  baijiahao: { titleMaxLength: 30, maxTopics: 3, topic: x => x },
  sohu: { titleMaxLength: 50, maxTopics: 5, topic: x => x }
};
export function platformFor(url = '') {
  let host;
  try { host = new URL(url).hostname; } catch { return 'unknown'; }
  const matches = domain => host === domain || host.endsWith('.' + domain);
  if (matches('weibo.com')) return 'weibo';
  if (matches('baijiahao.baidu.com')) return 'baijiahao';
  if (matches('sohu.com')) return 'sohu';
  return 'unknown';
}
export function makeDraft(content, platform) {
  const rule = rules[platform] || rules.sohu;
  const title = String(content.title || '').trim();
  const topics = (content.topics || []).filter(Boolean).slice(0, rule.maxTopics);
  return { ...content, title: title.slice(0, rule.titleMaxLength), topics: topics.map(rule.topic), platform };
}
export function validate(content, platform) {
  const rule = rules[platform]; if (!rule) return ['当前页面不是支持的平台'];
  const errors = []; if (!String(content.title || '').trim()) errors.push('标题不能为空');
  if (String(content.title || '').length > rule.titleMaxLength) errors.push(`标题不能超过 ${rule.titleMaxLength} 字`);
  return errors;
}
