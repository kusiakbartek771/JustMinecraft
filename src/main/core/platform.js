// System, architektura, reguły bibliotek Mojang i współrzędne Maven.
const os = require('os');
const path = require('path');

const OS = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
const ARCH = process.arch; // x64 | arm64 | ia32
const SEP = process.platform === 'win32' ? ';' : ':';

/** Ocena listy reguł Mojang (allow/disallow, os.name/arch/version, features). */
function rulesAllow(rules, features = {}) {
  if (!rules || !rules.length) return true;
  let allowed = false;
  for (const r of rules) {
    let match = true;
    if (r.os) {
      if (r.os.name && r.os.name !== OS) match = false;
      if (r.os.arch) {
        const a = r.os.arch;
        if (a === 'x86' && ARCH !== 'ia32') match = false;
        if (a === 'arm64' && ARCH !== 'arm64') match = false;
        if (a === 'x64' && ARCH !== 'x64') match = false;
      }
      if (r.os.version) {
        try { if (!new RegExp(r.os.version).test(os.release())) match = false; } catch {}
      }
    }
    if (r.features) {
      for (const [k, v] of Object.entries(r.features)) if (!!features[k] !== v) match = false;
    }
    if (match) allowed = r.action === 'allow';
  }
  return allowed;
}

/** "group:artifact:version[:classifier][@ext]" -> { group, artifact, version, classifier, ext, path } */
function parseMaven(name) {
  let ext = 'jar';
  let n = name;
  const at = n.indexOf('@');
  if (at >= 0) { ext = n.slice(at + 1); n = n.slice(0, at); }
  const [group, artifact, version, classifier] = n.split(':');
  const file = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.${ext}`;
  const p = [...group.split('.'), artifact, version, file].join('/');
  return { group, artifact, version, classifier, ext, path: p, file };
}

/** Klucz do usuwania duplikatów bibliotek (bez wersji). */
function libKey(name) {
  const m = parseMaven(name);
  return `${m.group}:${m.artifact}${m.classifier ? `:${m.classifier}` : ''}`;
}

const nativesKey = () => {
  if (OS === 'osx') return ARCH === 'arm64' ? ['natives-osx-arm64', 'natives-macos-arm64', 'natives-osx', 'natives-macos'] : ['natives-osx', 'natives-macos'];
  if (OS === 'windows') return ARCH === 'arm64' ? ['natives-windows-arm64', 'natives-windows'] : ARCH === 'ia32' ? ['natives-windows-32', 'natives-windows-x86', 'natives-windows'] : ['natives-windows-64', 'natives-windows'];
  return ARCH === 'arm64' ? ['natives-linux-arm64', 'natives-linux'] : ['natives-linux'];
};

const bits = () => (ARCH === 'ia32' ? '32' : '64');

function javaExecutable(home, windowed = true) {
  if (OS === 'windows') return path.join(home, 'bin', windowed ? 'javaw.exe' : 'java.exe');
  return path.join(home, 'bin', 'java');
}

module.exports = { OS, ARCH, SEP, rulesAllow, parseMaven, libKey, nativesKey, bits, javaExecutable };
