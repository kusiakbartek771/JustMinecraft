// Przygotowanie i uruchomienie gry: pliki, Java, classpath, argumenty, proces i logi.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const mc = require('./minecraft');
const java = require('./java');
const loaders = require('./loaders');
const { rulesAllow, SEP, OS } = require('./platform');

const PKG = require('../../../package.json');

const JVM_PRESETS = {
  none: { name: 'Domyślne Javy', args: () => [] },
  balanced: {
    name: 'Zrównoważone (G1GC, zalecane)',
    args: () => ['-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled', '-XX:MaxGCPauseMillis=200', '-XX:+UnlockExperimentalVMOptions', '-XX:+DisableExplicitGC',
      '-XX:G1NewSizePercent=30', '-XX:G1MaxNewSizePercent=40', '-XX:G1HeapRegionSize=8M', '-XX:G1ReservePercent=20', '-XX:G1HeapWastePercent=5',
      '-XX:G1MixedGCCountTarget=4', '-XX:InitiatingHeapOccupancyPercent=15', '-XX:G1MixedGCLiveThresholdPercent=90', '-XX:G1RSetUpdatingPauseTimePercent=5',
      '-XX:SurvivorRatio=32', '-XX:+PerfDisableSharedMem', '-XX:MaxTenuringThreshold=1'],
  },
  zgc: {
    name: 'Niskie opóźnienia (ZGC, Java 21+)',
    args: (major) => (major >= 21 ? ['-XX:+UseZGC', ...(major < 23 ? ['-XX:+ZGenerational'] : []), '-XX:+DisableExplicitGC', '-XX:+PerfDisableSharedMem'] : JVM_PRESETS.balanced.args(major)),
  },
  lowmem: {
    name: 'Słaby komputer (mało RAM)',
    args: () => ['-XX:+UseSerialGC', '-XX:+UseStringDeduplication', '-XX:TieredStopAtLevel=1'],
  },
};

/** Sugerowana ilość pamięci (MB) – z uwzględnieniem RAM komputera i liczby modów. */
function suggestMemory(modCount = 0) {
  const totalMb = Math.floor(os.totalmem() / 1048576);
  let want = modCount === 0 ? 2048 : modCount < 50 ? 4096 : modCount < 150 ? 6144 : 8192;
  const cap = Math.max(1024, totalMb - 2560);
  want = Math.min(want, cap);
  return Math.max(1024, Math.round(want / 512) * 512);
}

function splitArgs(str) {
  if (!str) return [];
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(str))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function processArgs(list, vars, features) {
  const out = [];
  const sub = (s) => s.replace(/\$\{([a-zA-Z_]+)\}/g, (_, k) => (vars[k] ?? ''));
  for (const a of list || []) {
    if (typeof a === 'string') out.push(sub(a));
    else if (a && rulesAllow(a.rules, features)) {
      const v = Array.isArray(a.value) ? a.value : [a.value];
      out.push(...v.map(sub));
    }
  }
  return out;
}

/**
 * Przygotowuje wszystko do uruchomienia (pobiera brakujące pliki).
 * @param {object} o { root, instance, account, settings, ctx }
 */
