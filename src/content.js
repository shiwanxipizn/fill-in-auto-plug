(() => {
  if (globalThis.__autoFillLoaded) return;
  globalThis.__autoFillLoaded = true;
  let stopPicker;
  const inputTypes = new Set(['text', 'search', 'url', 'tel', 'email']);
  const editableSelector = 'input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]';
  const supported = el => el instanceof HTMLElement &&
    (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && inputTypes.has(el.type)) ||
      el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === 'plaintext-only');
  const visible = el => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const writable = el => supported(el) && visible(el) && !el.disabled && !el.readOnly;
  const currentKey = () => location.origin + location.pathname + (/^#!?\//.test(location.hash) ? location.hash.split('?')[0] : '');
  const attributeNames = ['id', 'name', 'placeholder', 'aria-label', 'data-testid', 'role', 'type'];
  const quote = value => '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\a ').replace(/\r/g, '\\d ') + '"';

  function bindingFor(el) {
    let selector;
    for (const attr of attributeNames) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      const candidate = `${el.localName}[${attr}=${quote(value)}]`;
      if (document.querySelectorAll(candidate).length === 1) { selector = candidate; break; }
    }
    // Structural fallback for unlabeled fields; verify attributes again before filling.
    if (!selector) {
      const parts = [];
      for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
        const siblings = [...node.parentElement.children].filter(x => x.localName === node.localName);
        parts.unshift(`${node.localName}:nth-of-type(${siblings.indexOf(node) + 1})`);
      }
      selector = 'html > ' + parts.join(' > ');
    }
    return {
      selector, tag: el.localName,
      attributes: Object.fromEntries(attributeNames.map(key => [key, el.getAttribute(key)])),
      label: el.labels?.[0]?.textContent.trim() || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.localName,
      maxLength: el.maxLength > 0 ? el.maxLength : null
    };
  }

  function resolve(binding) {
    if (!binding || typeof binding.selector !== 'string') throw new Error('规则无效，请重新绑定');
    let matches;
    try { matches = document.querySelectorAll(binding.selector); }
    catch { throw new Error('定位规则无效，请重新绑定'); }
    if (!matches.length) return null;
    if (matches.length !== 1) throw new Error('匹配到多个元素，请重新绑定');
    const el = matches[0];
    if (el.localName !== binding.tag || Object.entries(binding.attributes || {}).some(([key, value]) => el.getAttribute(key) !== value)) {
      throw new Error('页面字段属性已变化，请重新绑定');
    }
    if (!writable(el)) throw new Error('元素不可编辑、被隐藏或已禁用');
    return el;
  }

  async function waitFor(binding) {
    const el = resolve(binding);
    if (el) return el;
    return new Promise((resolvePromise, reject) => {
      const finish = (value, error) => { observer.disconnect(); clearTimeout(timeout); error ? reject(error) : resolvePromise(value); };
      const observer = new MutationObserver(() => {
        try { const match = resolve(binding); if (match) finish(match); } catch (error) { finish(null, error); }
      });
      const timeout = setTimeout(() => finish(null, new Error('等待 3 秒后仍未找到元素，请展开表单或重新绑定')), 3000);
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    });
  }

  function setValue(el, value) {
    el.focus();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const prototype = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(el, value);
    } else el.textContent = value;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: value }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
  }

  function startPicker(message) {
    stopPicker?.();
    if (message.pageKey !== currentKey()) throw new Error('页面已变化，请重新开始绑定');
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none';
    const root = host.attachShadow({ mode: 'closed' });
    const box = document.createElement('div'), tip = document.createElement('div');
    box.style.cssText = 'position:fixed;border:3px solid #2563eb;border-radius:4px;box-sizing:border-box;display:none;background:#2563eb18';
    tip.style.cssText = 'position:fixed;top:12px;left:12px;max-width:480px;padding:12px 18px;background:#172554;color:white;border-radius:8px;font:14px/1.6 system-ui';
    tip.textContent = `点击网页输入框，绑定为「${message.label}」。Esc 取消（60 秒后自动退出）。`;
    root.append(box, tip); document.documentElement.append(host);
    function target(event) {
      const el = event.target instanceof Element ? event.target.closest(editableSelector) : null;
      return writable(el) ? el : null;
    }
    function move(event) {
      const el = target(event);
      box.style.display = el ? 'block' : 'none';
      if (!el) return;
      const r = el.getBoundingClientRect();
      Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    }
    function cancelKey(event) { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); stopPicker?.(); } }
    function block(event) { event.preventDefault(); event.stopImmediatePropagation(); }
    async function pick(event) {
      block(event);
      const el = target(event);
      if (!el) { tip.textContent = '请选择可编辑的文本框；文件、密码、下拉框、iframe 内字段暂不支持。Esc 取消。'; return; }
      if (currentKey() !== message.pageKey) { stopPicker?.(); return; }
      const binding = bindingFor(el);
      stopPicker?.();
      try {
        const result = await chrome.runtime.sendMessage({ type: 'picked-field', field: message.field, pageKey: message.pageKey, binding });
        if (!result?.ok) throw new Error(result?.error || '保存失败');
      } catch (error) { alert(`字段绑定失败：${error.message}`); }
    }
    const timeout = setTimeout(() => stopPicker?.(), 60000);
    stopPicker = () => {
      host.remove(); clearTimeout(timeout);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('click', pick, true);
      document.removeEventListener('pointerdown', block, true);
      document.removeEventListener('mousedown', block, true);
      document.removeEventListener('keydown', cancelKey, true);
      stopPicker = undefined;
    };
    document.addEventListener('pointermove', move, true);
    document.addEventListener('click', pick, true);
    document.addEventListener('pointerdown', block, true);
    document.addEventListener('mousedown', block, true);
    document.addEventListener('keydown', cancelKey, true);
  }

  async function fillMappings(message) {
    stopPicker?.();
    if (currentKey() !== message.pageKey) throw new Error('页面已变化，请重新点击填写');
    const results = [];
    const targets = new Set();
    for (const item of message.values) {
      try {
        if (!item.value.trim()) { results.push(`${item.label}：内容为空，跳过`); continue; }
        const el = await waitFor(item.binding);
        if (currentKey() !== message.pageKey) throw new Error('页面已变化，停止填写');
        if (targets.has(el)) throw new Error('多个字段绑定到同一元素，请修正规则');
        targets.add(el);
        const limit = el.maxLength > 0 ? el.maxLength : item.binding.maxLength;
        if (limit && item.value.length > limit) throw new Error(`内容超过页面 ${limit} 字限制，未填写`);
        setValue(el, item.value);
        await new Promise(resolve => setTimeout(resolve, 100));
        const actual = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : el.textContent;
        if (!el.isConnected || actual !== item.value) throw new Error('页面未保留写入值，需手动检查');
        results.push(`${item.label}：已填写`);
      } catch (error) { results.push(`${item.label}：${error.message}`); }
    }
    return { ok: true, results };
  }

  async function legacyFill(draft) {
    const candidates = {
      title: ['input[placeholder*="标题"]', 'textarea[placeholder*="标题"]', 'input[aria-label*="标题"]', 'input[name="title"]'],
      description: ['textarea[placeholder*="简介"]', 'textarea[placeholder*="描述"]', '[contenteditable="true"]'],
      topics: ['input[placeholder*="话题"]', 'input[placeholder*="标签"]', 'textarea[placeholder*="标签"]']
    };
    const values = Object.entries(candidates).filter(([key]) => draft[key]?.length).map(([key, selectors]) => {
      const el = selectors.flatMap(s => [...document.querySelectorAll(s)]).find(writable);
      return { key, label: { title: '标题', description: '简介', topics: '话题' }[key], value: Array.isArray(draft[key]) ? draft[key].join(' ') : draft[key], binding: el ? bindingFor(el) : null };
    });
    const result = await fillMappings({ pageKey: currentKey(), values });
    const uploader = document.querySelector('input[type="file"][accept*="video"]') || document.querySelector('input[type="file"]');
    if (uploader) {
      const anchor = visible(uploader) ? uploader : uploader.parentElement;
      anchor.scrollIntoView({ block: 'center' }); anchor.style.outline = '3px solid #2563eb';
      result.results.push('已定位文件选择区域，请确认是视频控件并手动选择文件');
    }
    return result;
  }

  chrome.runtime.onMessage.addListener((message, _, respond) => {
    if (!['pick-field', 'cancel-picker', 'fill-mappings', 'fill'].includes(message.type)) return;
    (async () => {
      if (message.type === 'pick-field') { startPicker(message); return { ok: true }; }
      if (message.type === 'cancel-picker') { stopPicker?.(); return { ok: true }; }
      if (message.type === 'fill-mappings') return fillMappings(message);
      return legacyFill(message.draft);
    })().then(respond, error => respond({ ok: false, error: error.message }));
    return true;
  });
})();
