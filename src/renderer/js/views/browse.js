// Odkrywaj: wyszukiwarka Modrinth (mody, modpacki, resource packi, shadery, datapacki) z instalacją jednym kliknięciem.
import { S, api, on, selectedInstance, refreshInstances } from '../state.js';
import { h, btn, empty, spinner, select, toast, toastError, fmtNum, fmtAgo, debounce } from '../ui.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { navigate, registerView } from '../router.js';
import { instIcon, loaderChip } from '../components.js';
import { LOADER_NAMES } from '../theme.js';
import { installProject, pickWorld } from '../actions.js';

export const TYPES = [['mod', 'Mody', 'puzzle'], ['modpack', 'Modpacki', 'package'], ['resourcepack', 'Resource packi', 'image'], ['shader', 'Shadery', 'sun'], ['datapack', 'Datapacki', 'map']];
const CATS = {
  mod: ['optimization', 'adventure', 'decoration', 'equipment', 'food', 'game-mechanics', 'library', 'magic', 'management', 'mobs', 'storage', 'technology', 'transportation', 'utility', 'worldgen'],
  modpack: ['adventure', 'challenging', 'combat', 'kitchen-sink', 'lightweight', 'magic', 'multiplayer', 'optimization', 'quests', 'technology'],
  resourcepack: ['vanilla-like', 'realistic', 'simplistic', 'themed', 'combat', 'gui', 'fonts', 'audio', 'models', '16x', '32x', '64x'],
  shader: ['vanilla-like', 'semi-realistic', 'realistic', 'fantasy', 'cartoon', 'potato', 'low', 'medium', 'high'],
  datapack: ['adventure', 'equipment', 'game-mechanics', 'magic', 'mobs', 'utility', 'worldgen'],
};
const CAT_PL = {
  optimization: 'optymalizacja', adventure: 'przygoda', decoration: 'dekoracje', equipment: 'ekwipunek', food: 'jedzenie', 'game-mechanics': 'mechaniki', library: 'biblioteki',
  magic: 'magia', management: 'zarządzanie', mobs: 'moby', storage: 'magazyny', technology: 'technologia', transportation: 'transport', utility: 'narzędzia', worldgen: 'generowanie świata',
  challenging: 'wyzwanie', combat: 'walka', 'kitchen-sink': 'wszystko naraz', lightweight: 'lekkie', multiplayer: 'multiplayer', quests: 'questy', 'vanilla-like': 'jak vanilla',
  realistic: 'realistyczne', simplistic: 'proste', themed: 'tematyczne', gui: 'interfejs', fonts: 'czcionki', audio: 'dźwięki', models: 'modele', 'semi-realistic': 'pół-realistyczne',
  fantasy: 'fantasy', cartoon: 'kreskówkowe', potato: 'słaby PC', low: 'niskie', medium: 'średnie', high: 'wysokie',
};
const HIDE_CATS = new Set(['fabric', 'forge', 'quilt', 'neoforge', 'iris', 'optifine', 'canvas', 'vanilla', 'minecraft', 'datapack', 'babric', 'bukkit', 'paper', 'spigot', 'purpur', 'folia', 'sponge', 'velocity', 'bungeecord', 'waterfall', 'liteloader', 'modloader', 'rift', 'legacy-fabric', 'ornithe', 'nilloader', 'java-agent', 'bta-babric', 'risugami', 'geyser']);
export const catLabel = (c) => t(CAT_PL[c] || c);

const st = { q: '', type: 'mod', sort: 'relevance', cats: [], page: 0, instanceId: null, anyVersion: false };