async function prepare(o) {
  const { root, instance, ctx = {} } = o;
  const d = mc.dirs(root);
  const gameDir = instance.dir;
  await fsp.mkdir(gameDir, { recursive: true });

  ctx.onStatus?.('Sprawdzanie wersji');
  let versionId = instance.versionId;
  const needLoader = instance.loader && instance.loader !== 'vanilla';
  if (!versionId || !(await mc.readJson(path.join(d.versions, versionId, `${versionId}.json`))) || ctx.repair) {
    if (needLoader || !versionId) {
      versionId = await loaders.installLoader(root, instance.loader, instance.mc, instance.loaderVersion, ctx);
      ctx.onVersionId?.(versionId);
    }
  }
  let version = await mc.resolveVersion(root, versionId);
  await mc.installClientJar(root, version, ctx);
  try {
    await mc.installLibraries(root, version, ctx);
  } catch (e) {
    if (e.code !== 'MISSING_LOCAL_LIBS' || !needLoader) throw e;
    // biblioteki loadera zniknęły (np. ktoś wyczyścił folder) – instalujemy go ponownie
    await fsp.rm(path.join(d.versions, versionId, '.installed'), { force: true });
    versionId = await loaders.installLoader(root, instance.loader, instance.mc, instance.loaderVersion, ctx);
    version = await mc.resolveVersion(root, versionId);
    await mc.installLibraries(root, version, ctx);
  }
  const assets = await mc.installAssets(root, version, gameDir, ctx);
  const logging = await mc.installLogging(root, version, ctx);

  ctx.onStatus?.('Java');
  let javaExe; let javaMajor;
  const custom = instance.javaPath || o.settings?.java?.path;
  if (custom) {
    const info = await java.probe(custom);
    if (!info) throw new Error(`Wybrana Java nie działa: ${custom}`);
    javaExe = custom; javaMajor = info.major;
    const req = java.requirement(version);
    if (info.major < req.major) throw new Error(`Ta wersja gry wymaga Javy ${req.major}, a wybrana to Java ${info.major}. Zmień Javę w ustawieniach instancji albo wybierz „Automatycznie”.`);
  } else {
    const j = await java.ensureJava(d.runtime, version, { ...ctx, windowed: OS === 'windows' });
    javaExe = j.java; javaMajor = j.major;
  }

  ctx.onStatus?.('Biblioteki natywne');
  const nativesDir = await mc.extractNatives(root, version);
  return { version, versionId, javaExe, javaMajor, assets, logging, nativesDir, gameDir };
}

/** Buduje pełną listę argumentów. */
function buildArgs(p, o) {
  const { version, assets, logging, nativesDir, gameDir, javaMajor } = p;
  const { root, instance, account, settings = {} } = o;
  const d = mc.dirs(root);
  const libs = mc.resolveLibraries(root, version).classpath.map((l) => l.file);
  const clientJar = path.join(d.versions, version._jarId, `${version._jarId}.jar`);
  // Forge/NeoForge 1.17+ ładują grę jako moduły z bibliotek – jar vanilla na classpath powoduje konflikt pakietów
  const jvmJson = JSON.stringify(version.arguments?.jvm || []);
  const modular = /ignoreList|"-p"|--module-path|fml\.pluginLayerLibraries/.test(jvmJson);
  const cp = [...new Set(modular ? libs : [...libs, clientJar])];

  const res = instance.resolution || settings.game?.resolution || {};
  const server = instance.quickJoin || '';
  const hasQuickPlay = JSON.stringify(version.arguments?.game || []).includes('quickPlayMultiplayer');
  const features = {
    is_demo_user: false,
    has_custom_resolution: !!(res.width && res.height),
    has_quick_plays_support: false,
    is_quick_play_singleplayer: false,
    is_quick_play_multiplayer: !!(server && hasQuickPlay),
    is_quick_play_realms: false,
  };
  const vars = {
    auth_player_name: account.name,
    version_name: version.id,
    game_directory: gameDir,
    assets_root: assets.dir,
    game_assets: assets.legacyDir || assets.dir,
    assets_index_name: assets.id,
    auth_uuid: account.uuid.replace(/-/g, ''),
    auth_access_token: account.accessToken || '0',
    auth_session: account.accessToken ? `token:${account.accessToken}:${account.uuid.replace(/-/g, '')}` : '0',
    auth_xuid: account.xuid || '0',
    clientid: account.clientId || '0',
    user_type: account.type === 'msa' ? 'msa' : 'legacy',
    user_properties: '{}',
    version_type: settings.game?.versionTypeLabel || 'JustLauncher',
    natives_directory: nativesDir,
    launcher_name: 'JustLauncher',
    launcher_version: PKG.version,
    classpath: cp.join(SEP),
    classpath_separator: SEP,
    library_directory: d.libraries,
    resolution_width: String(res.width || 854),
    resolution_height: String(res.height || 480),
    quickPlayMultiplayer: server,
    quickPlayPath: path.join(gameDir, 'quickPlay', 'log.json'),
  };

  // --- JVM ---
  const mem = instance.memory || settings.game?.memory || { min: 512, max: suggestMemory(0) };
  const jvm = [`-Xms${Math.min(mem.min || 512, mem.max)}M`, `-Xmx${mem.max}M`];
  const preset = JVM_PRESETS[instance.jvmPreset || settings.game?.jvmPreset || 'balanced'] || JVM_PRESETS.balanced;
  jvm.push(...preset.args(javaMajor));
  jvm.push(...splitArgs(settings.game?.jvmArgs), ...splitArgs(instance.jvmArgs));
  jvm.push('-Dminecraft.launcher.brand=JustLauncher', `-Dminecraft.launcher.version=${PKG.version}`);
  if (logging) jvm.push(logging.argument.replace('${path}', logging.file));
  if (version.arguments?.jvm) {
    jvm.push(...processArgs(version.arguments.jvm, vars, features));
  } else {
    if (OS === 'osx') jvm.push('-XstartOnFirstThread');
    if (OS === 'windows') jvm.push('-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.exe.heapdump');
    jvm.push(`-Djava.library.path=${nativesDir}`, '-cp', vars.classpath);
  }
  // starsze Forge/LWJGL2 + nowa Java: bezpieczne domyślne
  if (javaMajor >= 9 && !jvm.some((a) => a.startsWith('-Djava.library.path'))) jvm.push(`-Djava.library.path=${nativesDir}`);

  // --- gra ---
  let game;
  if (version.minecraftArguments) {
    game = splitArgs(version.minecraftArguments).map((a) => a.replace(/\$\{([a-zA-Z_]+)\}/g, (_, k) => vars[k] ?? ''));
    if (version.arguments?.game) game.push(...processArgs(version.arguments.game, vars, features));
    if (features.has_custom_resolution) game.push('--width', vars.resolution_width, '--height', vars.resolution_height);
  } else {
    game = processArgs(version.arguments?.game, vars, features);
  }
  if (res.fullscreen) game.push('--fullscreen');
  if (server && !features.is_quick_play_multiplayer) {
    const [host, port] = server.split(':');
    game.push('--server', host, '--port', port || '25565');
  }
  game.push(...splitArgs(instance.gameArgs));
  return [...jvm, version.mainClass, ...game];
}

