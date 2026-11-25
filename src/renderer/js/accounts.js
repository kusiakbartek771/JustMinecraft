// Konta offline: lista, wybór, dodawanie i usuwanie.
import { S, api, refreshAccounts, emit } from './state.js';
import { h, modal, btn, iconBtn, toast, toastError, input } from './ui.js';
import { avatar } from './components.js';
import { t } from './i18n.js';

export function openAccounts() {
  modal((body, close) => {
    const draw = async () => {
      await refreshAccounts();
      body.replaceChildren();
      const list = h('div.col');
      if (!S.accounts.length) list.append(h('p.muted', { text: t('Nie masz jeszcze konta. Dodaj konto – wystarczy nick.') }));
      for (const a of S.accounts) {
        const active = a.id === S.selectedAccount;
        list.append(h(`div.pl-item${active ? '.active' : ''}`, {
          onClick: async () => { await api('accounts:select', a.id); S.selectedAccount = a.id; emit('accounts', S.accounts); draw(); },
        },
          avatar(a, 38),
          h('div.grow', null, h('b', { text: a.name }), h('br'), h('small.muted', { text: t('Konto offline') })),
          active ? h('span.chip.accent', { text: t('Aktywne') }) : null,
          iconBtn('trash', t('Usuń konto'), async (e) => { e.stopPropagation(); await api('accounts:remove', a.id); draw(); }, { kind: 'danger' })));
      }
      body.append(list, h('div.row', { style: { marginTop: '16px' } },
        btn(t('Dodaj konto offline'), () => offline(draw), { kind: 'primary', icon: 'user' })));
      body.append(h('p.muted.small', { style: { marginTop: '14px' }, text: t('Konto offline pozwala grać w trybie jednoosobowym, w sieci LAN i na serwerach bez weryfikacji (online-mode=false).') }));
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
