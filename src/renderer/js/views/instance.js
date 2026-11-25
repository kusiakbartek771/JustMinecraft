// Strona instancji: zawartość (mody, resource packi, shadery, datapacki), światy, konsola, ustawienia.
import { S, api, on, emit, refreshInstances, saveSettings } from '../state.js';
import { h, btn, iconBtn, empty, spinner, switchEl, contextMenu, toast, toastError, fmtBytes, fmtAgo, fmtDuration, input, select, slider, setting, section, segmented, confirmDialog, debounce, progressBar, setProgress } from '../ui.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { navigate, registerView, back } from '../router.js';
import { instIcon, coverStyle, loaderChip, EMOJIS, shortLoaderVersion } from '../components.js';
import { LOADER_NAMES, LOADER_COLORS } from '../theme.js';
import { play, removeInstance, launchTask, pickWorld } from '../actions.js';
import { instanceMenu } from './instances.js';
import { consoleView } from './console.js';

const CONTENT_TABS = [['mod', 'Mody', 'puzzle'], ['resourcepack', 'Resource packi', 'image'], ['shader', 'Shadery', 'sun'], ['datapack', 'Datapacki', 'map']];

registerView('instance', async (root, param) => {
  const id = param?.id;
  let inst = S.instances.find((i) => i.id === id);
  if (!inst) { root.append(empty('alert', t('Nie ma takiej instancji'), '', btn(t('Wróć'), () => navigate('instances')))); return; }
  if (S.settings.selectedInstance !== id) saveSettings({ selectedInstance: id });
  let tab = param.tab || 'content';
  let ctype = param.ctype || 'mod';
  const cleanups = [];

  const headBox = h('div');
  const tabsBox = h('div.tabs');
  const body = h('div');
  root.append(headBox, tabsBox, body);

  function drawHead() {
    inst = S.instances.find((i) => i.id === id) || inst;
    const running = S.running.has(id);
    const busy = launchTask(id);
    const playB = btn(busy ? busy.status : running ? t('Zatrzymaj') : t('Graj'), () => play(inst), { kind: running ? 'danger' : 'primary', icon: running ? 'stop' : 'play', disabled: !!busy });
    playB.style.minWidth = '150px';
    headBox.replaceChildren(h('div.inst-head', null,
      h('div.art', { style: { background: coverStyle(inst) } }),
      iconBtn('arrowLeft', t('Wstecz'), () => back()),
      instIcon({ ...inst, running }, 'lg'),
      h('div.grow', null,
        h('h1', { text: inst.name }),
        h('div.row', { style: { gap: '6px', marginTop: '8px' } },
          h('span.chip', null, h('span', { html: icon('cube') }), `Minecraft ${inst.mc}`),
          loaderChip(inst.loader, inst.loaderVersion),
          inst.playTime ? h('span.chip', null, h('span', { html: icon('clock') }), fmtDuration(inst.playTime)) : null,
          inst.drive ? h('span.chip.accent.clickable', { title: t('Synchronizuj z Google Drive'), onClick: () => syncDrive() }, h('span', { html: icon('drive') }), t('Google Drive')) : null,
          inst.group ? h('span.chip', { text: inst.group }) : null),
        busy ? h('div', { style: { marginTop: '10px', maxWidth: '420px' } }, progressBar(busy.progress?.total ? (busy.progress.done / busy.progress.total) * 100 : null)) : null),
      h('div.row', null,
        iconBtn('folder', t('Otwórz folder'), () => api('instances:open', id)),
        iconBtn('more', t('Więcej'), (e) => instanceMenu(e, inst)),
        playB)));
  }

  async function syncDrive() {
    try { const r = await api('drive:sync', id); toast(t('Zsynchronizowano: +{a} / −{r}', { a: r.added.length, r: r.removed.length }), { success: true }); emit('content-changed', id); } catch (e) { toastError(e); }
  }

  function drawTabs() {
    tabsBox.replaceChildren();
    const tabs = [['content', t('Zawartość'), 'box'], ['worlds', t('Światy'), 'globe'], ['console', t('Konsola'), 'terminal'], ['settings', t('Ustawienia'), 'sliders']];
    for (const [k, label, ic] of tabs) {
      tabsBox.append(h(`button.tab${tab === k ? '.active' : ''}`, { onClick: () => { tab = k; drawTabs(); drawBody(); } }, h('span', { html: icon(ic) }), label));
    }
  }

  function drawBody() {
    while (cleanups.length) cleanups.pop()();
    body.replaceChildren();
    if (tab === 'content') contentTab(body);
    else if (tab === 'worlds') worldsTab(body);
    else if (tab === 'console') cleanups.push(consoleView(body, inst));
    else settingsTab(body);
  }

  // ---------- zawartość ----------
  function contentTab(box) {
    const sub = h('div.row', { style: { marginBottom: '12px' } });
    const toolbar = h('div.content-toolbar');
    const list = h('div.card', { style: { padding: '6px' } });
    box.append(sub, toolbar, list);
    let items = [];
    let updates = {};
    let q = '';
    let world = ctype === 'datapack' ? (param.world || '*') : null;
    const selected = new Set();

    for (const [k, label, ic] of CONTENT_TABS) {
      sub.append(h(`button.chip.clickable${ctype === k ? '.active' : ''}`, { style: { height: '32px', padding: '0 14px' }, onClick: () => { ctype = k; drawBody(); } }, h('span', { html: icon(ic) }), t(label)));
    }

    async function load(silent) {
      if (!silent) list.replaceChildren(spinner());
      try {
        if (ctype === 'datapack' && !world) world = '*';
        items = await api('content:list', id, ctype, world);
        draw();
        // nieznane pliki – spróbuj rozpoznać na Modrinth (nazwy, ikony, aktualizacje)
        if (items.some((i) => i.sha1 && !i.projectId) && !silent) {
          api('content:identify', id, ctype, world).then(async (n) => { if (n) { items = await api('content:list', id, ctype, world); draw(); } }).catch(() => {});
        }
      } catch (e) { list.replaceChildren(empty('alert', t('Błąd'), e.message)); }
    }

    async function drawToolbar() {
      toolbar.replaceChildren(
        h('div.search-box', { style: { width: '240px' } }, h('span', { html: icon('search') }), h('input.input', { placeholder: t('Szukaj…'), value: q, onInput: (e) => { q = e.target.value; draw(); } })));
      if (ctype === 'datapack') {
        let worlds = [];
        try { worlds = await api('instances:worlds', id); } catch {}
        toolbar.append(select([['*', `🌍 ${t('Wszystkie światy (globalne)')}`], ...worlds.map((w) => [w.name, `🗺️ ${w.name}`])], world, (v) => { world = v; load(); }));
      }
      toolbar.append(h('div.spacer'),
        btn(t('Odkrywaj'), () => navigate('browse', { instanceId: id, type: ctype }), { icon: 'compass', kind: 'primary' }),
        btn(t('Z pliku'), async () => {
          try {
            const r = await api('content:addFiles', id, null, ctype, world);
            const ok = r.filter((x) => x.added).length;
            if (ok) toast(t('Dodano plików: {n}', { n: ok }), { success: true });
            for (const x of r.filter((y) => !y.added)) toast(`${x.file}: ${x.kind === 'modpack' ? t('to modpack – zaimportuj go jako nową instancję') : t('nieznany typ pliku')}`, { error: true });
            load();
          } catch (e) { toastError(e); }
        }, { icon: 'upload' }),
        btn(t('Aktualizacje'), checkUpdates, { icon: 'refresh' }),
        ctype === 'mod' && inst.loader !== 'vanilla' ? btn(t('Pakiet wydajności'), perfPack, { icon: 'zap', title: t('Sodium/Embeddium, Lithium, FerriteCore, ModernFix i inne') }) : null,
        iconBtn('folder', t('Otwórz folder'), () => api('instances:open', id, ctype === 'datapack' ? (world === '*' ? 'datapacks' : `saves/${world}/datapacks`) : { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' }[ctype])));
    }

    async function perfPack() {
      try {
        const r = await api('modrinth:performance', id);
        toast(t('Zainstalowano mody wydajnościowe: {n}', { n: r.ok.length }) + (r.skipped.length ? ` · ${t('niedostępne dla tej wersji')}: ${r.skipped.join(', ')}` : ''), { success: true, duration: 7000 });
        load(true);
      } catch (e) { toastError(e); }
    }

    async function checkUpdates() {
      try {
        toast(t('Sprawdzam aktualizacje…'));
        updates = await api('content:checkUpdates', id, ctype, world);
        const n = Object.keys(updates).length;
        if (!n) toast(t('Wszystko jest aktualne'), { success: true });
        else toast(t('Dostępne aktualizacje: {n}', { n }), { action: { label: t('Aktualizuj wszystko'), run: updateAll } });
        draw();
      } catch (e) { toastError(e); }
    }

    async function updateAll(only) {
      const list2 = items.filter((i) => updates[i.sha1] && (!only || only.includes(i.sha1))).map((i) => ({ projectId: updates[i.sha1].projectId, versionId: updates[i.sha1].versionId }));
      if (!list2.length) return;
      try { await api('content:update', id, ctype, world, list2); toast(t('Zaktualizowano: {n}', { n: list2.length }), { success: true }); updates = {}; load(true); } catch (e) { toastError(e); }
    }

    function draw() {
      list.replaceChildren();
      const shown = items.filter((i) => !q || `${i.name} ${i.file} ${i.modId || ''}`.toLowerCase().includes(q.toLowerCase()));
      if (!items.length) {
        const label = { mod: t('modów'), resourcepack: t('resource packów'), shader: t('shaderów'), datapack: t('datapacków') }[ctype];
        list.append(empty(CONTENT_TABS.find((c) => c[0] === ctype)[2], t('Brak {x}', { x: label }), ctype === 'mod' && inst.loader === 'vanilla' ? t('Vanilla nie obsługuje modów – zmień loader w ustawieniach instancji.') : t('Pobierz z Odkrywaj, przeciągnij pliki do okna albo zaimportuj z Google Drive.'),
          btn(t('Odkrywaj'), () => navigate('browse', { instanceId: id, type: ctype }), { kind: 'primary', icon: 'compass' })));
        return;
      }
      const enabledCount = items.filter((i) => i.enabled).length;
      const upd = items.filter((i) => updates[i.sha1]).length;
      const bar = h('div.row', { style: { padding: '6px 10px 10px', borderBottom: '1px solid var(--border)', marginBottom: '4px' } },
        h('input.chk', { type: 'checkbox', checked: selected.size && selected.size === shown.length, onChange: (e) => { selected.clear(); if (e.target.checked) shown.forEach((i) => selected.add(i.file)); draw(); } }),
        h('span.muted.small', { text: selected.size ? t('Zaznaczono: {n}', { n: selected.size }) : `${items.length} · ${t('włączone')}: ${enabledCount}` }),
        h('div.spacer'),
        upd ? btn(t('Aktualizuj wszystko ({n})', { n: upd }), () => updateAll(), { small: true, kind: 'primary', icon: 'download' }) : null,
        selected.size ? btn(t('Włącz'), () => bulk(true), { small: true }) : null,
        selected.size ? btn(t('Wyłącz'), () => bulk(false), { small: true }) : null,
        selected.size ? btn(t('Usuń'), () => bulkRemove(), { small: true, kind: 'danger', icon: 'trash' }) : null);
      list.append(bar);
      const frag = document.createDocumentFragment();
      for (const it of shown) frag.append(itemRow(it));
      list.append(frag);
    }

    async function bulk(enabled) {
      for (const f of selected) {
        const it = items.find((i) => i.file === f);
        if (it && it.enabled !== enabled) await api('content:toggle', id, ctype, world, f, enabled).catch(toastError);
      }
      selected.clear();
      load(true);
    }
    async function bulkRemove() {
      if (!(await confirmDialog({ title: t('Usunąć zaznaczone ({n})?', { n: selected.size }), text: t('Pliki trafią do kosza.'), ok: t('Usuń'), danger: true }))) return;
      await api('content:remove', id, ctype, world, [...selected]).catch(toastError);
      selected.clear();
      load(true);
    }

    function itemRow(it) {
      const up = updates[it.sha1];
      const ic = h('div.ci-icon', null, it.icon ? h('img', { src: it.icon, loading: 'lazy', onError: (e) => { e.target.replaceWith(h('span', { html: icon('puzzle') })); } }) : h('span', { html: icon(it.folder ? 'folder' : CONTENT_TABS.find((c) => c[0] === ctype)[2]) }));
      const row = h(`div.content-item${it.enabled ? '' : '.disabled'}`, {
        onContextmenu: (e) => contextMenu(e, [
          { label: it.enabled ? t('Wyłącz') : t('Włącz'), icon: it.enabled ? 'eye' : 'check', run: () => toggle(it, !it.enabled) },
          it.slug || it.projectId ? { label: t('Strona projektu'), icon: 'external', run: () => navigate('project', { id: it.projectId || it.slug, instanceId: id, type: ctype }) } : null,
          up ? { label: t('Aktualizuj do {v}', { v: up.number }), icon: 'download', run: () => updateAll([it.sha1]) } : null,
          { label: t('Pokaż w folderze'), icon: 'folder', run: () => api('shell:showItem', it.path) },
          '-',
          { label: t('Usuń'), icon: 'trash', danger: true, run: () => removeOne(it) },
        ]),
      },
        h('input.chk', { type: 'checkbox', checked: selected.has(it.file), onChange: (e) => { if (e.target.checked) selected.add(it.file); else selected.delete(it.file); draw(); } }),
        ic,
        h('div.ci-main', null,
          h('b', { text: it.name, title: it.description || it.name }),
          h('small', { text: [it.version, it.authors?.length ? it.authors.slice(0, 2).join(', ') : null, it.file].filter(Boolean).join(' · ') })),
        it.broken ? h('span.chip.warn', { text: t('uszkodzony') }) : null,
        it.source === 'drive' ? h('span.chip', { title: 'Google Drive', html: icon('drive') }) : null,
        up ? h('button.chip.ok.clickable', { title: t('Aktualizuj do {v}', { v: up.number }), onClick: () => updateAll([it.sha1]) }, h('span', { html: icon('download') }), up.number.slice(0, 18)) : null,
        h('span.muted.small', { style: { width: '70px', textAlign: 'right' }, text: it.folder ? t('folder') : fmtBytes(it.size) }),
        switchEl(it.enabled, (v) => toggle(it, v)),
        iconBtn('trash', t('Usuń'), () => removeOne(it), { kind: 'danger' }));
      return row;
    }

    async function toggle(it, enabled) {
      try { it.file = await api('content:toggle', id, ctype, world, it.file, enabled); it.enabled = enabled; draw(); } catch (e) { toastError(e); load(true); }
    }
    async function removeOne(it) {
      try { await api('content:remove', id, ctype, world, it.file); items = items.filter((x) => x !== it); draw(); toast(t('Usunięto {n}', { n: it.name })); } catch (e) { toastError(e); }
    }

    drawToolbar();
    load();
    const off = on('content-changed', (iid) => { if (iid === id) load(true); });
    cleanups.push(off);
  }

  // ---------- światy ----------
  async function worldsTab(box) {
    box.append(spinner());
    let worlds = [];
    try { worlds = await api('instances:worlds', id); } catch (e) { box.replaceChildren(empty('alert', e.message, '')); return; }
    box.replaceChildren();
    if (!worlds.length) { box.append(empty('globe', t('Brak światów'), t('Uruchom grę i stwórz świat – pojawi się tutaj.'))); return; }
    const grid = h('div.inst-grid');
    for (const w of worlds) {
      grid.append(h('div.card.inst-card', { onClick: () => api('instances:open', id, `saves/${w.name}`) },
        h('div.inst-cover', { style: { background: w.icon ? `url("${w.icon}") center/cover` : coverStyle(inst), imageRendering: 'pixelated' } }),
        h('div.body', { style: { paddingTop: '14px' } }, h('h3', { text: w.name }),
          h('div.foot', null, h('span', { text: fmtAgo(w.lastPlayed) }), h('div.spacer'), h('span.chip', { text: `${w.datapacks} ${t('datapacków')}` })),
          h('div.row', null,
            btn(t('Datapacki'), (e) => { e.stopPropagation(); ctype = 'datapack'; tab = 'content'; param.world = w.name; drawTabs(); drawBody(); }, { small: true, icon: 'map' }),
            btn(t('Folder'), (e) => { e.stopPropagation(); api('instances:open', id, `saves/${w.name}`); }, { small: true, icon: 'folder' })))));
    }
    box.append(grid);
  }

  // ---------- ustawienia instancji ----------
  async function settingsTab(box) {
    const upd = async (patch) => {
      try { inst = await api('instances:update', id, patch); await refreshInstances(); drawHead(); } catch (e) { toastError(e); }
    };
    const presets = await api('jvm:presets').catch(() => ({}));
    const mem = await api('system:memory').catch(() => ({ total: 8192 }));

    // ogólne
    const iconRow = h('div.emoji-grid', { style: { maxWidth: '420px' } }, EMOJIS.slice(0, 20).map((e) => h('button', { type: 'button', text: e, onClick: () => upd({ icon: e }) })));
    box.append(section(t('Ogólne'),
      setting(t('Nazwa'), null, input(inst.name, (v) => v.trim() && upd({ name: v.trim() }), { width: '280px' })),
      setting(t('Ikona'), t('Emoji, obraz albo inicjał'), iconRow, btn(t('Obraz…'), async () => { const d = await api('dialog:image').catch(toastError); if (d) upd({ icon: d }); }, { small: true, icon: 'image' }), btn(t('Reset'), () => upd({ icon: null }), { small: true, kind: 'ghost' })),
      setting(t('Okładka'), t('Obraz w tle nagłówka i karty'), btn(t('Wybierz…'), async () => { const d = await api('dialog:image').catch(toastError); if (d) upd({ cover: d }); }, { small: true, icon: 'image' }), inst.cover ? btn(t('Usuń'), () => upd({ cover: null }), { small: true, kind: 'ghost' }) : null),
      setting(t('Kolor'), t('Używany w wygenerowanej okładce i ikonie'), h('input.swatch', { type: 'color', value: inst.color || LOADER_COLORS[inst.loader], onChange: (e) => upd({ color: e.target.value }) }), btn(t('Domyślny'), () => upd({ color: null }), { small: true, kind: 'ghost' })),
      setting(t('Grupa'), null, input(inst.group || '', (v) => upd({ group: v.trim() }), { width: '220px', placeholder: t('brak') })),
      setting(t('Notatki'), null, (() => { const ta = h('textarea.input', { rows: 2, style: { width: '320px' }, value: inst.notes || '' }); ta.addEventListener('change', () => upd({ notes: ta.value })); return ta; })())));

    // wersja
    const verSel = h('div.row');
    const versions = await api('versions:list').catch(() => null);
    const loaderSel = select(Object.entries(LOADER_NAMES), inst.loader, async (v) => {
      if (!(await confirmDialog({ title: t('Zmienić loader?'), text: t('Mody dla innego loadera przestaną działać. Światy i ustawienia zostaną.'), ok: t('Zmień') }))) { loaderSel.value = inst.loader; return; }
      await upd({ loader: v, loaderVersion: null });
      drawBody();
    });
    const lv = h('div');
    if (inst.loader !== 'vanilla') {
      api('loaders:versions', inst.loader, inst.mc).then((list) => {
        lv.append(select([['', t('Zalecana')], ...list.slice(0, 200).map((x) => [x.version, shortLoaderVersion(inst.loader, x.version) + (x.recommended ? ' ★' : '')])], inst.loaderVersion || '', (v) => upd({ loaderVersion: v || null })));
      }).catch(() => {});
    }
    if (versions) {
      const vs = select(versions.versions.filter((v) => v.type === 'release' || v.id === inst.mc || S.settings.downloads.showSnapshots).map((v) => [v.id, v.id]), inst.mc, async (v) => {
        if (!(await confirmDialog({ title: t('Zmienić wersję na {v}?', { v }), text: t('Mody mogą nie działać z nową wersją, a świat otwarty w nowszej wersji nie zadziała w starszej. Zrób kopię (Duplikuj), jeśli nie masz pewności.'), ok: t('Zmień') }))) { vs.value = inst.mc; return; }
        await upd({ mc: v, loaderVersion: null });
        drawBody();
      });
      verSel.append(vs);
    }
    box.append(section(t('Wersja'),
      setting(t('Minecraft'), t('Zmiana wersji pobierze potrzebne pliki przy następnym uruchomieniu'), verSel),
      setting(t('Loader'), null, loaderSel),
      inst.loader !== 'vanilla' ? setting(t('Wersja loadera'), null, lv) : null,
      setting(t('Napraw instalację'), t('Sprawdza sumy kontrolne i pobiera ponownie uszkodzone pliki gry'), btn(t('Napraw'), () => api('instances:repair', id).then(() => toast(t('Naprawianie w tle…'))).catch(toastError), { icon: 'wrench' }))));

    // pamięć i Java
    const memOverride = !!inst.memory;
    const memBox = h('div');
    const drawMem = () => {
      memBox.replaceChildren();
      if (!inst.memory) return;
      memBox.append(slider(inst.memory.max, { min: 1024, max: Math.max(2048, Math.floor(mem.total / 512) * 512), step: 256, format: (v) => `${(v / 1024).toFixed(1)} GB`, onChange: (v) => upd({ memory: { min: Math.min(inst.memory.min || 512, v), max: v } }) }));
    };
    drawMem();
    const javaBox = h('div.row');
    const drawJava = () => {
      javaBox.replaceChildren(h('span.muted.small.ellipsis', { style: { maxWidth: '300px' }, text: inst.javaPath || t('Automatycznie (zalecane)') }),
        btn(t('Wykryj…'), async () => {
          const list = await api('java:detect').catch(() => []);
          contextMenu({ preventDefault() {}, stopPropagation() {}, clientX: innerWidth / 2, clientY: innerHeight / 2 }, [
            { label: t('Automatycznie (zalecane)'), icon: 'sparkles', run: () => upd({ javaPath: null }).then(drawJava) },
            ...list.map((j) => ({ label: `Java ${j.major} · ${j.vendor || ''} · ${j.path}`.slice(0, 90), icon: 'coffee', run: () => upd({ javaPath: j.path }).then(drawJava) })),
            { label: t('Wskaż plik…'), icon: 'folder', run: async () => { const j = await api('java:choose').catch(toastError); if (j) upd({ javaPath: j.path }).then(drawJava); } },
          ]);
        }, { small: true, icon: 'coffee' }));
    };
    drawJava();
    box.append(section(t('Wydajność i Java'),
      setting(t('Własna ilość pamięci'), t('Wyłączone = ustawienie globalne (auto dobiera RAM do liczby modów)'), switchEl(memOverride, (v) => { upd({ memory: v ? { min: 512, max: S.settings.game.memory.max || 4096 } : null }).then(drawMem); })),
      memBox,
      setting(t('Profil JVM'), t('Ustawienia odśmiecacza pamięci Javy'), select([['', t('Globalny')], ...Object.entries(presets)], inst.jvmPreset || '', (v) => upd({ jvmPreset: v || null }))),
      setting(t('Java'), t('Launcher sam pobiera właściwą Javę dla wersji gry'), javaBox),
      setting(t('Argumenty JVM'), t('Dodatkowe, np. -Dfml.earlyprogresswindow=false'), input(inst.jvmArgs || '', (v) => upd({ jvmArgs: v }), { width: '320px', placeholder: '-XX:...' })),
      setting(t('Argumenty gry'), null, input(inst.gameArgs || '', (v) => upd({ gameArgs: v }), { width: '320px' })),
      window.jl.platform === 'linux' ? setting(t('Wrapper'), t('Polecenie przed Javą, np. mangohud albo prime-run'), input(inst.wrapper || '', (v) => upd({ wrapper: v }), { width: '220px', placeholder: 'mangohud' })) : null));

    // okno i serwer
    const res = inst.resolution || {};
    box.append(section(t('Okno gry'),
      setting(t('Własna rozdzielczość'), t('Puste = globalna'), input(res.width || '', (v) => upd({ resolution: { ...res, width: Number(v) || 0 } }), { type: 'number', width: '100px', placeholder: '854' }), h('span.muted', { text: '×' }), input(res.height || '', (v) => upd({ resolution: { ...res, height: Number(v) || 0 } }), { type: 'number', width: '100px', placeholder: '480' })),
      setting(t('Pełny ekran'), null, switchEl(!!res.fullscreen, (v) => upd({ resolution: { ...res, fullscreen: v } }))),
      setting(t('Automatyczne dołączanie do serwera'), t('Gra od razu połączy się z tym serwerem'), input(inst.quickJoin || '', (v) => upd({ quickJoin: v.trim() }), { width: '260px', placeholder: 'play.example.com' }))));

    if (inst.drive) {
      box.append(section(t('Google Drive'),
        setting(t('Źródło'), inst.drive.link, btn(t('Synchronizuj'), () => syncDrive(), { icon: 'refresh' })),
        setting(t('Ostatnia synchronizacja'), fmtAgo(inst.drive.synced), btn(t('Odłącz'), () => upd({ drive: null }).then(drawBody), { small: true, kind: 'ghost' }))));
    }

    box.append(section(t('Strefa zagrożenia'),
      setting(t('Duplikuj instancję'), t('Kopia z modami, światami i ustawieniami'), btn(t('Duplikuj'), async () => { await api('instances:duplicate', id).catch(toastError); refreshInstances(); toast(t('Zduplikowano')); }, { icon: 'copy' })),
      setting(t('Usuń instancję'), t('Folder trafi do kosza'), btn(t('Usuń'), async () => { if (await removeInstance(inst)) navigate('instances'); }, { kind: 'danger', icon: 'trash' }))));
  }

  drawHead(); drawTabs(); drawBody();
  const offs = [on('instances', drawHead), on('tasks', drawHead), on('running', drawHead)];
  return () => { offs.forEach((f) => f()); while (cleanups.length) cleanups.pop()(); };
});
