// Ustawienia: wygląd, gra i wydajność, Java, pobieranie, folder instalacji, aktualizacje, zaawansowane.
import { S, api, saveSettings, emit, on } from '../state.js';
import { h, btn, select, switchEl, slider, setting, section, segmented, input, toast, toastError, confirmDialog, fmtBytes, spinner } from '../ui.js';
import { icon } from '../icons.js';
import { t, LANGS, setLang } from '../i18n.js';
import { registerView, rerender, navigate } from '../router.js';
import { THEMES, FONTS, ACCENTS, applyAppearance } from '../theme.js';
import { installUpdate } from '../shell.js';
import { changeDataDir } from './onboarding.js';

const SECTIONS = [
  ['appearance', 'Wygląd', 'palette'],
  ['game', 'Gra i wydajność', 'gauge'],
  ['java', 'Java', 'coffee'],
  ['downloads', 'Pobieranie', 'download'],
  ['storage', 'Instalacja i dane', 'folder'],
  ['updates', 'Aktualizacje', 'refresh'],
  ['advanced', 'Zaawansowane', 'wrench'],
  ['about', 'O aplikacji', 'info'],
];

let current = 'appearance';

registerView('settings', (root, param) => {
  if (param?.section) current = param.section;
  const nav = h('div.settings-nav');
  const body = h('div');
  const q = h('input.input', { placeholder: t('Szukaj w ustawieniach…'), onInput: () => filter() });
  root.append(h('div.page-head', null, h('h1', { text: t('Ustawienia') }), h('div.spacer'), h('div.search-box', { style: { width: '280px' } }, h('span', { html: icon('search') }), q)),
    h('div.settings-layout', null, nav, body));

  function drawNav() {
    nav.replaceChildren();
    for (const [k, label, ic] of SECTIONS) nav.append(h(`button.nav-item${current === k ? '.active' : ''}`, { onClick: () => { current = k; q.value = ''; drawNav(); draw(); } }, h('span', { html: icon(ic) }), h('span.nav-label', { text: t(label) })));
  }

  function filter() {
    const v = q.value.trim().toLowerCase();
    if (!v) { draw(); return; }
    body.replaceChildren();
    for (const [k] of SECTIONS) renderSection(k, body);
    for (const row of body.querySelectorAll('.setting')) row.classList.toggle('hidden', !row.textContent.toLowerCase().includes(v));
    for (const card of body.querySelectorAll('.settings-card')) card.classList.toggle('hidden', ![...card.querySelectorAll('.setting')].some((r) => !r.classList.contains('hidden')));
  }

  function draw() {
    body.replaceChildren();
    renderSection(current, body);
  }

  drawNav();
  draw();
});

const ap = () => S.settings.appearance;
const setAp = (patch) => { saveSettings({ appearance: patch }); applyAppearance(S.settings.appearance); };

function renderSection(k, body) {
  ({ appearance, game, java, downloads, storage, updates, advanced, about })[k](body);
}

