// Okno świata: mapa z góry (przesuwanie, powiększanie, gracz i spawn), informacje, statystyki i kopie zapasowe.
import { api, emit } from '../state.js';
import { h, btn, iconBtn, modal, spinner, empty, toast, toastError, fmtBytes, fmtAgo, fmtDuration, confirmDialog, segmented } from '../ui.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';

export function openWorld(inst, worldName) {
  modal((body) => {
    body.style.padding = '0';
    const wrap = h('div.world-view');
    const mapBox = h('div.world-map', null, spinner());
    const side = h('div.world-side', null, spinner());
    wrap.append(mapBox, side);
    body.append(wrap);
    let info = null;
    let dimension = 'overworld';

    async function loadInfo() {
      try { info = await api('worlds:info', inst.id, worldName); } catch (e) { side.replaceChildren(empty('alert', e.message, '')); return; }
      drawSide();
    }

    function stat(label, value) { return h('div.wstat', null, h('small.muted', { text: label }), h('b', { text: value ?? '—' })); }

    function drawSide() {
      const s = info.stats;
      side.replaceChildren(
        h('h2', { style: { margin: '0 0 2px' }, text: info.levelName || worldName }),
        h('div.row', { style: { gap: '6px', marginBottom: '12px', flexWrap: 'wrap' } },
          info.version ? h('span.chip', { text: `Minecraft ${info.version}` }) : null,
          info.gameMode ? h('span.chip', { text: t(info.gameMode) + (info.hardcore ? ' · hardcore' : '') }) : null,
          info.cheats ? h('span.chip', { text: t('komendy') }) : null,
          h('span.chip', { text: fmtBytes(info.size) })),
        h('div.wstats', null,
          stat(t('Ostatnio'), info.lastPlayed ? fmtAgo(info.lastPlayed) : null),
          stat(t('Dzień w grze'), info.days),
          s ? stat(t('Czas gry'), fmtDuration(s.playTicks * 50)) : null,
          s ? stat(t('Śmierci'), s.deaths) : null,
          s ? stat(t('Zabite moby'), s.mobKills) : null,
          s ? stat(t('Przebyty dystans'), `${s.distanceKm} km`) : null,
          s ? stat(t('Wykopane bloki'), s.blocksMined) : null,
          s ? stat(t('Skoki'), s.jumps) : null),
        info.seed ? h('div.row', { style: { margin: '10px 0' } }, h('span.muted.small', { text: t('Seed:') }), h('code.mono', { text: info.seed }),
          iconBtn('copy', t('Kopiuj seed'), () => { navigator.clipboard.writeText(info.seed); toast(t('Skopiowano seed')); })) : null,
        h('h3', { style: { margin: '16px 0 8px' } }, t('Kopie zapasowe')),
        h('p.muted.small', { style: { margin: '0 0 8px' }, text: t('Launcher robi kopię sam po wyjściu z gry (Ustawienia → Instalacja i dane). Przywrócenie najpierw zapisuje obecny stan.') }),
        h('div.row', { style: { marginBottom: '10px' } },
          btn(t('Zrób kopię teraz'), async () => {
            try { await api('worlds:backup', inst.id, worldName); toast(t('Kopia gotowa'), { success: true }); loadInfo(); } catch (e) { toastError(e); }
          }, { kind: 'primary', icon: 'shield', small: true }),
          btn(t('Folder kopii'), () => api('worlds:showBackups', inst.id, worldName), { icon: 'folder', small: true, kind: 'ghost' })),
        backupList());
    }

    function backupList() {
      if (!info.backups.length) return h('p.muted.small', { text: t('Brak kopii.') });
      const list = h('div.col', { style: { gap: '4px' } });
      for (const b of info.backups) {
        list.append(h('div.backup-row', null,
          h('span', { html: icon(b.auto ? 'clock' : 'shield') }),
          h('div.grow', null, h('div', { text: new Date(b.date).toLocaleString() }), h('small.muted', { text: `${fmtBytes(b.size)} · ${b.note ? t(b.note) : b.auto ? t('automatyczna') : t('ręczna')}` })),
          btn(t('Przywróć'), async () => {
            if (!(await confirmDialog({ title: t('Przywrócić kopię?'), text: t('Świat „{w}” wróci do stanu z {d}. Obecny stan zapiszę jako osobną kopię, więc nic nie przepadnie.', { w: worldName, d: new Date(b.date).toLocaleString() }), ok: t('Przywróć') }))) return;
            try { await api('worlds:restore', inst.id, worldName, b.file); toast(t('Przywrócono świat'), { success: true }); emit('worlds-changed', inst.id); loadInfo(); loadMap(true); } catch (e) { toastError(e); }
          }, { small: true }),
          iconBtn('trash', t('Usuń kopię'), async () => {
            if (!(await confirmDialog({ title: t('Usunąć kopię?'), text: new Date(b.date).toLocaleString(), ok: t('Usuń'), danger: true }))) return;
            await api('worlds:removeBackup', inst.id, worldName, b.file).catch(toastError);
            loadInfo();
          }, { kind: 'danger' })));
      }
      return list;
    }

    // ---------- mapa ----------
    let view = { x: 0, y: 0, k: 1 };
    async function loadMap(force) {
      const bar = h('div.progress', { style: { width: '220px' } }, h('div.progress-fill', { style: { width: '0%' } }));
      mapBox.replaceChildren(h('div.col', { style: { alignItems: 'center', gap: '10px', margin: 'auto' } }, spinner(), h('span.muted.small', { text: t('Rysuję mapę świata…') }), bar));
      const off = window.jl.on('worlds:mapProgress', (m) => { if (m.world === worldName) bar.firstChild.style.width = `${Math.round(m.p * 100)}%`; });
      let m;
      try { m = await api('worlds:map', inst.id, worldName, { dimension, force }); } catch (e) { off(); mapBox.replaceChildren(empty('alert', t('Nie udało się narysować mapy'), e.message)); return; } finally { off(); }
      if (m.empty) { mapBox.replaceChildren(empty('map', t('Brak terenu'), t('Ten wymiar nie był jeszcze odwiedzony.'))); drawMapTools(); return; }
      const img = h('img', { src: m.url, draggable: false });
      const layer = h('div.map-layer', null, img);
      const mark = (pos, cls, title) => {
        if (!pos) return;
        const px = pos.x - m.minX, pz = pos.z - m.minZ;
        if (px < 0 || pz < 0 || px > m.width || pz > m.height) return;
        layer.append(h(`div.map-pin.${cls}`, { title, style: { left: `${px}px`, top: `${pz}px` } }));
      };
      if (dimension === 'overworld') { mark(m.spawn, 'spawn', t('Spawn')); mark(m.player, 'player', t('Gracz')); }
      const coords = h('div.map-coords.mono');
      mapBox.replaceChildren(layer, coords);
      drawMapTools(m);
      const fit = () => {
        const r = mapBox.getBoundingClientRect();
        const c = { x: m.width / 2, z: m.height / 2 };
        view.k = Math.max(0.08, Math.min(2, Math.min((r.width - 40) / m.width, (r.height - 40) / m.height)));
        view.x = r.width / 2 - c.x * view.k; view.y = r.height / 2 - c.z * view.k;
        apply();
      };
      const apply = () => { layer.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`; layer.style.setProperty('--pin', `${1 / view.k}`); };
      requestAnimationFrame(fit);
      let drag = null;
      mapBox.onmousedown = (e) => { drag = { x: e.clientX - view.x, y: e.clientY - view.y }; mapBox.classList.add('dragging'); };
      window.addEventListener('mouseup', () => { drag = null; mapBox.classList.remove('dragging'); });
      mapBox.onmousemove = (e) => {
        const r = mapBox.getBoundingClientRect();
        const bx = Math.floor((e.clientX - r.left - view.x) / view.k + m.minX), bz = Math.floor((e.clientY - r.top - view.y) / view.k + m.minZ);
        coords.textContent = `X ${bx}  Z ${bz}`;
        if (drag) { view.x = e.clientX - drag.x; view.y = e.clientY - drag.y; apply(); }
      };
      mapBox.onwheel = (e) => {
        e.preventDefault();
        const r = mapBox.getBoundingClientRect();
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        const k2 = Math.max(0.08, Math.min(8, view.k * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
        view.x = mx - ((mx - view.x) * k2) / view.k; view.y = my - ((my - view.y) * k2) / view.k; view.k = k2;
        apply();
      };
    }

    function drawMapTools(m) {
      const tools = h('div.map-tools', null,
        segmented([['overworld', t('Świat')], ['nether', 'Nether'], ['end', 'End']], dimension, (v) => { dimension = v; loadMap(); }),
        iconBtn('refresh', t('Odśwież mapę'), () => loadMap(true)),
        m ? h('span.muted.small', { text: t('{r} z {t} regionów · kółko: powiększenie', { r: m.regions, t: m.totalRegions }) }) : null);
      mapBox.append(tools);
    }

    loadInfo();
    loadMap();
  }, { title: worldName, icon: 'globe', full: true });
}
