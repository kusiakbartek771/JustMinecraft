// Akcje używane w wielu miejscach: granie, instalacja z Modrinth, usuwanie instancji, okno awarii.
import { S, api, emit, refreshInstances, currentAccount } from './state.js';
import { h, modal, toast, toastError, confirmDialog, btn } from './ui.js';
import { t } from './i18n.js';
import { navigate } from './router.js';
import { openAccounts } from './accounts.js';

export const isRunning = (id) => S.running.has(id);
export const launchTask = (id) => [...S.tasks.values()].find((x) => x.instanceId === id && x.state === 'running');

export async function play(inst, o = {}) {
  if (!inst) return;
  if (isRunning(inst.id)) {
    if (await confirmDialog({ title: t('Zamknąć grę?'), text: t('Niezapisany postęp w grze może zostać utracony.'), ok: t('Zamknij grę'), danger: true })) await api('game:kill', inst.id);
    return;
  }
  if (!currentAccount()) {
    toast(t('Najpierw dodaj konto, żeby grać'), { icon: 'user' });
    openAccounts();
    return;
  }
  try {
    await api('game:launch', inst.id, o);
  } catch (e) {
    if (e.code === 'NEED_XRANDR') {
      modal(h('div.col', null, h('p', { text: e.message }), h('p.muted.small', { text: t('Po instalacji kliknij „Graj” jeszcze raz.') })), { title: t('Brakuje programu xrandr'), icon: 'alert', actions: [{ label: t('OK'), kind: 'primary' }] });
    } else if (/konto|zaloguj/i.test(e.message)) {
      toastError(e);
      openAccounts();
    } else toast(e.message, { error: true, action: { label: t('Pokaż konsolę'), run: () => navigate('instance', { id: inst.id, tab: 'console' }) } });
  }
}

export function showCrash(inst, e) {
  const text = e.crashReport?.text || (e.tail || []).join('\n');
  const hint = crashHint(text);
  modal((body, close) => {
    body.append(
      h('p', { text: t('Gra zakończyła się błędem (kod {code}).', { code: e.code }) }),
      hint ? h('div.banner.warn', null, h('span.ic', { html: '💡' }), h('div', { text: hint })) : null,
      h('pre.console', { style: { height: '320px' }, text: text.slice(-12000) || t('Brak logów') }),
      h('div.row', { style: { marginTop: '12px' } },
        btn(t('Konsola'), () => { close(); navigate('instance', { id: inst.id, tab: 'console' }); }, { icon: 'terminal' }),
        e.crashReport ? btn(t('Pokaż plik'), () => api('shell:showItem', e.crashReport.file), { icon: 'folder' }) : null,
        btn(t('Kopiuj'), () => { navigator.clipboard.writeText(text); toast(t('Skopiowano')); }, { icon: 'copy' }),
        h('div.spacer'),
        btn(t('Uruchom ponownie'), () => { close(); play(inst); }, { kind: 'primary', icon: 'play' })),
    );
  }, { title: t('Minecraft się wysypał – {name}', { name: inst.name }), icon: 'alert', wide: true });
}

function crashHint(text) {
  if (/OutOfMemoryError|Java heap space/i.test(text)) return t('Zabrakło pamięci – zwiększ RAM w ustawieniach instancji.');
  if (/requires.*(fabric|minecraft|java)|Incompatible mods? found|depends on|Missing or unsupported mandatory dependencies|ModResolutionException/i.test(text)) return t('Niezgodne albo brakujące mody – sprawdź komunikat poniżej i dobierz wersje modów do wersji gry.');
  if (/UnsupportedClassVersionError|has been compiled by a more recent version/i.test(text)) return t('Zła wersja Javy – ustaw Javę na „Automatycznie” w ustawieniach instancji.');
  if (/Mixin apply failed|MixinApplyError|InvalidInjectionException/i.test(text)) return t('Konflikt modów (Mixin) – wyłącz ostatnio dodane mody i spróbuj ponownie.');
  if (/GLFW error|OpenGL|Pixel format not accelerated|WGL/i.test(text)) return t('Problem ze sterownikiem grafiki – zaktualizuj sterowniki karty graficznej.');
  if (/Duplicate mod|DuplicateModsFoundException|duplicate/i.test(text)) return t('Ten sam mod jest zainstalowany dwa razy – usuń duplikat.');
  return null;
}

export async function removeInstance(inst) {
  const ok = await confirmDialog({ title: t('Usunąć „{name}”?', { name: inst.name }), text: t('Folder instancji (mody, światy, ustawienia) trafi do kosza systemowego.'), ok: t('Usuń'), danger: true });
  if (!ok) return false;
  try {
    await api('instances:remove', inst.id);
    await refreshInstances();
    toast(t('Usunięto instancję'));
    return true;
  } catch (e) { toastError(e); return false; }
}

export async function installProject({ instance, project, type, versionId, world, source }) {
  try {
    const r = await api('modrinth:install', { instanceId: instance.id, projectId: project.id, versionId, type, world, title: project.title, source: source || project.platform || 'modrinth' });
    const extra = r.installed.length > 1 ? ` (+${r.installed.length - 1} ${t('zależności')})` : '';
    toast(`${t('Zainstalowano')}: ${project.title}${extra}`, { success: true });
    for (const w of r.warnings || []) toast(w, { error: true });
    emit('content-changed', instance.id);
    return true;
  } catch (e) {
    if (e.code === 'CF_BLOCKED' && e.url) toast(e.message, { error: true, duration: 12000, action: { label: t('Otwórz stronę'), run: () => api('shell:open', e.url) } });
    else toastError(e);
    return false;
  }
}

/** Wybór świata dla datapacka (albo „wszystkie światy”). */
export function pickWorld(instance) {
  return new Promise(async (resolve) => {
    let worlds = [];
    try { worlds = await api('instances:worlds', instance.id); } catch {}
    let done = false;
    const m = modal((body) => {
      body.append(h('p.muted', { text: t('Datapacki działają w konkretnym świecie. Wybierz świat albo „Wszystkie światy” – launcher skopiuje datapack do każdego świata przy starcie gry.') }));
      const list = h('div.col');
      const pick = (v) => { done = true; resolve(v); m.close(); };
      list.append(h('button.pl-item', { onClick: () => pick('*') }, h('div.pl-art', { html: '🌍' }), h('div', null, h('b', { text: t('Wszystkie światy') }), h('br'), h('small.muted', { text: t('także nowe – przy następnym uruchomieniu') }))));
      for (const w of worlds) {
        list.append(h('button.pl-item', { onClick: () => pick(w.name) }, h('div.pl-art', { style: w.icon ? { backgroundImage: `url("${w.icon}")` } : null, html: w.icon ? '' : '🗺️' }), h('div', null, h('b', { text: w.name }), h('br'), h('small.muted', { text: `${w.datapacks} ${t('datapacków')}` }))));
      }
      body.append(list);
    }, { title: t('Gdzie zainstalować datapack?'), icon: 'map', onClose: () => { if (!done) resolve(null); } });
  });
}

export async function refreshAfterTask() {
  await refreshInstances();
}
