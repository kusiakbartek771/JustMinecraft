// Pierwsze uruchomienie: język, folder instalacji, wygląd, konto. Też: zmiana folderu instalacji.
import { S, api, saveSettings, refreshInstances } from '../state.js';
import { h, btn, modal, segmented, select, toast, toastError, confirmDialog } from '../ui.js';
import { icon } from '../icons.js';
import { t, LANGS, setLang } from '../i18n.js';
import { THEMES, applyAppearance } from '../theme.js';
import { openAccounts } from '../accounts.js';

export function onboarding(done) {
  let step = 0;
  const m = modal((body) => {
    const draw = () => {
      body.replaceChildren(h('div.steps', null, [0, 1, 2].map((i) => h(`i${i <= step ? '.on' : ''}`))));
      if (step === 0) {
        body.append(h('h1', { style: { margin: '0 0 6px' }, text: t('Cześć! 👋') }),
          h('p.muted', { text: t('JustLauncher uruchomi każdą wersję Minecrafta z modami. Ustawmy kilka rzeczy – zajmie to chwilę.') }),
          h('div.form', null, h('div.field', null, h('label.lbl', { text: t('Język') }), select(LANGS, S.settings.language, (v) => { saveSettings({ language: v }); setLang(v); draw(); }))),
          h('div.row', { style: { justifyContent: 'flex-end', marginTop: '20px' } }, btn(t('Dalej'), () => { step = 1; draw(); }, { kind: 'primary', icon: 'chevronRight' })));
      } else if (step === 1) {
        const pathBox = h('div.path-box', { text: S.settings.dataDir });
        body.append(h('h2', { style: { margin: '0 0 6px' }, text: t('Gdzie zainstalować gry?') }),
          h('p.muted', { text: t('W tym folderze będą wersje Minecrafta, Java i wszystkie instancje (mody, światy). Wybierz dysk z wolnym miejscem – modpacki potrafią zająć kilka GB.') }),
          pathBox,
          h('div.row', { style: { marginTop: '10px' } }, btn(t('Wybierz inny folder…'), async () => {
            const d = await api('data:choose');
            if (d) { try { S.settings = await api('data:set', d, false); pathBox.textContent = S.settings.dataDir; } catch (e) { toastError(e); } }
          }, { icon: 'folder' })),
          h('div.row', { style: { justifyContent: 'space-between', marginTop: '20px' } }, btn(t('Wstecz'), () => { step = 0; draw(); }, { kind: 'ghost' }), btn(t('Dalej'), () => { step = 2; draw(); }, { kind: 'primary', icon: 'chevronRight' })));
      } else {
        const grid = h('div.choice-grid');
        for (const [id, th] of Object.entries(THEMES)) {
          grid.append(h(`button.choice${S.settings.appearance.theme === id ? '.active' : ''}`, { onClick: () => { saveSettings({ appearance: { theme: id } }); applyAppearance(S.settings.appearance); draw(); } },
            h('span.loader-dot', { style: { background: `linear-gradient(135deg, ${th.accent}, ${th.g1})`, width: '34px', height: '34px' } }), t(th.name)));
        }
        body.append(h('h2', { style: { margin: '0 0 6px' }, text: t('Wybierz wygląd') }), h('p.muted', { text: t('Wszystko zmienisz później w Ustawienia → Wygląd (kolory, tło, czcionki, układ).') }), grid,
          h('div.row', { style: { justifyContent: 'space-between', marginTop: '20px' } }, btn(t('Wstecz'), () => { step = 1; draw(); }, { kind: 'ghost' }),
            btn(t('Zaczynamy!'), async () => { await saveSettings({ onboarded: true }); m.close(); done?.(); openAccounts(); }, { kind: 'primary', icon: 'rocket' })));
      }
    };
    draw();
  }, { dismissable: false, wide: true });
}

export async function changeDataDir() {
  const d = await api('data:choose');
  if (!d) return;
  const move = await new Promise((resolve) => {
    let done = false;
    modal(h('p', { text: t('Przenieść istniejące dane (instancje, wersje, Javę) do nowego folderu? Bez przenoszenia launcher zacznie od pustego folderu, a stare pliki zostaną na miejscu.') }), {
      title: t('Nowy folder instalacji'), icon: 'folder',
      onClose: () => { if (!done) resolve(null); },
      actions: [
        { label: t('Anuluj'), run: () => { done = true; resolve(null); } },
        { label: t('Tylko zmień folder'), run: () => { done = true; resolve(false); } },
        { label: t('Przenieś dane'), kind: 'primary', run: () => { done = true; resolve(true); } },
      ],
    });
  });
  if (move === null) return;
  try {
    S.settings = await api('data:set', d, move);
    await refreshInstances();
    toast(t('Folder instalacji: {d}', { d: S.settings.dataDir }), { success: true });
    const { rerender } = await import('../router.js');
    rerender();
  } catch (e) { toastError(e); }
}
