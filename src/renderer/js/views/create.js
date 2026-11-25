// Tworzenie instancji: nazwa, ikona, wersja gry, loader i jego wersja; import folderu lub .mrpack.
import { S, api, getVersions, refreshInstances } from '../state.js';
import { h, modal, btn, input, select, switchEl, toast, toastError, segmented, spinner } from '../ui.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { navigate } from '../router.js';
import { instIcon, EMOJIS, shortLoaderVersion } from '../components.js';
import { LOADER_COLORS, LOADER_NAMES } from '../theme.js';

const LOADERS = ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'];
const LOADER_DESC = { vanilla: 'czysta gra', fabric: 'lekki, szybki', quilt: 'fork Fabrica', forge: 'klasyka modów', neoforge: 'nowy Forge' };

export function openCreate(preset = {}) {
  const st = { name: '', nameTouched: false, icon: preset.icon || null, mc: preset.mc || null, loader: preset.loader || 'fabric', loaderVersion: null, group: '', showSnapshots: !!S.settings.downloads.showSnapshots, supported: {}, mode: 'new' };
  modal(async (body, close) => {
    body.append(spinner());
    let versions;
    try { versions = await getVersions(); } catch (e) { body.replaceChildren(h('p', { text: e.message })); return; }
    st.mc ||= versions.latest.release;
    // które loadery obsługują jakie wersje (w tle)
    for (const l of LOADERS.slice(1)) api('loaders:supported', l).then((list) => { st.supported[l] = list ? new Set(list) : null; drawLoaders(); }).catch(() => {});

    const preview = h('div');
    const nameIn = input('', (v) => { st.name = v; st.nameTouched = true; drawPreview(); }, { placeholder: t('Nazwa instancji'), live: true });
    const verBox = h('div');
    const loaderBox = h('div.choice-grid');
    const lvBox = h('div');
    const autoName = () => `${st.loader !== 'vanilla' ? `${LOADER_NAMES[st.loader]} ` : ''}${st.mc}`;

    function drawPreview() {
      preview.replaceChildren(instIcon({ name: st.name || autoName(), icon: st.icon, loader: st.loader }, 'lg'));
      if (!st.nameTouched) nameIn.placeholder = autoName();
    }

    function drawVersions() {
      verBox.replaceChildren();
      const list = versions.versions.filter((v) => v.type === 'release' || (st.showSnapshots && v.type === 'snapshot') || v.id === st.mc);
      const sel = select(list.map((v) => [v.id, `${v.id}${v.type === 'snapshot' ? ` (${t('snapshot')})` : ''}${v.id === versions.latest.release ? ` – ${t('najnowsza')}` : ''}`]), st.mc, (v) => { st.mc = v; st.loaderVersion = null; drawLoaders(); drawLoaderVersions(); drawPreview(); });
      sel.style.flex = '1';
      verBox.append(h('div.row.nowrap', null, sel, h('label.row.nowrap.small.muted', null, switchEl(st.showSnapshots, (v) => { st.showSnapshots = v; drawVersions(); }), t('snapshoty'))));
    }

    function drawLoaders() {
      loaderBox.replaceChildren();
      for (const l of LOADERS) {
        const sup = l === 'vanilla' || !st.supported[l] || st.supported[l].has(st.mc);
        const el = h(`button.choice${st.loader === l ? '.active' : ''}`, {
          disabled: !sup, style: sup ? null : { opacity: '.4', cursor: 'not-allowed' },
          title: sup ? '' : t('Niedostępny dla tej wersji'),
          onClick: () => { st.loader = l; st.loaderVersion = null; drawLoaders(); drawLoaderVersions(); drawPreview(); },
        }, h('span.loader-dot', { style: { background: `linear-gradient(135deg, ${LOADER_COLORS[l]}, color-mix(in srgb, ${LOADER_COLORS[l]} 40%, #000))` } }), LOADER_NAMES[l], h('small', { text: sup ? t(LOADER_DESC[l]) : t('brak dla {v}', { v: st.mc }) }));
        loaderBox.append(el);
      }
    }

    let lvReq = 0;
    async function drawLoaderVersions() {
      lvBox.replaceChildren();
      if (st.loader === 'vanilla') return;
      const my = ++lvReq;
      lvBox.append(h('div.row', null, spinner(true), h('span.muted.small', { text: t('Wczytywanie wersji loadera…') })));
      try {
        const list = await api('loaders:versions', st.loader, st.mc);
        if (my !== lvReq) return;
        lvBox.replaceChildren();
        if (!list.length) { lvBox.append(h('p.muted.small', { text: t('{l} nie jest dostępny dla Minecrafta {v}', { l: LOADER_NAMES[st.loader], v: st.mc }) })); return; }
        const opts = [['', t('Zalecana (automatycznie)')], ...list.slice(0, 200).map((v) => [v.version, `${shortLoaderVersion(st.loader, v.version)}${v.recommended ? ` ★ ${t('zalecana')}` : v.stable ? '' : ` (${t('beta')})`}`])];
        lvBox.append(h('label.lbl', { text: t('Wersja loadera') }), select(opts, st.loaderVersion || '', (v) => { st.loaderVersion = v || null; }));
      } catch (e) { if (my === lvReq) lvBox.replaceChildren(h('p.muted.small', { text: e.message })); }
    }

    const emojiRow = h('div.emoji-grid', null, EMOJIS.slice(0, 30).map((e) => h('button', { type: 'button', text: e, onClick: () => { st.icon = e; drawPreview(); } })));
    const iconTools = h('div.row', null,
      btn(t('Obraz…'), async () => { try { const d = await api('dialog:image'); if (d) { st.icon = d; drawPreview(); } } catch (e) { toastError(e); } }, { small: true, icon: 'image' }),
      btn(t('Bez ikony'), () => { st.icon = null; drawPreview(); }, { small: true, kind: 'ghost' }));

    const create = async () => {
      try {
        const inst = await api('instances:create', { name: st.name || autoName(), icon: st.icon, mc: st.mc, loader: st.loader, loaderVersion: st.loaderVersion, group: st.group });
        await refreshInstances();
        close();
        toast(t('Utworzono „{name}” – pobieram pliki gry w tle', { name: inst.name }), { success: true });
        navigate('instance', { id: inst.id });
      } catch (e) { toastError(e); }
    };

    const importFolder = async () => {
      try {
        const inst = await api('instances:importFolder', { name: st.name || t('Zaimportowana'), mc: st.mc, loader: st.loader, loaderVersion: st.loaderVersion, icon: st.icon });
        if (!inst) return;
        await refreshInstances();
        close();
        toast(t('Zaimportowano – mody, światy i ustawienia zostały skopiowane'), { success: true });
        navigate('instance', { id: inst.id });
      } catch (e) { toastError(e); }
    };

    const importPack = async () => {
      try {
        const inst = await api('mrpack:import');
        if (!inst) return;
        await refreshInstances();
        close();
        navigate('instance', { id: inst.id });
      } catch (e) { toastError(e); }
    };

    body.replaceChildren(h('div.form', null,
      h('div.row.nowrap', { style: { gap: '18px', alignItems: 'flex-start' } }, preview,
        h('div.col.grow', null, h('div.field', null, h('label.lbl', { text: t('Nazwa') }), nameIn), emojiRow, iconTools)),
      h('div.field', null, h('label.lbl', { text: t('Wersja Minecrafta') }), verBox),
      h('div.field', null, h('label.lbl', { text: t('Loader modów') }), loaderBox),
      lvBox,
      h('div.field', null, h('label.lbl', { text: t('Grupa (opcjonalnie)') }), input('', (v) => { st.group = v; }, { placeholder: t('np. Survival, Testy'), live: true })),
      h('div.row', { style: { justifyContent: 'space-between', marginTop: '6px' } },
        h('div.row', null,
          btn(t('Importuj folder'), importFolder, { icon: 'folder', kind: 'ghost', title: t('Skopiuj mody, światy i ustawienia z .minecraft albo innego launchera') }),
          btn(t('Importuj .mrpack'), importPack, { icon: 'upload', kind: 'ghost' })),
        btn(t('Utwórz i zainstaluj'), create, { kind: 'primary', icon: 'check' }))));
    drawPreview(); drawVersions(); drawLoaders(); drawLoaderVersions();
    setTimeout(() => nameIn.focus(), 60);
  }, { title: t('Nowa instancja'), icon: 'plus', wide: true });
}