registerView('browse', (root, param = {}) => {
  if (param.type) st.type = param.type;
  if (param.instanceId) st.instanceId = param.instanceId;
  if (!S.instances.some((i) => i.id === st.instanceId)) st.instanceId = selectedInstance()?.id || null;
  if (param.type || param.instanceId) { st.page = 0; st.cats = []; }

  const target = () => S.instances.find((i) => i.id === st.instanceId) || null;
  let installed = new Set();
  const head = h('div.page-head');
  const targetBar = h('div');
  const layout = h('div.browse-layout');
  const filters = h('div.browse-filters');
  const results = h('div.results');
  const pager = h('div.pager');
  layout.append(filters, h('div', null, results, pager));
  root.append(head, targetBar, layout);

  const searchIn = h('input.input', { placeholder: t('Szukaj na Modrinth…'), value: st.q, onInput: debounce((e) => { st.q = e.target.value; st.page = 0; load(); }, 300) });
  function drawHead() {
    head.replaceChildren(h('h1', { text: t('Odkrywaj') }), h('div.spacer'),
      h('div.search-box', { style: { width: 'min(420px, 50vw)' } }, h('span', { html: icon('search') }), searchIn),
      select([['relevance', t('Trafność')], ['downloads', t('Pobrania')], ['follows', t('Obserwujący')], ['newest', t('Najnowsze')], ['updated', t('Aktualizowane')]], st.sort, (v) => { st.sort = v; st.page = 0; load(); }));
  }

  function drawTarget() {
    targetBar.replaceChildren();
    const tabs = h('div.tabs');
    for (const [k, label, ic] of TYPES) tabs.append(h(`button.tab${st.type === k ? '.active' : ''}`, { onClick: () => { st.type = k; st.cats = []; st.page = 0; drawTarget(); drawFilters(); loadInstalled().then(load); } }, h('span', { html: icon(ic) }), t(label)));
    targetBar.append(tabs);
    if (st.type === 'modpack') {
      targetBar.append(h('div.card.target-bar', null, h('span', { html: icon('info') }), h('span.muted', { text: t('Modpack instaluje się jako nowa instancja – z właściwą wersją gry, loaderem i wszystkimi modami.') })));
      return;
    }
    const inst = target();
    if (!S.instances.length) {
      targetBar.append(h('div.banner.warn', null, h('span.ic', { html: icon('alert') }), h('div.grow', { text: t('Najpierw utwórz instancję, do której zainstalujesz zawartość.') }), btn(t('Nowa instancja'), () => import('./create.js').then((m) => m.openCreate()), { kind: 'primary', icon: 'plus', small: true })));
      return;
    }
    const sel = select(S.instances.map((i) => [i.id, `${i.name} — ${LOADER_NAMES[i.loader]} ${i.mc}`]), st.instanceId, (v) => { st.instanceId = v; st.page = 0; drawTarget(); loadInstalled().then(load); });
    sel.style.minWidth = '280px';
    targetBar.append(h('div.card.target-bar', null,
      inst ? instIcon(inst, 'sm') : null,
      h('span.muted', { text: t('Instaluj do:') }), sel,
      h('div.spacer'),
      inst ? h('span.muted.small', { text: st.anyVersion ? t('pokazuję wszystkie wersje') : t('tylko zgodne z {v}', { v: `${inst.mc}${st.type === 'mod' ? ` · ${LOADER_NAMES[inst.loader]}` : ''}` }) }) : null,
      inst && st.type === 'mod' && inst.loader === 'vanilla' ? h('span.chip.warn', { text: t('Vanilla nie obsługuje modów') }) : null));
  }

  function drawFilters() {
    filters.replaceChildren();
    const chips = h('div.filter-chips');
    for (const c of CATS[st.type] || []) {
      chips.append(h(`button.chip.clickable${st.cats.includes(c) ? '.active' : ''}`, { onClick: () => { st.cats = st.cats.includes(c) ? st.cats.filter((x) => x !== c) : [...st.cats, c]; st.page = 0; drawFilters(); load(); } }, catLabel(c)));
    }
    filters.append(h('div', null, h('h4', { text: t('Kategorie') }), chips));
    if (st.type !== 'modpack') {
      const sw = h('label.row.small', { style: { cursor: 'pointer' } }, h('input', { type: 'checkbox', checked: st.anyVersion, onChange: (e) => { st.anyVersion = e.target.checked; st.page = 0; drawTarget(); load(); } }), t('Pokaż też niezgodne wersje'));
      filters.append(h('div', null, h('h4', { text: t('Zgodność') }), sw));
    }
    filters.append(h('div.card.card-pad.small.muted', null, h('div', { html: `${icon('info')}` }), t('Zawartość pochodzi z Modrinth – otwartej platformy modów. Wymagane zależności instalują się automatycznie.')));
  }

  async function loadInstalled() {
    installed = new Set();
    const inst = target();
    if (!inst || st.type === 'modpack') return;
    try {
      const list = await api('content:list', inst.id, st.type, st.type === 'datapack' ? '*' : undefined);
      for (const i of list) if (i.projectId) installed.add(i.projectId);
    } catch {}
  }

  let req = 0;
  async function load() {
    const my = ++req;
    results.replaceChildren(spinner());
    pager.replaceChildren();
    const inst = target();
    try {
      const r = await api('modrinth:search', {
        query: st.q, type: st.type, sort: st.sort, offset: st.page * 20, limit: 20, categories: st.cats,
        mc: st.type !== 'modpack' && !st.anyVersion ? inst?.mc : undefined,
        loader: st.type === 'mod' && !st.anyVersion ? inst?.loader : undefined,
      });
      if (my !== req) return;
      results.replaceChildren();
      if (!r.hits.length) { results.append(empty('search', t('Nic nie znaleziono'), t('Zmień wyszukiwanie albo filtry.'))); return; }
      for (const p of r.hits) results.append(resultCard(p));
      const pages = Math.ceil(r.total / 20);
      if (pages > 1) {
        pager.append(btn('', () => { st.page--; load(); root.scrollTop = 0; }, { icon: 'chevronLeft', disabled: st.page === 0 }),
          h('span.muted', { text: `${st.page + 1} / ${pages}` }),
          btn('', () => { st.page++; load(); document.getElementById('view').scrollTop = 0; }, { icon: 'chevronRight', disabled: st.page >= pages - 1 }));
      }
    } catch (e) {
      if (my === req) results.replaceChildren(empty('wifiOff', t('Nie udało się połączyć z Modrinth'), e.message, btn(t('Spróbuj ponownie'), load, { icon: 'refresh' })));
    }
  }

  function resultCard(p) {
    const inst = target();
    const isInst = installed.has(p.id);
    const action = st.type === 'modpack'
      ? btn(t('Zainstaluj'), async (e) => { e.stopPropagation(); await installModpack(p); }, { kind: 'primary', icon: 'download', small: true })
      : btn(isInst ? t('Zainstalowane') : t('Zainstaluj'), async (e) => {
        e.stopPropagation();
        if (!inst) { toast(t('Wybierz instancję')); return; }
        const b = e.currentTarget;
        b.disabled = true;
        let world;
        if (st.type === 'datapack') { world = await pickWorld(inst); if (!world) { b.disabled = false; return; } }
        const ok = await installProject({ instance: inst, project: p, type: st.type, world });
        if (ok) { installed.add(p.id); b.replaceChildren(h('span', { text: t('Zainstalowane') })); b.className = 'btn small'; } else b.disabled = false;
      }, { kind: isInst ? '' : 'primary', icon: isInst ? 'check' : 'download', small: true, disabled: isInst || !inst });
    return h('div.card.result', { onClick: () => navigate('project', { id: p.slug || p.id, type: st.type, instanceId: st.instanceId }) },
      h('img.r-icon', { src: p.icon || '', loading: 'lazy', alt: '', onError: (e) => { e.target.style.visibility = 'hidden'; } }),
      h('div.r-main', null,
        h('h3', null, p.title, ' ', h('small', { text: `${t('od')} ${p.author}` })),
        h('p', { text: p.description }),
        h('div.row', { style: { gap: '6px' } }, (p.categories || []).filter((c) => !HIDE_CATS.has(c)).slice(0, 4).map((c) => h('span.chip', { text: catLabel(c) })))),
      h('div.r-side', null,
        h('div.r-stats', null, h('span', { title: t('Pobrania') }, h('span', { html: icon('download') }), fmtNum(p.downloads)), h('span', { title: t('Obserwujący') }, h('span', { html: icon('heart') }), fmtNum(p.follows))),
        h('span.muted.small', { text: `${t('aktualizacja')}: ${fmtAgo(new Date(p.updated).getTime())}` }),
        action));
  }

  drawHead(); drawTarget(); drawFilters();
  loadInstalled().then(load);
  const off = on('instances', () => { if (!target()) { st.instanceId = selectedInstance()?.id || null; drawTarget(); } });
  return off;
});

export async function installModpack(p) {
  try {
    toast(t('Pobieram modpack „{n}”…', { n: p.title }), { icon: 'download' });
    const inst = await api('modrinth:installModpack', { projectId: p.id, title: p.title, icon: p.icon, versionId: p.versionId });
    await refreshInstances();
    navigate('instance', { id: inst.id });
  } catch (e) { toastError(e); }
}