function appearance(body) {
  const a = ap();
  const tiles = h('div.theme-grid');
  for (const [id, th] of Object.entries(THEMES)) {
    tiles.append(h(`button.theme-tile${a.theme === id ? '.active' : ''}`, { onClick: () => { setAp({ theme: id }); rerender(); } },
      h('div.prev', { style: { background: th.bg } }, h('i', { style: { width: '22%', background: th.surface } }), h('i', { style: { flex: 1, background: `linear-gradient(135deg, ${th.g1}, ${th.g2})` } }), h('i', { style: { width: '14%', background: a.customAccent ? a.accent : th.accent } })),
      h('span', { style: { background: th.surface, color: th.text }, text: t(th.name) })));
  }
  const sw = h('div.swatches');
  for (const c of ACCENTS) sw.append(h(`button.swatch${a.customAccent && a.accent === c ? '.active' : ''}`, { style: { background: c }, title: c, onClick: () => { setAp({ accent: c, customAccent: true }); rerender(); } }));
  sw.append(h('input.swatch', { type: 'color', value: a.accent, title: t('Własny kolor'), onChange: (e) => { setAp({ accent: e.target.value, customAccent: true }); rerender(); } }));

  body.append(section(t('Motyw'), tiles),
    section(t('Kolory i tło'),
      setting(t('Kolor akcentu'), t('Przyciski, zaznaczenia i paski postępu'), sw, a.customAccent ? btn(t('Z motywu'), () => { setAp({ customAccent: false }); rerender(); }, { small: true, kind: 'ghost' }) : null),
      setting(t('Tło'), null, segmented([['gradient', t('Gradient')], ['solid', t('Jednolite')], ['image', t('Obraz')]], a.background, (v) => { setAp({ background: v }); rerender(); })),
      a.background === 'image' ? setting(t('Obraz tła'), t('Twój własny obraz (np. zrzut ekranu z gry)'), btn(t('Wybierz…'), async () => { try { const d = await api('dialog:image'); if (d) { setAp({ backgroundImage: d }); rerender(); } } catch (e) { toastError(e); } }, { icon: 'image', small: true })) : null,
      a.background === 'image' ? setting(t('Rozmycie tła'), null, slider(a.backgroundBlur, { min: 0, max: 40, unit: ' px', onInput: (v) => setAp({ backgroundBlur: v }) })) : null,
      a.background === 'image' ? setting(t('Przyciemnienie tła'), null, slider(a.backgroundDim, { min: 0, max: 95, unit: '%', onInput: (v) => setAp({ backgroundDim: v }) })) : null,
      setting(t('Efekt szkła'), t('Półprzezroczyste, rozmyte panele'), switchEl(a.glass, (v) => setAp({ glass: v })))),
    section(t('Układ i tekst'),
      setting(t('Język'), null, select(LANGS, S.settings.language, (v) => { saveSettings({ language: v }); setLang(v); location.reload(); })),
      setting(t('Czcionka'), null, select(FONTS.map(([v, l]) => [v, t(l)]), a.font, (v) => setAp({ font: v }))),
      setting(t('Rozmiar tekstu'), null, slider(a.fontScale, { min: 85, max: 125, step: 5, unit: '%', onChange: (v) => setAp({ fontScale: v }) })),
      setting(t('Zaokrąglenia'), null, slider(a.radius, { min: 0, max: 24, unit: ' px', onInput: (v) => setAp({ radius: v }) })),
      setting(t('Gęstość'), null, segmented([['compact', t('Zwarta')], ['comfortable', t('Normalna')], ['cozy', t('Przestronna')]], a.density, (v) => setAp({ density: v }))),
      setting(t('Panel boczny'), null, segmented([['left', t('Po lewej')], ['right', t('Po prawej')]], a.sidebar, (v) => setAp({ sidebar: v }))),
      setting(t('Kompaktowy panel boczny'), t('Same ikony'), switchEl(a.sidebarCompact, (v) => setAp({ sidebarCompact: v }))),
      setting(t('Animacje'), t('Wyłącz na słabszym komputerze'), switchEl(a.animations, (v) => setAp({ animations: v })))),
    section(t('Własny CSS'),
      setting(t('Arkusz stylów'), t('Dla zaawansowanych – zmienne: --accent, --bg, --surface, --radius…'), (() => {
        const ta = h('textarea.input.mono', { rows: 6, style: { width: 'min(480px, 100%)' }, value: a.customCss || '', placeholder: '.hero h2 { font-size: 3em; }' });
        ta.addEventListener('change', () => setAp({ customCss: ta.value }));
        return ta;
      })())),
    h('div.row', null, btn(t('Przywróć domyślny wygląd'), async () => { if (await confirmDialog({ title: t('Przywrócić domyślny wygląd?'), text: t('Motyw, kolory, tło i czcionki wrócą do ustawień fabrycznych.') })) { S.settings = await api('settings:reset', 'appearance'); applyAppearance(S.settings.appearance); rerender(); } }, { icon: 'refresh', kind: 'ghost' })));
}

