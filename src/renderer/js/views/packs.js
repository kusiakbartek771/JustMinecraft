// Paczki: polecane paczki autora (Google Drive), import z dowolnego linku Drive, pliki .mrpack.
import { S, api, getVersions, refreshInstances, selectedInstance } from '../state.js';
import { h, btn, empty, spinner, select, input, toast, toastError, modal, segmented, fmtAgo } from '../ui.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { navigate, registerView } from '../router.js';
import { loaderChip, instIcon } from '../components.js';
import { LOADER_NAMES } from '../theme.js';

registerView('packs', (root) => {
  root.append(h('div.page-head', null, h('h1', { text: t('Paczki i Google Drive') }), h('div.spacer'),
    btn(t('Importuj modpack (.mrpack / .zip)'), async () => { try { const i = await api('mrpack:import'); if (i) { await refreshInstances(); navigate('instance', { id: i.id }); } } catch (e) { toastError(e); } }, { icon: 'upload' }),
    btn(t('Import z linku Drive'), () => driveDialog(), { kind: 'primary', icon: 'drive' })));

  const featured = h('div');
  root.append(h('h3.card-title', null, h('span', { html: icon('star') }), t('Paczki autora')), featured);
  loadPacks(featured);

  const linked = S.instances.filter((i) => i.drive);
  if (linked.length) {
    root.append(h('h3.card-title', { style: { marginTop: '24px' } }, h('span', { html: icon('refresh') }), t('Instancje połączone z Google Drive')));
    const box = h('div.inst-list');
    for (const i of linked) {
      box.append(h('div.card.inst-row', { onClick: () => navigate('instance', { id: i.id }) }, instIcon(i), h('div.grow', null, h('b', { text: i.name }), h('div.muted.small', { text: `${t('synchronizacja')}: ${fmtAgo(i.drive.synced)}` })),
        btn(t('Synchronizuj'), async (e) => { e.stopPropagation(); try { const r = await api('drive:sync', i.id); toast(t('Zsynchronizowano: +{a} / −{r}', { a: r.added.length, r: r.removed.length }), { success: true }); } catch (er) { toastError(er); } }, { small: true, icon: 'refresh' })));
    }
    root.append(box);
  }

  root.append(h('div.card.card-pad', { style: { marginTop: '24px' } },
    h('h3.card-title', null, h('span', { html: icon('info') }), t('Jak udostępnić swoje mody wszystkim')),
    h('ol.muted', { style: { margin: 0, paddingLeft: '20px', lineHeight: 1.8 } },
      h('li', { text: t('Wrzuć mody na Google Drive do jednego folderu (możesz zrobić podfoldery mods, config, resourcepacks, shaderpacks).') }),
      h('li', { text: t('Udostępnij → „Każda osoba mająca link” → Kopiuj link.') }),
      h('li', { text: t('Każdy może wkleić link w „Import z linku Drive” – launcher sam rozpozna mody, resource packi i shadery.') }),
      h('li', { text: t('Żeby paczka pojawiła się wszystkim w „Paczki autora”, dopisz ją do packs/packs.json w repozytorium na GitHubie.') }),
      h('li', { text: t('Gdy dodasz albo usuniesz pliki w folderze, gracze klikają „Synchronizuj” – pobiorą się tylko zmiany.') }))));
});

async function loadPacks(box) {
  box.replaceChildren(spinner());
  try {
    const data = await api('drive:packs');
    box.replaceChildren();
    if (!data.packs?.length) {
      box.append(h('div.card', null, empty('drive', t('Brak polecanych paczek'), t('Autor nie dodał jeszcze paczek. Możesz zaimportować dowolny publiczny folder Google Drive.'), btn(t('Import z linku Drive'), () => driveDialog(), { icon: 'drive', kind: 'primary' }))));
      return;
    }
    const grid = h('div.pack-grid');
    for (const p of data.packs) {
      const existing = S.instances.find((i) => i.source?.packId === p.id);
      grid.append(h('div.card.pack', null,
        h('div.pack-art', { style: { background: p.cover ? `url("${p.cover}") center/cover` : `linear-gradient(135deg, var(--g1), var(--g2))` } }),
        h('div.row.nowrap', null, p.icon && /^https?:/.test(p.icon) ? h('img', { src: p.icon, style: { width: '56px', height: '56px', borderRadius: '14px' } }) : h('div.inst-icon', { style: { width: '56px', height: '56px', fontSize: '28px', background: 'var(--elevated)' }, text: p.icon || '📦' }),
          h('div.grow', null, h('h3', { text: p.name }), h('div.row', { style: { gap: '6px', marginTop: '6px' } }, h('span.chip', { text: p.mc }), loaderChip(p.loader), p.version ? h('span.chip', { text: `v${p.version}` }) : null))),
        h('p.muted', { style: { margin: 0 }, text: p.description || '' }),
        h('div.row', { style: { marginTop: 'auto' } },
          existing
            ? btn(t('Aktualizuj'), async () => { try { const r = await api('drive:sync', existing.id); toast(t('Zsynchronizowano: +{a} / −{r}', { a: r.added.length, r: r.removed.length }), { success: true }); } catch (e) { toastError(e); } }, { icon: 'refresh', kind: 'primary' })
            : btn(t('Zainstaluj'), () => installPack(p), { icon: 'download', kind: 'primary' }),
          existing ? btn(t('Otwórz'), () => navigate('instance', { id: existing.id }), { icon: 'chevronRight' }) : null)));
    }
    box.append(grid);
  } catch (e) { box.replaceChildren(empty('wifiOff', t('Nie udało się wczytać paczek'), e.message)); }
}

