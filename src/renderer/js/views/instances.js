// Lista instancji: siatka/lista, szukanie, sortowanie, grupowanie, menu kontekstowe.
import { S, api, on, saveSettings, refreshInstances } from '../state.js';
import { h, btn, empty, contextMenu, fmtAgo, fmtDuration, iconBtn, promptDialog, toast, toastError, segmented, select } from '../ui.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { navigate, registerView } from '../router.js';
import { instIcon, coverStyle, loaderChip } from '../components.js';
import { LOADER_NAMES } from '../theme.js';
import { play, removeInstance, launchTask } from '../actions.js';
import { openCreate } from './create.js';

const ui = { q: '', sort: 'recent', group: 'none' };

export function instanceMenu(e, inst) {
  contextMenu(e, [
    { label: S.running.has(inst.id) ? t('Zatrzymaj') : t('Graj'), icon: S.running.has(inst.id) ? 'stop' : 'play', run: () => play(inst) },
    { label: t('Zarządzaj'), icon: 'sliders', run: () => navigate('instance', { id: inst.id }) },
    { label: t('Dodaj mody'), icon: 'plus', run: () => navigate('browse', { instanceId: inst.id }) },
    { label: t('Otwórz folder'), icon: 'folder', run: () => api('instances:open', inst.id) },
    '-',
    { label: inst.favorite ? t('Usuń z ulubionych') : t('Dodaj do ulubionych'), icon: 'star', run: async () => { await api('instances:update', inst.id, { favorite: !inst.favorite }); refreshInstances(); } },
    { label: t('Zmień nazwę'), icon: 'edit', run: async () => { const n = await promptDialog({ title: t('Zmień nazwę'), value: inst.name }); if (n) { await api('instances:update', inst.id, { name: n }); refreshInstances(); } } },
    { label: t('Duplikuj'), icon: 'copy', run: async () => { try { await api('instances:duplicate', inst.id); await refreshInstances(); toast(t('Zduplikowano')); } catch (er) { toastError(er); } } },
    window.jl.platform === 'win32' ? { label: t('Skrót na pulpicie'), icon: 'link', run: async () => { try { await api('instances:shortcut', inst.id); toast(t('Utworzono skrót na pulpicie')); } catch (er) { toastError(er); } } } : null,
    { label: t('Napraw instalację'), icon: 'wrench', run: () => api('instances:repair', inst.id).catch(toastError) },
    '-',
    inst.loader !== 'vanilla' ? { label: t('Test wydajności'), icon: 'gauge', run: () => import('./perf.js').then((m) => m.startBench(inst)) } : null,
    inst.bench ? { label: t('Ostatni wynik testu'), icon: 'gauge', run: () => import('./perf.js').then((m) => m.showBench(inst, inst.bench)) } : null,
    { label: t('Udostępnij kodem'), icon: 'link', run: () => import('./share.js').then((m) => m.shareCode(inst)) },
    { label: t('Eksportuj .mrpack (Modrinth)'), icon: 'package', run: () => import('./share.js').then((m) => m.exportPack(inst, 'mrpack')) },
    { label: t('Eksportuj całą instancję (.zip)'), icon: 'download', run: () => import('./share.js').then((m) => m.exportPack(inst, 'zip')) },
    '-',
    { label: t('Usuń'), icon: 'trash', danger: true, run: () => removeInstance(inst) },
  ]);
}

function card(inst) {
  const running = S.running.has(inst.id);
  const sel = S.settings.selectedInstance === inst.id;
  const busy = launchTask(inst.id);
  return h(`div.card.inst-card${sel ? '.selected' : ''}`, {
    onClick: () => navigate('instance', { id: inst.id }),
    onContextmenu: (e) => instanceMenu(e, inst),
  },
    h('div.inst-cover', { style: { background: coverStyle(inst) } }, instIcon({ ...inst, running })),
    inst.favorite ? h('span.fav', { html: icon('starFill') }) : null,
    h('button.quick-play', { class: running ? 'running' : '', title: running ? t('Zatrzymaj') : t('Graj'), disabled: !!busy, html: busy ? '<div class="spinner small" style="border-top-color:currentColor"></div>' : icon(running ? 'stop' : 'play'), onClick: (e) => { e.stopPropagation(); play(inst); } }),
    h('div.body', null,
      h('h3', { text: inst.name, title: inst.name }),
      h('div.meta', null, h('span.chip', { text: inst.mc }), loaderChip(inst.loader)),
      h('div.foot', null, h('span', { html: icon('clock') }), h('span', { text: inst.lastPlayed ? fmtAgo(inst.lastPlayed) : t('nie grano') }), h('div.spacer'), inst.playTime ? h('span', { text: fmtDuration(inst.playTime) }) : null)));
}