async function game(body) {
  const g = S.settings.game;
  const mem = await api('system:memory').catch(() => ({ total: 8192, suggest: 4096 }));
  const presets = await api('jvm:presets').catch(() => ({}));
  const maxMem = Math.max(2048, Math.floor(mem.total / 512) * 512);
  const memRow = g.memory.auto ? null : setting(t('Maksymalna pamięć (RAM)'), t('Komputer ma {n} GB. Zostaw co najmniej 2–3 GB dla systemu.', { n: (mem.total / 1024).toFixed(1) }),
    slider(g.memory.max, { min: 1024, max: maxMem, step: 256, format: (v) => `${(v / 1024).toFixed(1)} GB`, onChange: (v) => saveSettings({ game: { memory: { max: v } } }) }));
  body.append(
    section(t('Pamięć'),
      setting(t('Automatyczna pamięć'), t('Dobiera RAM do liczby modów (np. 4 GB dla 50 modów, 6–8 GB dla dużych modpacków)'), switchEl(g.memory.auto, (v) => saveSettings({ game: { memory: { auto: v } } }).then(() => rerender()))),
      memRow,
      setting(t('Profil JVM'), t('„Zrównoważone” to sprawdzone flagi G1GC – mniej przycięć podczas gry'), select(Object.entries(presets), g.jvmPreset, (v) => saveSettings({ game: { jvmPreset: v } }))),
      setting(t('Dodatkowe argumenty JVM'), t('Dla wszystkich instancji'), input(g.jvmArgs, (v) => saveSettings({ game: { jvmArgs: v } }), { width: '320px', placeholder: '-XX:...' }))),
    section(t('Wydajność'),
      window.jl.platform === 'linux' ? setting(t('Feral GameMode'), t('Uruchamia grę przez gamemoderun (pakiet gamemode)'), switchEl(g.gamemode, (v) => saveSettings({ game: { gamemode: v } }))) : null,
      window.jl.platform === 'linux' ? setting(t('Dedykowana karta graficzna'), t('Laptopy z dwiema kartami (PRIME / NVIDIA Optimus)'), switchEl(g.dedicatedGpu, (v) => saveSettings({ game: { dedicatedGpu: v } }))) : null,
      window.jl.platform === 'linux' ? setting(t('Wrapper'), t('Np. mangohud, prime-run'), input(g.wrapper, (v) => saveSettings({ game: { wrapper: v } }), { width: '200px' })) : null,
      setting(t('Mody wydajnościowe'), t('Każda instancja ma przycisk „Pakiet wydajności” w zakładce Mody (Sodium, Lithium, FerriteCore, ModernFix…)'), btn(t('Przejdź do instancji'), () => navigate('instances'), { small: true }))),
    section(t('Okno gry i launcher'),
      setting(t('Rozdzielczość'), t('0 = domyślna gry'), input(g.resolution.width || '', (v) => saveSettings({ game: { resolution: { width: Number(v) || 0 } } }), { type: 'number', width: '100px', placeholder: '854' }), h('span.muted', { text: '×' }), input(g.resolution.height || '', (v) => saveSettings({ game: { resolution: { height: Number(v) || 0 } } }), { type: 'number', width: '100px', placeholder: '480' })),
      setting(t('Pełny ekran'), null, switchEl(g.resolution.fullscreen, (v) => saveSettings({ game: { resolution: { fullscreen: v } } }))),
      setting(t('Po uruchomieniu gry'), null, select([['keep', t('Zostaw launcher otwarty')], ['minimize', t('Zminimalizuj launcher')], ['hide', t('Ukryj launcher (wróci po zamknięciu gry)')]], g.afterLaunch, (v) => saveSettings({ game: { afterLaunch: v } }))),
      setting(t('Pokaż okno awarii'), t('Czytelne podpowiedzi, gdy gra się wysypie'), switchEl(g.showConsoleOnCrash, (v) => saveSettings({ game: { showConsoleOnCrash: v } })))));
}

async function java(body) {
  const list = h('div.col', null, spinner());
  body.append(section(t('Java'),
    setting(t('Tryb'), t('Automatycznie: launcher pobiera dokładnie tę Javę, której potrzebuje dana wersja gry (8, 17, 21, 25…). Zalecane.'),
      select([['', t('Automatycznie (zalecane)')], ...(S.settings.java.path ? [[S.settings.java.path, S.settings.java.path]] : [])], S.settings.java.path, (v) => saveSettings({ java: { path: v } }).then(rerender)),
      btn(t('Wskaż…'), async () => { try { const j = await api('java:choose'); if (j) { await saveSettings({ java: { path: j.path } }); rerender(); } } catch (e) { toastError(e); } }, { small: true, icon: 'folder' })),
    h('h4.muted', { style: { margin: '14px 0 6px' }, text: t('Java znaleziona w systemie') }), list));
  const found = await api('java:detect').catch(() => []);
  list.replaceChildren();
  if (!found.length) list.append(h('p.muted.small', { text: t('Brak – nic nie szkodzi, launcher pobierze Javę sam.') }));
  for (const j of found) {
    list.append(h('div.content-item', null, h('div.ci-icon', { html: icon('coffee') }), h('div.ci-main', null, h('b', { text: `Java ${j.major} (${j.version})` }), h('small', { text: `${j.vendor || ''} · ${j.arch || ''} · ${j.path}` })),
      btn(S.settings.java.path === j.path ? t('Używana') : t('Użyj globalnie'), () => saveSettings({ java: { path: j.path } }).then(rerender), { small: true, disabled: S.settings.java.path === j.path })));
  }
}

