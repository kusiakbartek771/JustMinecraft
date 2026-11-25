// Galeria: zrzuty ekranu ze wszystkich instancji – podgląd, okładka instancji, kopiowanie, usuwanie.
import { S, api, refreshInstances } from '../state.js';
import { h, btn, iconBtn, empty, spinner, toast, toastError, fmtAgo, fmtBytes, confirmDialog } from '../ui.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { registerView } from '../router.js';

const url = (kind, s) => `jmshot://${kind}/${encodeURIComponent(s.instanceId)}/${encodeURIComponent(s.file)}`;
let filter = '*';

registerView('gallery', async (root) => {
  const head = h('div.page-head', null, h('h1', { text: t('Galeria') }), h('div.spacer'));
  const chips = h('div.filter-chips', { style: { marginBottom: '14px' } });
  const grid = h('div.shot-grid');
  root.append(head, chips, grid);
  grid.append(spinner());
  let shots = [];
  try { shots = await api('gallery:list'); } catch (e) { grid.replaceChildren(empty('alert', e.message, '')); return; }

  function draw() {
    chips.replaceChildren();
    const counts = new Map();
    for (const s of shots) counts.set(s.instanceId, (counts.get(s.instanceId) || 0) + 1);
    const chip = (id, label, n) => h(`button.chip.clickable${filter === id ? '.active' : ''}`, { onClick: () => { filter = id; draw(); } }, `${label} (${n})`);
    chips.append(chip('*', t('Wszystkie'), shots.length));
    for (const [id, n] of counts) chips.append(chip(id, shots.find((s) => s.instanceId === id).instance, n));
    const list = shots.filter((s) => filter === '*' || s.instanceId === filter);
    grid.replaceChildren();
    if (!list.length) { grid.append(empty('image', t('Brak zrzutów ekranu'), t('W grze naciśnij F2 – zrzuty z każdej instancji pojawią się tutaj.'))); return; }
    list.forEach((s, i) => grid.append(h('button.shot', { onClick: () => viewer(list, i) },
      h('img', { src: url('thumb', s), loading: 'lazy', alt: '' }),
      h('div.shot-meta', null, h('span', { text: s.instance }), h('span', { text: fmtAgo(s.date) })))));
  }

  function viewer(list, index) {
    const back = h('div.lightbox');
    const img = h('img');
    const cap = h('div.lb-cap');
    const close = () => { back.remove(); window.removeEventListener('keydown', key); };
    const show = () => {
      const s = list[index];
      img.src = url('full', s);
      cap.replaceChildren(
        h('div.grow', null, h('b', { text: s.instance }), h('div.muted.small', { text: `${s.file} · ${fmtBytes(s.size)} · ${new Date(s.date).toLocaleString()}` })),
        btn(t('Ustaw jako okładkę'), async () => { try { await api('gallery:cover', s.instanceId, s.file); await refreshInstances(); toast(t('Ustawiono okładkę „{n}”', { n: s.instance }), { success: true }); } catch (e) { toastError(e); } }, { small: true, icon: 'image' }),
        btn(t('Kopiuj'), async () => { await api('gallery:copy', s.instanceId, s.file).catch(toastError); toast(t('Skopiowano obraz')); }, { small: true, icon: 'copy' }),
        btn(t('Folder'), () => api('gallery:show', s.instanceId, s.file), { small: true, icon: 'folder' }),
        iconBtn('trash', t('Usuń'), async () => {
          if (!(await confirmDialog({ title: t('Usunąć zrzut?'), text: t('Plik trafi do kosza.'), ok: t('Usuń'), danger: true }))) return;
          await api('gallery:remove', s.instanceId, s.file).catch(toastError);
          shots = shots.filter((x) => x !== s);
          list.splice(index, 1);
          if (!list.length) { close(); draw(); return; }
          index = Math.min(index, list.length - 1);
          show(); draw();
        }, { kind: 'danger' }));
    };
    const step = (d) => { index = (index + d + list.length) % list.length; show(); };
    const key = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') step(1); if (e.key === 'ArrowLeft') step(-1); };
    back.append(
      h('div.lb-stage', { onClick: (e) => { if (e.target === e.currentTarget) close(); } },
        iconBtn('chevronLeft', t('Poprzedni'), () => step(-1)), img, iconBtn('chevronRight', t('Następny'), () => step(1))),
      cap, h('button.lb-x', { html: icon('x'), title: t('Zamknij'), onClick: close }));
    document.body.append(back);
    window.addEventListener('keydown', key);
    show();
  }

  draw();
});