function row(inst) {
  const running = S.running.has(inst.id);
  return h(`div.card.inst-row${S.settings.selectedInstance === inst.id ? '.selected' : ''}`, {
    onClick: () => navigate('instance', { id: inst.id }), onContextmenu: (e) => instanceMenu(e, inst), onDblclick: () => play(inst),
  },
    instIcon({ ...inst, running }),
    h('div.grow', null, h('b', { text: inst.name }), h('div.row', { style: { gap: '6px', marginTop: '4px' } }, h('span.chip', { text: inst.mc }), loaderChip(inst.loader, inst.loaderVersion), inst.group ? h('span.chip', { text: inst.group }) : null)),
    h('span.muted.small', { text: inst.lastPlayed ? fmtAgo(inst.lastPlayed) : t('nie grano') }),
    h('span.muted.small', { style: { width: '90px', textAlign: 'right' }, text: inst.playTime ? fmtDuration(inst.playTime) : '' }),
    btn(running ? t('Stop') : t('Graj'), (e) => { e.stopPropagation(); play(inst); }, { kind: running ? 'danger' : 'primary', icon: running ? 'stop' : 'play', small: true }),
    iconBtn('more', t('Więcej'), (e) => { e.stopPropagation(); instanceMenu(e, inst); }));
}

registerView('instances', (root) => {
  const head = h('div.page-head');
  const listBox = h('div');
  const view = () => S.settings.appearance.instanceView || 'grid';
  head.append(h('h1', { text: t('Instancje') }), h('span.muted', { text: `(${S.instances.length})` }), h('div.spacer'),
    h('div.search-box', null, h('span', { html: icon('search') }), Object.assign(h('input.input', { placeholder: t('Szukaj…'), value: ui.q, onInput: (e) => { ui.q = e.target.value; draw(); } }), {})),
    select([['recent', t('Ostatnio grane')], ['name', t('Nazwa')], ['version', t('Wersja gry')], ['playtime', t('Czas gry')], ['created', t('Data utworzenia')]], ui.sort, (v) => { ui.sort = v; draw(); }),
    select([['none', t('Bez grup')], ['group', t('Grupy')], ['loader', t('Loader')], ['mc', t('Wersja')]], ui.group, (v) => { ui.group = v; draw(); }),
    segmented([['grid', '', 'grid'], ['list', '', 'list']], view(), (v) => { saveSettings({ appearance: { instanceView: v } }); draw(); }),
    btn(t('Nowa'), () => openCreate(), { kind: 'primary', icon: 'plus' }));
  root.append(head, listBox);

  function draw() {
    listBox.replaceChildren();
    let list = S.instances.filter((i) => !ui.q || `${i.name} ${i.mc} ${i.loader} ${i.group}`.toLowerCase().includes(ui.q.toLowerCase()));
    const cmpVer = (a, b) => b.mc.localeCompare(a.mc, undefined, { numeric: true });
    const sorters = {
      recent: (a, b) => (b.favorite - a.favorite) || (b.lastPlayed || b.created) - (a.lastPlayed || a.created),
      name: (a, b) => a.name.localeCompare(b.name, 'pl'),
      version: cmpVer,
      playtime: (a, b) => (b.playTime || 0) - (a.playTime || 0),
      created: (a, b) => b.created - a.created,
    };
    list = list.sort(sorters[ui.sort]);
    if (!S.instances.length) {
      listBox.append(empty('grid', t('Brak instancji'), t('Instancja to osobna instalacja gry z własnymi modami i światami.'), btn(t('Nowa instancja'), () => openCreate(), { kind: 'primary', icon: 'plus' })));
      return;
    }
    if (!list.length) { listBox.append(empty('search', t('Nic nie znaleziono'), '')); return; }
    const groups = new Map();
    for (const i of list) {
      const k = ui.group === 'group' ? (i.group || t('Bez grupy')) : ui.group === 'loader' ? LOADER_NAMES[i.loader] : ui.group === 'mc' ? i.mc : '';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(i);
    }
    for (const [k, items] of groups) {
      if (k) listBox.append(h('div.group-title', { text: `${k} · ${items.length}` }));
      listBox.append(view() === 'grid' ? h('div.inst-grid', null, items.map(card)) : h('div.inst-list', null, items.map(row)));
    }
  }
  draw();
  const offs = [on('instances', draw), on('running', draw), on('tasks', draw)];
  return () => offs.forEach((f) => f());
});