function downloads(body) {
  const d = S.settings.downloads;
  body.append(section(t('Pobieranie'),
    setting(t('Równoległe pobierania'), t('Więcej = szybciej na dobrym łączu'), slider(d.concurrency, { min: 2, max: 48, onChange: (v) => saveSettings({ downloads: { concurrency: v } }) })),
    setting(t('Instaluj wymagane zależności'), t('Np. Fabric API, biblioteki'), switchEl(d.autoDependencies, (v) => saveSettings({ downloads: { autoDependencies: v } }))),
    setting(t('Iris/Oculus razem z shaderami'), t('Shadery wymagają moda – zainstaluje się automatycznie'), switchEl(d.autoShaderLoader, (v) => saveSettings({ downloads: { autoShaderLoader: v } }))),
    setting(t('Pokazuj snapshoty'), t('Wersje testowe Minecrafta na listach wersji'), switchEl(d.showSnapshots, (v) => saveSettings({ downloads: { showSnapshots: v } }))),
    setting(t('Pełna weryfikacja przy naprawie'), t('Liczy sumy SHA1 wszystkich plików (wolniej, dokładniej)'), switchEl(d.verifyOnRepair, (v) => saveSettings({ downloads: { verifyOnRepair: v } })))),
  section('Google Drive',
    setting(t('Klucz API Google (opcjonalnie)'), t('Bez klucza import działa dla publicznych folderów. Klucz z Google Cloud Console (Drive API) daje stabilniejsze listowanie dużych folderów.'), input(S.settings.drive.apiKey, (v) => saveSettings({ drive: { apiKey: v.trim() } }), { width: '300px', placeholder: 'AIza…' }))));
}

async function storage(body) {
  const usage = h('div.col', null, spinner());
  body.append(section(t('Folder instalacji'),
    setting(t('Gdzie launcher trzyma gry'), t('Wersje gry, biblioteki, Java i wszystkie instancje (mody, światy).'), h('div.path-box', { text: S.settings.dataDir })),
    h('div.row', { style: { paddingTop: '6px' } },
      btn(t('Zmień folder…'), () => changeDataDir(), { icon: 'folder' }),
      btn(t('Otwórz'), () => api('shell:showItem', S.settings.dataDir), { icon: 'external', kind: 'ghost' }))),
  section(t('Zajęte miejsce'), usage),
  section(t('Kopia ustawień'),
    setting(t('Eksport ustawień'), t('Plik JSON z wyglądem i opcjami (bez kont)'), btn(t('Eksportuj'), () => api('settings:export').then((r) => r && toast(t('Zapisano'))).catch(toastError), { small: true, icon: 'upload' })),
    setting(t('Import ustawień'), null, btn(t('Importuj'), async () => { try { const s = await api('settings:import'); if (s) { S.settings = s; applyAppearance(s.appearance); toast(t('Zaimportowano ustawienia')); rerender(); } } catch (e) { toastError(e); } }, { small: true, icon: 'download' }))));
  try {
    const u = await api('data:usage');
    const total = Object.values(u).reduce((a, b) => a + b, 0);
    usage.replaceChildren(
      ...[['instances', t('Instancje (mody, światy)')], ['versions', t('Wersje gry')], ['libraries', t('Biblioteki')], ['assets', t('Zasoby (dźwięki, języki)')], ['runtime', 'Java'], ['cache', t('Pamięć podręczna')]].map(([k, l]) =>
        h('div.row.nowrap', null, h('span.grow', { text: l }), h('div.progress', { style: { width: '200px' } }, h('div.progress-fill', { style: { width: `${total ? (u[k] / total) * 100 : 0}%` } })), h('b', { style: { width: '90px', textAlign: 'right' }, text: fmtBytes(u[k]) }))),
      h('div.row', null, h('b.grow', { text: `${t('Razem')}: ${fmtBytes(total)}` }), btn(t('Wyczyść pamięć podręczną'), async () => { await api('data:clearCache'); toast(t('Wyczyszczono')); rerender(); }, { small: true, icon: 'trash' })));
  } catch (e) { usage.replaceChildren(h('p.muted', { text: e.message })); }
}

