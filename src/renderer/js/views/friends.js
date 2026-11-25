// „Graj ze znajomymi” – e4mc: świat otwarty w sieci LAN dostaje publiczny adres, bez przekierowania portów.
import { api, emit, on } from '../state.js';
import { h, btn, modal, spinner, toast, toastError } from '../ui.js';
import { t } from '../i18n.js';
import { play } from '../actions.js';

export async function playWithFriends(inst) {
  let has = false;
  try { has = (await api('content:list', inst.id, 'mod')).some((m) => /e4mc/i.test(m.modId || m.slug || m.file)); } catch {}
  let off = null;
  modal((body, close) => {
    const status = h('div');
    const addr = h('div');
    const draw = async () => {
      status.replaceChildren(has
        ? h('div.banner', null, h('span', { text: '✅' }), h('div', { text: t('e4mc jest zainstalowany w tej instancji.') }))
        : h('div.banner.warn', null, h('span', { text: '🧩' }), h('div.grow', { text: t('Potrzebny jest mały mod e4mc (z Modrinth) – zainstaluję go jednym kliknięciem.') }),
          btn(t('Zainstaluj e4mc'), async (e) => {
            e.currentTarget.disabled = true;
            status.append(spinner());
            try { await api('modrinth:install', { instanceId: inst.id, projectId: 'e4mc', type: 'mod', title: 'e4mc' }); has = true; emit('content-changed', inst.id); toast(t('Zainstalowano e4mc'), { success: true }); } catch (er) { toastError(er); }
            draw();
          }, { kind: 'primary', icon: 'download', small: true })));
      const d = await api('e4mc:domain', inst.id).catch(() => null);
      addr.replaceChildren(d ? h('div.card.card-pad', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
        h('div.grow', null, h('small.muted', { text: t('Adres dla znajomych') }), h('div.mono', { style: { fontSize: '1.1em' }, text: d })),
        btn(t('Kopiuj'), () => { navigator.clipboard.writeText(d); toast(t('Skopiowano')); }, { icon: 'copy', kind: 'primary' })) : '');
    };
    off = on('e4mc', (m) => { if (m.instanceId === inst.id) draw(); });
    body.append(status,
      h('ol', { style: { lineHeight: '1.9', paddingLeft: '20px' } },
        h('li', { text: t('Kliknij „Graj” i wejdź do swojego świata.') }),
        h('li', { text: t('Naciśnij Esc → „Otwórz w sieci LAN” → „Rozpocznij”.') }),
        h('li', { text: t('Launcher sam skopiuje adres (np. abc-def.eu.e4mc.link) – wyślij go znajomym.') }),
        h('li', { text: t('Znajomi: Tryb wieloosobowy → Dodaj serwer → wklej adres. Muszą mieć te same mody – wyślij im kod paczki (menu instancji → „Udostępnij kodem”).') })),
      addr,
      h('p.muted.small', { text: t('Serwer działa, dopóki masz otwartą grę. e4mc to darmowa usługa społeczności – połączenie idzie przez jej serwer przekaźnikowy.') }),
      h('div.row', { style: { justifyContent: 'flex-end', marginTop: '8px' } }, btn(t('Graj'), () => { close(); play(inst); }, { kind: 'primary', icon: 'play' })));
    draw();
  }, { title: t('Graj ze znajomymi'), icon: 'users', wide: true, onClose: () => off?.() });
}
