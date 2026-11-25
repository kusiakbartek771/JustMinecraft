// Udostępnianie: kod paczki (do wklejenia u znajomego) i eksport .mrpack / .zip.
import { api, refreshInstances } from '../state.js';
import { h, btn, modal, spinner, toast, toastError, switchEl } from '../ui.js';
import { t } from '../i18n.js';
import { navigate } from '../router.js';
import { LOADER_NAMES } from '../theme.js';

export function shareCode(inst) {
  modal(async (body) => {
    body.append(spinner());
    let r;
    try { r = await api('share:code', inst.id); } catch (e) { body.replaceChildren(h('p', { text: e.message })); return; }
    const box = h('textarea.input.mono', { readOnly: true, rows: 5, style: { width: '100%', resize: 'none', fontSize: '12px', wordBreak: 'break-all' }, text: r.code });
    body.replaceChildren(
      h('p', { text: t('Wyślij ten kod znajomemu. W JustMinecraft: Paczki i Drive → „Wklej kod znajomego” – dostanie tę samą wersję gry, loader i dokładnie te wersje modów.') }),
      box,
      h('div.row', { style: { marginTop: '10px' } },
        btn(t('Kopiuj kod'), () => { navigator.clipboard.writeText(r.code); toast(t('Skopiowano kod'), { success: true }); }, { kind: 'primary', icon: 'copy' }),
        h('span.muted.small', { text: t('{m} modów · {r} resource packów · {s} shaderów', { m: r.mods, r: r.resourcepacks, s: r.shaders }) })),
      r.skipped.length ? h('div.banner.warn', { style: { marginTop: '12px' } }, h('div', null,
        h('b', { text: t('Tych plików nie ma na Modrinth, więc kod ich nie obejmie ({n}):', { n: r.skipped.length }) }),
        h('div.small', { text: r.skipped.join(', ') }),
        h('div.small.muted', { text: t('Żeby przekazać wszystko, użyj „Eksportuj .mrpack”.') }))) : '');
    box.addEventListener('focus', () => box.select());
  }, { title: t('Udostępnij „{n}”', { n: inst.name }), icon: 'link', wide: true });
}

export function importCode() {
  let preview = null;
  const info = h('div', { style: { minHeight: '40px', marginTop: '10px' } });
  const area = h('textarea.input.mono', { rows: 5, placeholder: 'JUST1-…', style: { width: '100%', resize: 'none', fontSize: '12px' } });
  area.addEventListener('input', async () => {
    preview = null;
    info.replaceChildren();
    if (!area.value.trim()) return;
    try {
      preview = await api('share:preview', area.value);
      info.replaceChildren(h('div.card.card-pad', null, h('b', { text: preview.name }), h('div.muted.small', { text: `Minecraft ${preview.mc} · ${LOADER_NAMES[preview.loader] || preview.loader}${preview.loaderVersion ? ` ${preview.loaderVersion}` : ''} · ${t('{n} modów', { n: preview.mods.length })}${preview.resourcepacks.length ? ` · ${preview.resourcepacks.length} RP` : ''}${preview.shaders.length ? ` · ${preview.shaders.length} ${t('shaderów')}` : ''}` })));
    } catch (e) { info.replaceChildren(h('div.banner.warn', { text: e.message })); }
  });
  modal(h('div', null, h('p.muted', { text: t('Wklej kod, który dostałeś od znajomego. Powstanie nowa instancja z tymi samymi modami.') }), area, info), {
    title: t('Paczka z kodu'), icon: 'link', wide: true,
    actions: [{ label: t('Anuluj'), kind: 'ghost' }, {
      label: t('Utwórz instancję'), kind: 'primary', icon: 'download', run: async () => {
        if (!preview) { toast(t('Wklej poprawny kod'), { error: true }); return false; }
        try { const inst = await api('share:import', area.value); await refreshInstances(); navigate('instance', { id: inst.id }); toast(t('Pobieram paczkę „{n}”…', { n: inst.name })); } catch (e) { toastError(e); return false; }
      },
    }],
  });
  setTimeout(() => area.focus(), 100);
}

export function exportPack(inst, kind) {
  const parts = { saves: false, options: true };
  modal(h('div.col', { style: { gap: '12px' } },
    h('p', { text: kind === 'mrpack'
      ? t('Plik .mrpack otworzy każdy launcher (Modrinth App, Prism, JustMinecraft). Mody z Modrinth zapisuję jako linki, a resztę (i konfigurację) dołączam do pliku.')
      : t('Cała instancja w jednym pliku .zip – do kopii albo przeniesienia na inny komputer z JustMinecraft (przeciągnij plik do okna launchera).') }),
    h('label.row', null, switchEl(parts.saves, (v) => { parts.saves = v; }), h('span', { text: t('Dołącz światy') })),
    h('label.row', null, switchEl(parts.options, (v) => { parts.options = v; }), h('span', { text: t('Dołącz ustawienia gry (options.txt)') })),
    kind === 'mrpack' ? h('p.muted.small', { text: t('Pamiętaj: mody spoza Modrinth trafią do pliku – udostępniaj go tylko, jeśli licencje tych modów na to pozwalają.') }) : null),
  {
    title: kind === 'mrpack' ? t('Eksport .mrpack – {n}', { n: inst.name }) : t('Eksport instancji – {n}', { n: inst.name }), icon: 'package',
    actions: [{ label: t('Anuluj'), kind: 'ghost' }, {
      label: t('Eksportuj…'), kind: 'primary', icon: 'download', run: async () => {
        try {
          const r = await api('instances:export', inst.id, kind, parts);
          if (r) toast(kind === 'mrpack' ? t('Wyeksportowano: {l} modów jako linki, {i} plików w paczce', { l: r.linked, i: r.included }) : t('Wyeksportowano instancję'), { success: true });
        } catch (e) { toastError(e); }
      },
    }],
  });
}