async function installPack(p) {
  try {
    toast(t('Instaluję paczkę „{n}”…', { n: p.name }), { icon: 'download' });
    const r = await api('drive:import', { link: p.drive, name: p.name, mc: p.mc, loader: p.loader || 'vanilla', loaderVersion: p.loaderVersion || null, icon: p.icon && !/^https?:/.test(p.icon) ? p.icon : null, packId: p.id });
    await refreshInstances();
    toast(t('Paczka zainstalowana: {n} plików', { n: r.report.added.length }), { success: true });
    navigate('instance', { id: r.instanceId });
  } catch (e) { toastError(e); }
}

export function driveDialog(preset = {}) {
  const st = { link: preset.link || '', mode: S.instances.length ? 'existing' : 'new', instanceId: selectedInstance()?.id, name: '', mc: null, loader: 'fabric' };
  modal(async (body, close) => {
    const versions = await getVersions().catch(() => null);
    st.mc ||= versions?.latest.release || '1.21.1';
    const targetBox = h('div');
    const drawTarget = () => {
      targetBox.replaceChildren();
      if (st.mode === 'existing') {
        targetBox.append(select(S.instances.map((i) => [i.id, `${i.name} (${LOADER_NAMES[i.loader]} ${i.mc})`]), st.instanceId, (v) => { st.instanceId = v; }));
      } else {
        targetBox.append(h('div.form', null,
          h('div.field', null, h('label.lbl', { text: t('Nazwa nowej instancji') }), input(st.name, (v) => { st.name = v; }, { live: true, placeholder: t('Paczka z Google Drive') })),
          h('div.two', null,
            h('div.field', null, h('label.lbl', { text: t('Wersja Minecrafta') }), select((versions?.versions || []).filter((v) => v.type === 'release').map((v) => [v.id, v.id]), st.mc, (v) => { st.mc = v; })),
            h('div.field', null, h('label.lbl', { text: t('Loader') }), select(Object.entries(LOADER_NAMES), st.loader, (v) => { st.loader = v; })))));
      }
    };
    const linkIn = input(st.link, (v) => { st.link = v; }, { live: true, placeholder: 'https://drive.google.com/drive/folders/…' });
    body.append(h('div.form', null,
      h('div.field', null, h('label.lbl', { text: t('Link do folderu lub pliku Google Drive') }), linkIn, h('small.muted', { style: { marginTop: '6px' }, text: t('Folder musi być udostępniony jako „Każda osoba mająca link”. Pliki .jar trafią do mods, a .zip zostaną rozpoznane jako resource pack, shader, datapack albo paczka.') })),
      h('div.field', null, h('label.lbl', { text: t('Dokąd zaimportować') }), segmented([['existing', t('Istniejąca instancja')], ['new', t('Nowa instancja')]].filter((x) => x[0] === 'new' || S.instances.length), st.mode, (v) => { st.mode = v; drawTarget(); })),
      targetBox,
      h('div.row', { style: { justifyContent: 'flex-end' } }, btn(t('Importuj'), async () => {
        if (!st.link.trim()) { toast(t('Wklej link'), { error: true }); return; }
        try {
          close();
          toast(t('Importuję z Google Drive…'), { icon: 'drive' });
          const r = await api('drive:import', st.mode === 'existing' ? { link: st.link.trim(), instanceId: st.instanceId } : { link: st.link.trim(), name: st.name || null, mc: st.mc, loader: st.loader });
          await refreshInstances();
          toast(t('Zaimportowano plików: {n}', { n: r.report.added.length }) + (r.report.skipped.length ? ` · ${t('pominięto')}: ${r.report.skipped.length}` : ''), { success: true });
          navigate('instance', { id: r.instanceId });
        } catch (e) { toastError(e); }
      }, { kind: 'primary', icon: 'download' }))));
    drawTarget();
    setTimeout(() => linkIn.focus(), 60);
  }, { title: t('Import z Google Drive'), icon: 'drive', wide: true });
}
