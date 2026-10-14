export const fieldLabels = {
  title: '标题', subtitle: '副标题', description: '简介', topics: '话题',
  tags: '标签', vehicle: '车型', location: '地点'
};

// Query parameters usually contain draft IDs; hash routes identify distinct SPA pages.
export function pageKey(url) {
  const u = new URL(url);
  if (!['https:', 'http:'].includes(u.protocol)) throw new Error('请在普通 HTTP/HTTPS 网页中使用，浏览器内部页面无法绑定。');
  const route = /^#!?\//.test(u.hash) ? u.hash.split('?')[0] : '';
  return u.origin + u.pathname + route;
}

export function mappedValues(content, fields) {
  return Object.keys(fields).filter(key => Object.hasOwnProperty.call(fieldLabels, key)).map(key => ({
    key, label: fieldLabels[key], binding: fields[key],
    value: Array.isArray(content[key]) ? content[key].join(' ') : String(content[key] || '')
  }));
}