async function updates(body) {
  const u = S.settings.updates;
  const st = S.update || (await api('update:get').catch(() => ({ status: 'idle' })));
  // odśwież kartę, gdy zmieni się stan aktualizacji (sprawdzanie / pobieranie / gotowa)
  const off = on('update', () => { off(); if (body.isConnected && current === 'updates') rerender(); });
  const statusText = { idle: t('Nie sprawdzano'), checking: t('Sprawdzanie…'), latest: t('Masz najnowszą wersję ✓'), available: t('Dostępna wersja {v}', { v: st.version }), downloading: `${t('Pobieranie')} ${st.progress || 0}%`, ready: t('Gotowa do instalacji: {v}', { v: st.version }), error: `${t('Błąd')}: ${st.error}`, unsupported: t('Automatyczne aktualizacje działają w zainstalowanej wersji (AppImage / instalator / DMG)') }[st.status] || st.status;
  body.append(section(t('Aktualizacje'),
    setting(t('Wersja'), `JustLauncher ${S.info.version}`, h('span.chip', { class: st.status === 'latest' ? 'ok' : '', text: statusText })),
    h('div.row', { style: { padding: '8px 0' } },
      btn(t('Sprawdź teraz'), async () => { await api('update:check').catch(toastError); setTimeout(rerender, 1500); }, { icon: 'refresh' }),
      ['available', 'downloading', 'ready'].includes(st.status) ? btn(t('Zaktualizuj jednym kliknięciem'), () => installUpdate(), { kind: 'primary', icon: 'download' }) : null),
    setting(t('Automatycznie pobieraj i instaluj'), t('Aktualizacja pobierze się w tle i zainstaluje przy zamknięciu launchera'), switchEl(u.auto, (v) => saveSettings({ updates: { auto: v } }))),
    setting(t('Sprawdzaj przy starcie'), null, switchEl(u.checkOnStart, (v) => saveSettings({ updates: { checkOnStart: v } }))),
    setting(t('Kanał'), t('Beta = wcześniejszy dostęp do nowości'), select([['latest', t('Stabilny')], ['beta', 'Beta']], u.channel, (v) => saveSettings({ updates: { channel: v } })))));
}

function advanced(body) {
  const a = S.settings.advanced;
  body.append(section(t('Konto Microsoft'),
    setting(t('Azure Client ID'), t('Potrzebny do logowania Microsoft. Utwórz aplikację w Azure (konta osobiste, „Allow public client flows”) i złóż wniosek o dostęp do API Minecrafta. Instrukcja w README.'), input(a.msClientId, (v) => saveSettings({ advanced: { msClientId: v.trim() } }), { width: '320px', placeholder: '00000000-0000-…' }))),
  section(t('Diagnostyka'),
    setting(t('Narzędzia deweloperskie'), t('Konsola Chromium dla interfejsu launchera'), switchEl(a.devtools, (v) => saveSettings({ advanced: { devtools: v } }))),
    setting(t('Folder danych aplikacji'), S.info.userData, btn(t('Otwórz'), () => api('shell:showItem', S.info.userData), { small: true, icon: 'folder' })),
    setting(t('Zresetuj wszystkie ustawienia'), t('Instancje, konta i pobrane pliki zostaną'), btn(t('Resetuj'), async () => { if (await confirmDialog({ title: t('Zresetować ustawienia?'), text: t('Wszystkie opcje wrócą do domyślnych.'), danger: true, ok: t('Resetuj') })) { S.settings = await api('settings:reset'); applyAppearance(S.settings.appearance); rerender(); } }, { small: true, kind: 'danger' }))));
}

function about(body) {
  body.append(h('div.card.card-pad', { style: { textAlign: 'center', padding: '34px' } },
    h('img', { src: '../../assets/icon.png', style: { width: '96px', height: '96px', borderRadius: '22px' } }),
    h('h2', { style: { margin: '12px 0 4px' }, text: 'JustLauncher' }),
    h('p.muted', { text: `${t('Wersja')} ${S.info.version} · Electron ${S.info.electron} · ${S.info.platform}/${S.info.arch}` }),
    h('p', { style: { maxWidth: '520px', margin: '10px auto' }, text: t('Launcher Minecrafta do modów: Vanilla, Fabric, Quilt, Forge i NeoForge, zawartość z Modrinth, paczki z Google Drive i muzyka z JustMusic.') }),
    h('div.row.center', null,
      btn('GitHub', () => api('shell:open', `https://github.com/${S.info.repo}`), { icon: 'github' }),
      btn(t('Zgłoś problem'), () => api('shell:open', S.info.issuesUrl), { icon: 'alert' }),
      btn('JustMusic', () => navigate('justmusic'), { icon: 'music' })),
    h('p.muted.small', { style: { marginTop: '18px' }, text: t('Nie jest to oficjalny produkt Minecrafta. Nie jest zatwierdzony przez Mojang ani Microsoft ani z nimi powiązany.') })));
}