function needsXrandr(version) {
  return (version.libraries || []).some((l) => /^org\.lwjgl\.lwjgl:lwjgl:2\./.test(l.name || ''));
}

function hasCommand(cmd) {
  return (process.env.PATH || '').split(path.delimiter).some((d) => d && fs.existsSync(path.join(d, cmd)));
}

// ---------- uruchomione gry ----------
const running = new Map(); // instanceId -> { proc, startedAt, log: [] }

function gpuEnv(settings) {
  const env = {};
  if (OS === 'linux' && settings.game?.dedicatedGpu) {
    env.DRI_PRIME = '1';
    env.__NV_PRIME_RENDER_OFFLOAD = '1';
    env.__GLX_VENDOR_LIBRARY_NAME = 'nvidia';
    env.__VK_LAYER_NV_optimus = 'NVIDIA_only';
  }
  return env;
}

/**
 * Uruchamia grę. Zwraca { pid }. Zdarzenia: hooks.onLog(line), hooks.onExit({code, crash, crashReport})
 */
async function launch(o, hooks = {}) {
  const { instance, settings = {} } = o;
  if (running.has(instance.id)) throw new Error('Ta instancja już działa');
  const p = await prepare(o);
  const args = buildArgs(p, o);
  if (OS === 'linux' && needsXrandr(p.version) && !hasCommand('xrandr')) {
    const e = new Error('Starsze wersje Minecrafta (LWJGL 2, np. 1.12.2) na Linuksie potrzebują programu „xrandr”.\nZainstaluj go:\n• Arch / CachyOS: sudo pacman -S xorg-xrandr\n• Ubuntu / Debian / Mint: sudo apt install x11-xserver-utils\n• Fedora: sudo dnf install xrandr');
    e.code = 'NEED_XRANDR';
    throw e;
  }
  const err = await java.quickCheck(p.javaExe);
  if (err) throw new Error(`Nie da się uruchomić Javy (${p.javaExe}): ${err}`);

  let cmd = p.javaExe;
  let cmdArgs = args;
  const wrapper = splitArgs(instance.wrapper || settings.game?.wrapper || '');
  if (OS === 'linux' && settings.game?.gamemode && !wrapper.includes('gamemoderun')) wrapper.unshift('gamemoderun');
  if (wrapper.length) { cmd = wrapper[0]; cmdArgs = [...wrapper.slice(1), p.javaExe, ...args]; }

  const env = { ...process.env, ...gpuEnv(settings), ...(instance.env || {}) };
  delete env.JAVA_TOOL_OPTIONS; delete env._JAVA_OPTIONS;
  // Electron dokłada zmienne, które psują niektóre natywne biblioteki gry
  delete env.ELECTRON_RUN_AS_NODE; delete env.CHROME_DESKTOP;

  o.ctx?.onStatus?.('Uruchamianie gry');
  const logFile = path.join(p.gameDir, 'logs', 'justlauncher-latest.log');
  await fsp.mkdir(path.dirname(logFile), { recursive: true });
  const logStream = fs.createWriteStream(logFile);
  const startedAt = Date.now();
  const masked = args.map((a) => (o.account.accessToken && a === o.account.accessToken ? '••••••' : a));
  logStream.write(`[JustLauncher] ${cmd} ${(wrapper.length ? [...wrapper.slice(1), p.javaExe, ...masked] : masked).join(' ')}\n\n`);

  const proc = spawn(cmd, cmdArgs, { cwd: p.gameDir, env, windowsHide: false, detached: false });
  const entry = { proc, startedAt, tail: [], instanceId: instance.id, versionId: p.versionId };
  running.set(instance.id, entry);

  let buf = '';
  const onData = (d) => {
    logStream.write(d);
    buf += d.toString();
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();
    for (const line of lines) {
      const clean = o.account.accessToken ? line.split(o.account.accessToken).join('••••••') : line;
      entry.tail.push(clean);
      if (entry.tail.length > 400) entry.tail.shift();
      hooks.onLog?.(clean);
    }
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);

  return new Promise((resolve, reject) => {
    let started = false;
    proc.once('spawn', () => { started = true; resolve({ pid: proc.pid, versionId: p.versionId, javaExe: p.javaExe }); hooks.onStart?.({ pid: proc.pid }); });
    proc.once('error', (e) => {
      running.delete(instance.id);
      logStream.end();
      if (!started) reject(new Error(`Nie udało się uruchomić gry: ${e.message}`));
    });
    proc.once('exit', async (code, signal) => {
      running.delete(instance.id);
      if (buf) hooks.onLog?.(buf);
      logStream.end();
      const crashed = code !== 0 && code !== null && !entry.killed;
      let crashReport = null;
      if (crashed) crashReport = await findCrashReport(p.gameDir, startedAt);
      hooks.onExit?.({ code, signal, crashed, crashReport, tail: entry.tail.slice(-60), playedMs: Date.now() - startedAt });
    });
  });
}

