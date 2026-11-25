// Minimalny renderer Markdown (opisy z Modrinth) + oczyszczanie HTML (lista dozwolonych tagów).
const ALLOWED = new Set(['P', 'A', 'IMG', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'STRONG', 'EM', 'B', 'I', 'U', 'S', 'DEL', 'CODE', 'PRE', 'BR', 'HR', 'BLOCKQUOTE', 'CENTER', 'DIV', 'SPAN', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'DETAILS', 'SUMMARY', 'SUP', 'SUB', 'SMALL', 'FONT']);
const ATTRS = { A: ['href', 'title'], IMG: ['src', 'alt', 'title', 'width', 'height'], TD: ['align'], TH: ['align'], DIV: ['align'], P: ['align'] };

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, (_, c) => `<code>${esc(c)}</code>`)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, '<img alt="$1" src="$2">')
    .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2">$2</a>');
}

function toHtml(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let list = null; let para = []; let code = null;
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const line of lines) {
    if (code !== null) {
      if (/^```/.test(line)) { out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); code = null; } else code.push(line);
      continue;
    }
    if (/^```/.test(line)) { flushPara(); flushList(); code = []; continue; }
    const hm = line.match(/^(#{1,6})\s+(.*)$/);
    if (hm) { flushPara(); flushList(); out.push(`<h${hm[1].length}>${inline(hm[2])}</h${hm[1].length}>`); continue; }
    if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(line)) { flushPara(); flushList(); out.push('<hr>'); continue; }
    const li = line.match(/^\s*([-*+]|\d+\.)\s+(.*)$/);
    if (li) {
      flushPara();
      const kind = /\d/.test(li[1]) ? 'ol' : 'ul';
      if (list !== kind) { flushList(); out.push(`<${kind}>`); list = kind; }
      out.push(`<li>${inline(li[2])}</li>`);
      continue;
    }
    if (/^>\s?/.test(line)) { flushPara(); flushList(); out.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`); continue; }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (/^\s*<\/?[a-z][^>]*>\s*$/i.test(line)) { flushPara(); flushList(); out.push(line); continue; }
    para.push(line.trim());
  }
  flushPara(); flushList();
  if (code) out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
  return out.join('\n');
}

function sanitize(node) {
  for (const el of [...node.querySelectorAll('*')]) {
    if (!ALLOWED.has(el.tagName)) {
      if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'LINK', 'META'].includes(el.tagName)) el.remove();
      else el.replaceWith(...el.childNodes);
      continue;
    }
    const keep = ATTRS[el.tagName] || [];
    for (const a of [...el.attributes]) if (!keep.includes(a.name)) el.removeAttribute(a.name);
    if (el.tagName === 'A') { const href = el.getAttribute('href') || ''; if (!/^https?:\/\//.test(href)) el.removeAttribute('href'); }
    if (el.tagName === 'IMG') {
      const src = el.getAttribute('src') || '';
      if (!/^https?:\/\//.test(src)) el.remove(); else el.setAttribute('loading', 'lazy');
    }
  }
  return node;
}

export function renderMarkdown(md) {
  const doc = new DOMParser().parseFromString(`<div>${toHtml(String(md || ''))}</div>`, 'text/html');
  const root = sanitize(doc.body.firstChild);
  const frag = document.createDocumentFragment();
  frag.append(...root.childNodes);
  return frag;
}

/** Opis w HTML (CurseForge) – ta sama lista dozwolonych tagów co dla Markdown. */
export function renderHtml(html) {
  const doc = new DOMParser().parseFromString(`<div>${String(html || '')}</div>`, 'text/html');
  const root = sanitize(doc.body.firstChild);
  const frag = document.createDocumentFragment();
  frag.append(...root.childNodes);
  return frag;
}
