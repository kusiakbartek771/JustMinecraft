// Strona projektu Modrinth: opis, galeria, wersje i instalacja.
import { S, api, selectedInstance } from '../state.js';
import { h, btn, empty, spinner, select, toast, fmtNum, fmtAgo, modal, iconBtn } from '../ui.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { registerView, back } from '../router.js';
import { LOADER_NAMES } from '../theme.js';
import { installProject, pickWorld } from '../actions.js';
import { catLabel, installModpack } from './browse.js';
import { renderMarkdown } from '../markdown.js';

registerView('project', async (root, param) => {
  root.append(spinner());
  let p;
  try { p = await api('modrinth:project', param.id); } catch (e) { root.replaceChildren(empty('alert', t('Nie udało się wczytać projektu'), e.message, btn(t('Wróć'), back))); return; }
  const type = p.type === 'mod' && param.type === 'datapack' ? 'datapack' : p.type;
  let instanceId = param.instanceId || selectedInstance()?.id;
  const inst = () => S.instances.find((i) => i.id === instanceId);
  let tab = 'desc';
  root.replaceChildren();

  const head = h('div.card.card-pad', { style: { display: 'flex', gap: '18px', alignItems: 'center', marginBottom: '14px' } });
  const tabs = h('div.tabs');
  const body = h('div');
  root.append(head, tabs, body);

  function drawHead() {
    const target = type === 'modpack' ? null : h('div.row', null, h('span.muted.small', { text: t('do:') }),
      select(S.instances.map((i) => [i.id, `${i.name} (${LOADER_NAMES[i.loader]} ${i.mc})`]), instanceId, (v) => { instanceId = v; if (tab === 'versions') drawBody(); }));
    head.replaceChildren(
      iconBtn('arrowLeft', t('Wstecz'), back),
      h('img', { src: p.icon || '', style: { width: '88px', height: '88px', borderRadius: '18px', background: 'var(--elevated)', objectFit: 'cover' } }),
      h('div.grow', null,
        h('h1', { style: { margin: '0 0 4px', fontSize: '1.6em' }, text: p.title }),
        h('p.muted', { style: { margin: '0 0 8px' }, text: p.description }),
        h('div.row', { style: { gap: '6px' } },
          h('span.chip', null, h('span', { html: icon('download') }), fmtNum(p.downloads)),
          h('span.chip', null, h('span', { html: icon('heart') }), fmtNum(p.followers)),
          h('span.chip', null, h('span', { html: icon('clock') }), fmtAgo(new Date(p.updated).getTime())),
          ...(p.categories || []).slice(0, 5).map((c) => h('span.chip', { text: catLabel(c) })),
          p.license ? h('span.chip', { text: p.license }) : null)),
      h('div.col', { style: { alignItems: 'flex-end' } },
        type === 'modpack' ? btn(t('Zainstaluj modpack'), () => installModpack(p), { kind: 'primary', icon: 'download' }) : btn(t('Zainstaluj'), () => install(), { kind: 'primary', icon: 'download', disabled: !inst() }),
        target,
        h('div.row', null,
          btn('Modrinth', () => api('shell:open', `https://modrinth.com/${p.type}/${p.slug}`), { small: true, kind: 'ghost', icon: 'external' }),
          p.source ? btn(t('Kod'), () => api('shell:open', p.source), { small: true, kind: 'ghost', icon: 'github' }) : null,
          p.wiki ? btn('Wiki', () => api('shell:open', p.wiki), { small: true, kind: 'ghost', icon: 'info' }) : null)));
  }

  async function install(versionId) {
    const i = inst();
    if (!i) { toast(t('Wybierz instancję')); return; }
    let world;
    if (type === 'datapack') { world = await pickWorld(i); if (!world) return; }
    await installProject({ instance: i, project: p, type, versionId, world });
  }

  function drawTabs() {
    tabs.replaceChildren();
    for (const [k, label] of [['desc', t('Opis')], ['gallery', `${t('Galeria')} (${p.gallery.length})`], ['versions', t('Wersje')]]) {
      tabs.append(h(`button.tab${tab === k ? '.active' : ''}`, { onClick: () => { tab = k; drawTabs(); drawBody(); } }, label));
    }
  }

  async function drawBody() {
    body.replaceChildren();
    if (tab === 'desc') {
      const d = h('div.card.card-pad.project-body');
      d.append(renderMarkdown(p.body || p.description));
      d.addEventListener('click', (e) => { const a = e.target.closest('a'); if (a?.href && /^https?:/.test(a.href)) { e.preventDefault(); api('shell:open', a.href); } });
      body.append(d);
    } else if (tab === 'gallery') {
      if (!p.gallery.length) { body.append(empty('image', t('Brak zdjęć'), '')); return; }
      body.append(h('div.gallery', null, p.gallery.map((g) => h('img', { src: g.url, loading: 'lazy', title: g.title || '', onClick: () => modal(h('img', { src: g.url, style: { width: '100%', borderRadius: '10px' } }), { full: false, wide: true, title: g.title || p.title }) }))));
    } else {
      body.append(spinner());
      const i = inst();
      let all = false;
      const draw = async () => {
        body.replaceChildren(spinner());
        try {
          const list = await api('modrinth:versions', p.id, all || !i || type === 'modpack' ? {} : { mc: i.mc, loader: i.loader, type });
          body.replaceChildren(h('div.row', { style: { marginBottom: '10px' } },
            type !== 'modpack' && i ? h('label.row.small', { style: { cursor: 'pointer' } }, h('input', { type: 'checkbox', checked: all, onChange: (e) => { all = e.target.checked; draw(); } }), t('Pokaż wszystkie wersje (także niezgodne z {n})', { n: i.name })) : null));
          if (!list.length) { body.append(empty('alert', t('Brak zgodnych wersji'), t('Ten projekt nie ma wersji dla Minecrafta {v} z tym loaderem.', { v: i?.mc }))); return; }
          const card = h('div.card', { style: { padding: '6px' } });
          for (const v of list.slice(0, 100)) {
            card.append(h('div.version-row', null,
              h('div', null, h('b', { text: v.name || v.number }), h('div.muted.small', { text: v.number })),
              h('div.small', null, h('span.chip', { class: v.type === 'release' ? 'ok' : 'warn', text: v.type }), ' ', h('span.muted', { text: v.loaders.map((l) => LOADER_NAMES[l] || l).join(', ') })),
              h('div.small.muted.ellipsis', { text: v.gameVersions.slice(-4).join(', ') }),
              type === 'modpack' ? btn(t('Zainstaluj'), () => installModpack({ ...p, versionId: v.id }), { small: true, icon: 'download' }) : btn(t('Zainstaluj'), () => install(v.id), { small: true, icon: 'download', disabled: !i })));
          }
          body.replaceChildren(body.firstChild, card);
        } catch (e) { body.replaceChildren(empty('alert', e.message, '')); }
      };
      draw();
    }
  }

  drawHead(); drawTabs(); drawBody();
});