async function findCrashReport(gameDir, since) {
  const dirs = [path.join(gameDir, 'crash-reports'), gameDir];
  let best = null;
  for (const d of dirs) {
    let files = [];
    try { files = await fsp.readdir(d); } catch { continue; }
    for (const f of files) {
      if (!/^crash-.*\.txt$|^hs_err_pid\d+\.log$/.test(f)) continue;
      const full = path.join(d, f);
      const st = await fsp.stat(full).catch(() => null);
      if (st && st.mtimeMs >= since - 2000 && (!best || st.mtimeMs > best.t)) best = { file: full, t: st.mtimeMs };
    }
  }
  if (!best) return null;
  const text = await fsp.readFile(best.file, 'utf8').catch(() => '');
  return { file: best.file, text: text.slice(0, 20000) };
}

function kill(instanceId) {
  const e = running.get(instanceId);
  if (!e) return false;
  e.killed = true;
  e.proc.kill();
  setTimeout(() => { try { if (running.get(instanceId) === e) e.proc.kill('SIGKILL'); } catch {} }, 8000);
  return true;
}

const runningList = () => [...running.values()].map((e) => ({ instanceId: e.instanceId, pid: e.proc.pid, startedAt: e.startedAt }));

module.exports = { prepare, buildArgs, launch, kill, running, runningList, suggestMemory, JVM_PRESETS, splitArgs };
