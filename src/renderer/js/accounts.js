// Konta: lista, wybór, logowanie Microsoft (kod urządzenia) i konta offline.
import { S, api, refreshAccounts, emit } from './state.js';
import { h, modal, btn, iconBtn, toast, toastError, input, spinner } from './ui.js';
import { avatar } from './components.js';
import { t } from './i18n.js';
import { icon } from './icons.js';

export function openAccounts() {
  modal((body, close) => {
    const draw = async () => {
      await refreshAccounts();
      body.replaceChildren();
      const list = h('div.col');
      if (!S.accounts.length) list.append(h('p.muted', { text: t('Nie masz jeszcze konta. Zaloguj się kontem Microsoft (z kupionym Minecraftem) albo dodaj konto offline.') }));
      for (const a of S.accounts) {
        const active = a.id === S.selectedAccount;
        list.append(h(`div.pl-item${active ? '.active' : ''}`, {
          onClick: async () => { await api('accounts:select', a.id); S.selectedAccount = a.id; emit('accounts', S.accounts); draw(); },
        },
          avatar(a, 38),
          h('div.grow', null, h('b', { text: a.name }), h('br'), h('small.muted', { text: a.type === 'msa' ? (a.expired ? t('Microsoft – sesja wygasła') : t('Konto Microsoft')) : t('Konto offline') })),
          active ? h('span.chip.accent', { text: t('Aktywne') }) : null,
          iconBtn('trash', t('Usuń konto'), async (e) => { e.stopPropagation(); await api('accounts:remove', a.id); draw(); }, { kind: 'danger' })));
      }
      body.append(list, h('div.row', { style: { marginTop: '16px' } },
        btn(t('Zaloguj przez Microsoft'), () => microsoftLogin(draw), { kind: 'primary', icon: 'shield' }),
        btn(t('Dodaj konto offline'), () => offline(draw), { icon: 'user' })));
      body.append(h('p.muted.small', { style: { marginTop: '14px' }, text: t('Konto offline pozwala grać w trybie jednoosobowym i na serwerach bez weryfikacji. Do serwerów premium i Realms potrzebne jest konto Microsoft.') }));
    };
    draw();
  }, { title: t('Konta'), icon: 'users' });
}

function offline(done) {
  let name = '';
  modal((body, close) => {
    const i = input('', (v) => { name = v; }, { placeholder: 'Steve', live: true, onEnter: () => save() });
    const save = async () => {
      try { await api('accounts:addOffline', name || i.value); await refreshAccounts(); close(); done?.(); toast(t('Dodano konto')); } catch (e) { toastError(e); }
    };
    body.append(h('div.form', null, h('div.field', null, h('label.lbl', { text: t('Nick w grze') }), i), h('small.muted', { text: t('3–16 znaków: litery, cyfry i _') })),
      h('div.row', { style: { marginTop: '16px', justifyContent: 'flex-end' } }, btn(t('Dodaj'), save, { kind: 'primary', icon: 'plus' })));
    setTimeout(() => i.focus(), 60);
  }, { title: t('Konto offline'), icon: 'user' });
}

async function microsoftLogin(done) {
  let off = null;
  const m = modal((body) => body.append(spinner()), { title: t('Logowanie Microsoft'), icon: 'shield', onClose: () => { off?.(); api('accounts:msCancel').catch(() => {}); } });
  try {
    const r = await api('accounts:msStart');
    m.body.replaceChildren(
      h('p', { text: t('1. Otwórz stronę logowania Microsoft:') }),
      h('div.row', null, btn(r.verificationUri, () => api('shell:open', r.verificationUri), { icon: 'external' })),
      h('p', { text: t('2. Wpisz ten kod:') }),
      h('div.code-box', { text: r.userCode }),
      h('div.row', { style: { marginTop: '10px' } }, btn(t('Kopiuj kod'), () => { navigator.clipboard.writeText(r.userCode); toast(t('Skopiowano')); }, { icon: 'copy', small: true }), h('div.spacer'), h('span.muted.small', { text: t('Czekam na zalogowanie…') }), spinner(true)),
    );
    navigator.clipboard.writeText(r.userCode).catch(() => {});
    api('shell:open', r.verificationUri).catch(() => {});
    off = window.jl.on('accounts:ms', async (res) => {
      off?.(); off = null;
      if (res.ok) { toast(t('Zalogowano jako {name}', { name: res.account.name }), { success: true }); m.close(); await refreshAccounts(); done?.(); } else {
        m.body.replaceChildren(h('div.banner.warn', null, h('span.ic', { html: icon('alert') }), h('div', { text: res.error })));
      }
    });
  } catch (e) {
    m.body.replaceChildren(h('div.banner.warn', null, h('span.ic', { html: icon('alert') }), h('div', { text: e.message })),
      h('p.muted.small', { text: t('Microsoft wymaga, by każdy launcher miał własną aplikację Azure zatwierdzoną przez Mojang. Wpisz jej „Client ID” w Ustawienia → Zaawansowane. Do tego czasu możesz grać na koncie offline.') }));
  }
}
