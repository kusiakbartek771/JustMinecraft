// Test wydajności: gra mierzy FPS i pamięć przez 60 s (JustHUD), launcher pokazuje wynik i podpowiada, co zmienić.
import { S, api, refreshInstances } from '../state.js';
import { h, btn, modal, toast, toastError } from '../ui.js';
import { t } from '../i18n.js';
import { play } from '../actions.js';

export async function startBench(inst) {
  const sup = await api('justhud:support', inst.id).catch(() => ({ ok: false, reason: '' }));
  modal(h('div.col', { style: { gap: '10px' } },
    h('p', { text: t('Gra uruchomi się normalnie. Wejdź do świata i graj jak zwykle – po 5 sekundach JustHUD przez 60 sekund zmierzy płynność (FPS, przycięcia) i zużycie pamięci. Wynik pojawi się w launcherze, a gra działa dalej.') }),
    h('p.muted.small', { text: t('Najlepiej biegaj albo lataj po świecie – wtedy test pokaże prawdziwe obciążenie.') }),
    sup.ok ? null : h('div.banner.warn', { text: sup.reason || t('Test wymaga JustHUD.') })), {
    title: t('Test wydajności – {n}', { n: inst.name }), icon: 'gauge',
    actions: [{ label: t('Anuluj'), kind: 'ghost' }, { label: t('Rozpocznij test'), kind: 'primary', icon: 'play', run: () => { if (!sup.ok) return false; play(inst, { bench: 60 }); } }],
  });
}

/** Podpowiedzi na podstawie wyniku. */
function advice(inst, r, hasPerf) {
  const out = [];
  const maxMb = r.memMaxMb, peak = r.memPeakMb;
  const mem = inst.memory?.max || S.settings.game.memory.max;
  if (peak > maxMb * 0.85) {
    const target = Math.min(16384, Math.ceil((maxMb * 1.5) / 512) * 512);
    out.push({ kind: 'warn', text: t('Pamięć była prawie pełna ({p} z {m} MB) – to powoduje przycięcia. Zwiększ RAM do {t} GB.', { p: peak, m: maxMb, t: (target / 1024).toFixed(1) }),
      action: [t('Ustaw {t} GB', { t: (target / 1024).toFixed(1) }), () => api('instances:update', inst.id, { memory: { min: 512, max: target } }).then(() => { refreshInstances(); toast(t('Zmieniono pamięć')); })] });
  } else if (peak < maxMb * 0.35 && maxMb > 4096) {
    const target = Math.max(3072, Math.ceil((peak * 2) / 512) * 512);
    out.push({ kind: 'ok', text: t('Gra używa mniej niż ⅓ przydzielonej pamięci – możesz oddać część RAM systemowi ({t} GB wystarczy).', { t: (target / 1024).toFixed(1) }),
      action: [t('Ustaw {t} GB', { t: (target / 1024).toFixed(1) }), () => api('instances:update', inst.id, { memory: { min: 512, max: target } }).then(() => { refreshInstances(); toast(t('Zmieniono pamięć')); })] });
  }
  if (r.fpsAvg < 60 && !hasPerf) out.push({ kind: 'warn', text: t('Średnio poniżej 60 FPS. Pakiet wydajności (Sodium, Lithium, FerriteCore…) zwykle podwaja płynność.'), action: [t('Zainstaluj pakiet'), () => api('modrinth:performance', inst.id).then(() => toast(t('Zainstalowano pakiet wydajności'), { success: true })).catch(toastError)] });
  if (r.fps1Low < r.fpsAvg * 0.4) out.push({ kind: 'warn', text: t('Duże przycięcia (1% najgorszych klatek: {l} FPS). Pomaga profil JVM „Zrównoważony” albo „ZGC” w ustawieniach instancji i mniej modów naraz.', { l: r.fps1Low.toFixed(0) }) });
  if (!out.length) out.push({ kind: 'ok', text: t('Wszystko działa świetnie – nie trzeba nic zmieniać. 🎉') });
  return out;
}

export async function showBench(inst, r) {
  let hasPerf = false;
  try { hasPerf = (await api('content:list', inst.id, 'mod')).some((m) => /sodium|embeddium|rubidium/i.test(m.modId || m.file)); } catch {}
  const tile = (label, value, sub) => h('div.wstat', null, h('small.muted', { text: label }), h('b', { style: { fontSize: '1.5em' }, text: value }), sub ? h('small.muted', { text: sub }) : null);
  const grade = r.fpsAvg >= 120 ? ['🚀', t('Bardzo płynnie')] : r.fpsAvg >= 60 ? ['✅', t('Płynnie')] : r.fpsAvg >= 30 ? ['⚠️', t('Grywalnie')] : ['🐢', t('Słabo')];
  modal(h('div.col', { style: { gap: '14px' } },
    h('div.row', null, h('span', { style: { fontSize: '30px' }, text: grade[0] }), h('div', null, h('h2', { style: { margin: 0 }, text: grade[1] }), h('small.muted', { text: t('{s} s pomiaru · {f} klatek', { s: Math.round(r.seconds), f: r.frames }) }))),
    h('div.wstats', { style: { gridTemplateColumns: 'repeat(4, 1fr)' } },
      tile(t('Średnio'), `${r.fpsAvg.toFixed(0)} FPS`),
      tile(t('Mediana'), `${r.fpsMedian.toFixed(0)} FPS`),
      tile(t('1% najgorszych'), `${r.fps1Low.toFixed(0)} FPS`, t('najdłuższa klatka {m} ms', { m: r.worstFrameMs.toFixed(0) })),
      tile(t('Pamięć'), `${(r.memPeakMb / 1024).toFixed(1)} GB`, t('z {m} GB', { m: (r.memMaxMb / 1024).toFixed(1) }))),
    h('h3', { style: { margin: '4px 0 0' }, text: t('Co możesz zrobić') }),
    ...advice(inst, r, hasPerf).map((a) => h(`div.banner${a.kind === 'warn' ? '.warn' : ''}`, null, h('div.grow', { text: a.text }), a.action ? btn(a.action[0], a.action[1], { small: true, kind: 'primary' }) : null))),
  { title: t('Wynik testu – {n}', { n: inst.name }), icon: 'gauge', wide: true });
}
