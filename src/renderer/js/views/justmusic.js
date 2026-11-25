// JustMusic: połączenie z odtwarzaczem, sterowanie, playlisty i automatyczna muzyka do gry.
import { S, api, on, saveSettings } from '../state.js';
import { h, btn, iconBtn, empty, spinner, select, switchEl, slider, setting, section, toast, toastError, input } from '../ui.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { registerView } from '../router.js';

const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

registerView('justmusic', (root) => {
  const head = h('div.page-head', null, h('h1', null, 'JustMusic'), h('span.muted', { text: t('muzyka do grania') }));
  const status = h('div');
  const player = h('div');
  const auto = h('div');
  root.append(head, status, player, auto);
  let info = null;

  async function drawStatus() {
    try { info = await api('jm:status'); } catch { info = null; }
    status.replaceChildren();
    const j = S.settings.justmusic;
    if (!j.enabled) {
      status.append(h('div.banner.warn', null, h('span.ic', { html: icon('info') }), h('div.grow', { text: t('Integracja z JustMusic jest wyłączona.') }), btn(t('Włącz'), () => saveSettings({ justmusic: { enabled: true } }).then(() => setTimeout(drawAll, 300)), { kind: 'primary', small: true })));
      return;
    }
    const steps = h('div.card.card-pad', null,
      h('div.row', null, h('span.status-dot', { class: S.jm.connected ? 'on' : '' }), h('b', { text: S.jm.connected ? t('Połączono z JustMusic') : t('JustMusic nie jest połączony') }), h('div.spacer'),
        !S.jm.connected && info?.path ? btn(t('Uruchom JustMusic'), () => api('jm:launch').then(() => toast(t('Uruchamiam JustMusic…'))).catch(toastError), { icon: 'play', kind: 'primary', small: true }) : null,
        btn(info?.pluginInstalled ? t('Zainstaluj wtyczkę ponownie') : t('Zainstaluj wtyczkę'), async () => {
          try { await api('jm:installPlugin'); toast(t('Wtyczka „Minecraft” skopiowana. W JustMusic: Ustawienia → Pluginy → Przeładuj i włącz „Minecraft”.'), { success: true, duration: 9000 }); drawStatus(); } catch (e) { toastError(e); }
        }, { icon: 'puzzle', small: true })));
    if (!S.jm.connected) {
      steps.append(h('ol.muted', { style: { margin: '12px 0 0', paddingLeft: '20px', lineHeight: 1.8 } },
        h('li', null, info?.installed ? t('JustMusic jest zainstalowany ✓') : h('span', null, t('Zainstaluj JustMusic: '), h('a', { href: '#', onClick: (e) => { e.preventDefault(); api('shell:open', 'https://github.com/kusiakbartek771/JustMusic/releases/latest'); }, text: 'github.com/kusiakbartek771/JustMusic' }))),
        h('li', { text: info?.pluginInstalled ? t('Wtyczka „Minecraft” jest skopiowana ✓') : t('Kliknij „Zainstaluj wtyczkę” (albo zainstaluj „Minecraft” ze sklepu pluginów w JustMusic).') }),
        h('li', { text: t('W JustMusic włącz wtyczkę „Minecraft” (Ustawienia → Pluginy). Połączenie nawiąże się samo.') })));
    }
    status.append(steps);
  }

  let lastKey = null, lastPlaying = null;
  function drawPlayer() {
    player.replaceChildren();
    const s = S.jm.state;
    if (!S.jm.connected || !s) return;
    const tr = s.track;
    const key = `${tr?.title}|${tr?.artist}`;
    const changed = lastKey !== null && key !== lastKey;
    const swapped = lastPlaying !== null && lastPlaying !== !!s.playing;
    lastKey = key; lastPlaying = !!s.playing;
    const pct = s.duration ? ((s.time || 0) / s.duration) * 100 : 0;
    player.append(h(`div.card.jm-hero${changed ? '.np-change' : ''}`, { style: { marginTop: '16px' } },
      h('div.jm-art', { style: tr?.thumb ? { backgroundImage: `url("${tr.thumb}")` } : null, html: tr?.thumb ? '' : icon('music') }),
      h('div.grow', null,
        h('div.muted.small', { text: s.playing ? t('Teraz gra') : t('Wstrzymano') }),
        h('h2', { style: { margin: '4px 0', fontSize: '1.6em' }, text: tr?.title || t('Nic nie gra') }),
        h('div.muted', { text: tr?.artist || '' }),
        h('div.row.nowrap', { style: { marginTop: '14px' } }, h('span.small.muted', { text: fmt(s.time) }), h('div.progress.grow', null, h('div.progress-fill', { style: { width: `${pct}%` } })), h('span.small.muted', { text: fmt(s.duration) })),
        h('div.jm-controls', null,
          iconBtn('shuffle', t('Losowo'), () => api('jm:cmd', 'shuffle').catch(toastError)),
          iconBtn('prev', t('Poprzedni'), () => api('jm:cmd', 'prev').catch(toastError)),
          h(`button.icon-btn.big${swapped ? '.icon-swap' : ''}`, { title: t('Graj/Pauza'), html: icon(s.playing ? 'pause' : 'play'), onClick: () => api('jm:cmd', 'toggle').catch(toastError) }),
          iconBtn('next', t('Następny'), () => api('jm:cmd', 'next').catch(toastError)),
          h('div.spacer'),
          h('span', { html: icon('volume') }),
          h('div', { style: { width: '300px' } }, slider(Math.round((s.volume ?? 1) * 100), { min: 0, max: 100, unit: '%', onChange: (v) => api('jm:cmd', 'volume', { value: v / 100 }).catch(toastError) }))))));
    if (s.playlists?.length) {
      const grid = h('div.playlist-grid');
      const cur = S.settings.justmusic.playlistId;
      for (const p of s.playlists) {
        grid.append(h(`div.pl-item${cur === p.id ? '.active' : ''}`, { title: t('Kliknij: graj · Prawy przycisk: ustaw jako muzykę do gry'),
          onClick: () => api('jm:cmd', 'play-playlist', { id: p.id }).catch(toastError),
          onContextmenu: (e) => { e.preventDefault(); saveSettings({ justmusic: { playlistId: p.id, playlistName: p.name, onGameStart: 'playlist' } }).then(() => { toast(t('„{n}” będzie grać przy starcie gry', { n: p.name }), { success: true }); drawAll(); }); } },
          h('div.pl-art', { style: p.thumb ? { backgroundImage: `url("${p.thumb}")` } : null, html: p.thumb ? '' : icon('music') }),
          h('div.grow', { style: { minWidth: 0 } }, h('b.ellipsis', { style: { display: 'block' }, text: p.name }), h('small.muted', { text: `${p.count ?? ''} ${t('utworów')}` }))));
      }
      player.append(h('div.card.card-pad', { style: { marginTop: '16px' } }, h('h3.card-title', null, h('span', { html: icon('list') }), t('Playlisty')), grid));
    }
  }

  function drawAuto() {
    auto.replaceChildren();
    const j = S.settings.justmusic;
    const pls = S.jm.state?.playlists || [];
    const plOpts = pls.length ? pls.map((p) => [p.id, p.name]) : j.playlistId ? [[j.playlistId, j.playlistName || j.playlistId]] : [['', t('(połącz JustMusic, aby wybrać)')]];
    auto.append(h('div', { style: { height: '16px' } }), section(t('Muzyka do gry'),
      setting(t('Integracja z JustMusic'), t('Lokalne połączenie z odtwarzaczem (tylko ten komputer)'), switchEl(j.enabled, (v) => saveSettings({ justmusic: { enabled: v } }).then(() => setTimeout(drawAll, 300)))),
      setting(t('Gdy gra się uruchomi'), null, select([['none', t('Nic nie rób')], ['resume', t('Wznów muzykę')], ['playlist', t('Graj playlistę')]], j.onGameStart, (v) => saveSettings({ justmusic: { onGameStart: v } }).then(drawAuto))),
      j.onGameStart === 'playlist' ? setting(t('Playlista'), t('Odtwarzana losowo przy starcie gry'), select(plOpts, j.playlistId, (v) => saveSettings({ justmusic: { playlistId: v, playlistName: pls.find((p) => p.id === v)?.name || '' } }))) : null,
      setting(t('Gdy gra się zamknie'), null, select([['none', t('Nic nie rób')], ['pause', t('Wstrzymaj muzykę')]], j.onGameExit, (v) => saveSettings({ justmusic: { onGameExit: v } }))),
      setting(t('Głośność podczas gry'), t('0 = bez zmian. Po wyjściu z gry wraca poprzednia głośność.'), slider(j.volumeInGame, { min: 0, max: 100, step: 5, format: (v) => (v ? `${v}%` : t('bez zmian')), onChange: (v) => saveSettings({ justmusic: { volumeInGame: v } }) })),
      setting(t('Uruchamiaj JustMusic z grą'), t('Jeśli JustMusic nie jest otwarty, launcher go uruchomi'), switchEl(j.autostart, (v) => saveSettings({ justmusic: { autostart: v } }))),
      setting(t('„Teraz gra” w panelu bocznym'), null, switchEl(j.showNowPlaying, (v) => saveSettings({ justmusic: { showNowPlaying: v } }))),
      setting(t('Ścieżka do JustMusic'), info?.path || t('nie znaleziono – wskaż ręcznie'), btn(t('Wybierz…'), () => api('jm:choosePath').then(drawStatus).catch(toastError), { small: true, icon: 'folder' })),
      setting(t('Port połączenia'), t('Zmień tylko, jeśli jest zajęty. Ten sam port ustaw we wtyczce.'), input(j.port, (v) => saveSettings({ justmusic: { port: Math.max(1024, Math.min(65535, Number(v) || 47851)) } }), { type: 'number', width: '110px' }))));
  }

  function drawAll() { drawStatus(); drawPlayer(); drawAuto(); }
  drawAll();
  let last = 0;
  const offs = [on('jm', () => {
    const now = Date.now();
    if (now - last < 500) return;
    last = now;
    drawPlayer();
    if (!S.jm.connected || !status.querySelector('.status-dot.on')) drawStatus();
  }), on('jm-connection', () => drawAll())];
  return () => offs.forEach((f) => f());
});
