#!/usr/bin/env python3
"""JustHUD – budowanie wielu wersji z jednego kodu.

Źródła w src/ mają bloki warunkowe:
    //#if MC >= 1.20 && FABRIC
    ...
    //#elif MC >= 1.19
    ...
    //#else
    ...
    //#endif
Dla każdej wersji z targets.json skrypt generuje projekt Gradle w build/targets/<loader>-<mc>/,
przepisuje źródła (nieaktywne linie zamienia na puste) i buduje jar do out/.

Użycie:  python3 build.py                 # wszystko
         python3 build.py fabric-1.21.5   # wybrane (prefiksy też działają: fabric, forge-1.20)
         python3 build.py --gen-only ...  # tylko wygeneruj projekty
"""
import json, os, re, shutil, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / 'src'
OUT = ROOT / 'out'
GEN = ROOT / 'build' / 'targets'
VERSION = (ROOT / 'VERSION').read_text().strip()
MOD_ID = 'justhud'


def vnum(v: str) -> int:
    p = [int(x) for x in re.findall(r'\d+', v)] + [0, 0, 0]
    return p[0] * 10000 + p[1] * 100 + p[2]


def eval_cond(cond: str, env: dict) -> bool:
    def cmp(m):
        op, ver = m.group(1), m.group(2)
        return str(eval(f'{env["MC"]} {op} {vnum(ver)}'))
    expr = re.sub(r'MC\s*(>=|<=|==|!=|>|<)\s*([0-9][0-9.]*)', cmp, cond)
    for k in ('FABRIC', 'FORGE', 'NEOFORGE'):
        expr = re.sub(rf'\b{k}\b', str(env[k]), expr)
    expr = expr.replace('&&', ' and ').replace('||', ' or ').replace('!', ' not ').replace(' not =', '!=')
    return bool(eval(expr, {'__builtins__': {}}, {'True': True, 'False': False}))


def preprocess(text: str, env: dict, name: str) -> str:
    out = []
    stack = []  # (aktywny_rodzic, już_wybrano, aktywny_teraz)
    active = True
    for no, line in enumerate(text.split('\n'), 1):
        s = line.strip()
        if s.startswith('//#if '):
            c = eval_cond(s[6:], env)
            stack.append((active, c, active and c))
            active = active and c
            out.append('')
            continue
        if s.startswith('//#elif '):
            parent, taken, _ = stack[-1]
            c = (not taken) and eval_cond(s[8:], env)
            stack[-1] = (parent, taken or c, parent and c)
            active = parent and c
            out.append('')
            continue
        if s == '//#else':
            parent, taken, _ = stack[-1]
            stack[-1] = (parent, True, parent and not taken)
            active = parent and not taken
            out.append('')
            continue
        if s == '//#endif':
            parent, _, _ = stack.pop()
            active = parent
            out.append('')
            continue
        out.append(line if active else '')
    if stack:
        raise SystemExit(f'{name}: brak //#endif')
    return '\n'.join(out)


def targets():
    t = json.loads((ROOT / 'targets.json').read_text())
    for loader in ('fabric', 'forge', 'neoforge'):
        for e in t[loader]:
            yield {**e, 'loader': loader, 'id': f'{loader}-{e["mc"]}'}


def copy_tree(src: Path, dst: Path, env: dict, subst: dict):
    for f in src.rglob('*'):
        if f.is_dir():
            continue
        rel = f.relative_to(src)
        target = dst / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        if f.suffix in ('.java', '.json', '.toml', '.mcmeta', '.cfg'):
            text = f.read_text()
            if f.suffix == '.java':
                text = preprocess(text, env, str(rel))
                if env['MC'] >= 260300:
                    text = re.sub(r'\bGuiGraphics\b', 'GuiGraphicsExtractor', text)
            for k, v in subst.items():
                text = text.replace('${' + k + '}', v)
            target.write_text(text)
        else:
            shutil.copy2(f, target)


GRADLE_FABRIC = '''plugins {{ id 'fabric-loom' version '{loom}' }}
version = '{version}+{mc}-fabric'
group = 'pl.justminecraft'
base {{ archivesName = '{mod_id}' }}
repositories {{ mavenCentral() }}
dependencies {{
    minecraft 'com.mojang:minecraft:{mc}'
    mappings loom.officialMojangMappings()
    modImplementation 'net.fabricmc:fabric-loader:{fabric_loader}'
}}
tasks.withType(JavaCompile).configureEach {{ options.release = {java}; options.encoding = 'UTF-8' }}
java {{ sourceCompatibility = JavaVersion.toVersion({java}); targetCompatibility = JavaVersion.toVersion({java}) }}
'''

GRADLE_FABRIC_NOREMAP = '''plugins {{ id 'net.fabricmc.fabric-loom' version '{loom}' }}
version = '{version}+{mc}-fabric'
group = 'pl.justminecraft'
base {{ archivesName = '{mod_id}' }}
repositories {{ mavenCentral() }}
dependencies {{
    minecraft 'com.mojang:minecraft:{mc}'
    implementation 'net.fabricmc:fabric-loader:{fabric_loader}'
}}
tasks.withType(JavaCompile).configureEach {{ options.release = {java}; options.encoding = 'UTF-8' }}
'''

GRADLE_FORGE = '''plugins {{ id 'net.minecraftforge.gradle' version '[6.0,6.2)' }}
version = '{version}+{mc}-forge'
group = 'pl.justminecraft'
base {{ archivesName = '{mod_id}' }}
java.toolchain.languageVersion = JavaLanguageVersion.of({toolchain})
minecraft {{ mappings channel: 'official', version: '{mc}' }}
dependencies {{ minecraft 'net.minecraftforge:forge:{mc}-{forge}' }}
tasks.withType(JavaCompile).configureEach {{ options.release = {java}; options.encoding = 'UTF-8' }}
jar.finalizedBy('reobfJar')
'''

GRADLE_NEOFORGE = '''plugins {{ id 'net.neoforged.moddev' version '{mdg}' }}
version = '{version}+{mc}-neoforge'
group = 'pl.justminecraft'
base {{ archivesName = '{mod_id}' }}
java.toolchain.languageVersion = JavaLanguageVersion.of({java})
neoForge {{ version = '{neoforge}' }}
tasks.withType(JavaCompile).configureEach {{ options.encoding = 'UTF-8' }}
'''

SETTINGS = '''pluginManagement {{
    repositories {{
        maven {{ url = 'https://maven.fabricmc.net/' }}
        mavenCentral()
        maven {{ url = 'https://maven.minecraftforge.net/' }}
        maven {{ url = 'https://maven.neoforged.net/releases' }}
        gradlePluginPortal()
    }}
}}
plugins {{ id 'org.gradle.toolchains.foojay-resolver-convention' version '0.9.0' }}
rootProject.name = '{mod_id}-{id}'
'''

CFG = json.loads(os.path.expanduser((ROOT / 'tools.json').read_text()).replace('"~/', '"' + os.path.expanduser('~/')))


def generate(t):
    d = GEN / t['id']
    if d.exists():
        shutil.rmtree(d)
    (d / 'src' / 'main').mkdir(parents=True)
    env = {'MC': vnum(t['mc']), 'FABRIC': t['loader'] == 'fabric', 'FORGE': t['loader'] == 'forge', 'NEOFORGE': t['loader'] == 'neoforge'}
    mcv = vnum(t['mc'])
    rng = t['range']
    subst = {
        'version': VERSION, 'mod_id': MOD_ID, 'mc': t['mc'],
        'mc_range_fabric': ' '.join(rng) if isinstance(rng, list) else '',
        'mc_range_forge': rng if isinstance(rng, str) else '',
        'loader_range': {'forge': '[' + t.get('forge', '0').split('.')[0] + ',)', 'neoforge': '[' + '.'.join(t.get('neoforge', '0').split('.')[:2]) + ',)', 'fabric': ''}[t['loader']],
        'pack_format': str(6 if mcv < 11700 else 7 if mcv < 11800 else 8 if mcv < 11900 else 9 if mcv < 11903 else 12 if mcv < 11904 else 13 if mcv < 12000 else 15 if mcv < 12002 else 22 if mcv < 12005 else 32 if mcv < 12100 else 34),
        'java_req': f'>={t["java"]}',
    }
    copy_tree(SRC / 'common' / 'java', d / 'src' / 'main' / 'java', env, subst)
    copy_tree(SRC / t['loader'] / 'java', d / 'src' / 'main' / 'java', env, subst)
    copy_tree(SRC / 'common' / 'resources', d / 'src' / 'main' / 'resources', env, subst)
    copy_tree(SRC / t['loader'] / 'resources', d / 'src' / 'main' / 'resources', env, subst)
    res = d / 'src' / 'main' / 'resources' / 'META-INF'
    if t['loader'] == 'neoforge' and mcv < 12005 and (res / 'neoforge.mods.toml').exists():
        (res / 'neoforge.mods.toml').rename(res / 'mods.toml')
    if t['loader'] == 'fabric':
        noremap = mcv >= 260000
        tpl = GRADLE_FABRIC_NOREMAP if noremap else GRADLE_FABRIC
        (d / 'build.gradle').write_text(tpl.format(mc=t['mc'], java=t['java'], version=VERSION, mod_id=MOD_ID,
                                                  loom=CFG['loom_noremap' if noremap else 'loom'], fabric_loader=CFG['fabric_loader']))
    elif t['loader'] == 'forge':
        (d / 'build.gradle').write_text(GRADLE_FORGE.format(mc=t['mc'], forge=t['forge'], java=t['java'], toolchain=max(17, t['java']), version=VERSION, mod_id=MOD_ID))
    else:
        (d / 'build.gradle').write_text(GRADLE_NEOFORGE.format(mc=t['mc'], neoforge=t['neoforge'], java=t['java'], version=VERSION, mod_id=MOD_ID,
                                                              mdg=CFG['mdg']))
    (d / 'settings.gradle').write_text(SETTINGS.format(mod_id=MOD_ID, id=t['id']))
    (d / 'gradle.properties').write_text('org.gradle.jvmargs=-Xmx3G\norg.gradle.daemon=false\norg.gradle.java.installations.auto-download=true\n'
                                         f'org.gradle.java.installations.paths={",".join(CFG["jdks"])}\n')
    return d


def gradle_for(t):
    g = CFG['gradle']
    if t['loader'] == 'forge':
        return g['forge']
    if t['loader'] == 'fabric' and vnum(t['mc']) >= 260000:
        return g.get('fabric_noremap', g['fabric'])
    return g[t['loader']]


def build(t, d):
    gradle = gradle_for(t)
    java_home = CFG['gradle_java_new'] if t['loader'] == 'fabric' and vnum(t['mc']) >= 260000 else CFG['gradle_java']
    env = {**os.environ, 'JAVA_HOME': java_home}
    log = d / 'build.log'
    if gradle.startswith('wrapper:'):
        # nowszy Gradle przez standardowy wrapper (pobiera się raz do ~/.gradle/wrapper)
        w = ROOT / 'wrapper'
        shutil.copy2(w / 'gradlew', d / 'gradlew')
        (d / 'gradle' / 'wrapper').mkdir(parents=True, exist_ok=True)
        shutil.copy2(w / 'gradle-wrapper.jar', d / 'gradle' / 'wrapper' / 'gradle-wrapper.jar')
        (d / 'gradle' / 'wrapper' / 'gradle-wrapper.properties').write_text(
            f'distributionUrl=https\\://services.gradle.org/distributions/gradle-{gradle[8:]}-bin.zip\n'
            'distributionBase=GRADLE_USER_HOME\ndistributionPath=wrapper/dists\nzipStoreBase=GRADLE_USER_HOME\nzipStorePath=wrapper/dists\n')
        open(log, 'w').close()
        gradle = str(d / 'gradlew')
    with open(log, 'a') as f:
        r = subprocess.run([gradle, 'build', '-x', 'test', '--no-daemon', '--console=plain', '--stacktrace'], cwd=d, env=env, stdout=f, stderr=subprocess.STDOUT)
    if r.returncode != 0:
        return None
    libs = d / 'build' / 'libs'
    jars = [j for j in libs.glob('*.jar') if not j.name.endswith(('-sources.jar', '-dev.jar', '-dev-shadow.jar', '-slim.jar'))]
    if not jars:
        return None
    jar = max(jars, key=lambda j: j.stat().st_mtime)
    OUT.mkdir(exist_ok=True)
    dest = OUT / f'{MOD_ID}-{VERSION}+{t["mc"]}-{t["loader"]}.jar'
    shutil.copy2(jar, dest)
    return dest


def bounds(t):
    r = t['range']
    if isinstance(r, list):
        lo = next(x[2:] for x in r if x.startswith('>='))
        hi = next(x[1:] for x in r if x.startswith('<'))
    else:
        lo, hi = r.strip('[)').split(',')
    return lo, hi


def write_index():
    """out/index.json – launcher wybiera z niego jar dla wersji i loadera instancji."""
    items = []
    for t in targets():
        f = OUT / f'{MOD_ID}-{VERSION}+{t["mc"]}-{t["loader"]}.jar'
        if f.exists():
            lo, hi = bounds(t)
            items.append({'file': f.name, 'loader': t['loader'], 'mc': t['mc'], 'min': lo, 'max': hi})
    (OUT / 'index.json').write_text(json.dumps({'version': VERSION, 'jars': items}, indent=1))
    # kopia do launchera (assets/justhud) – stamtąd launcher dokłada jar do instancji
    dest = ROOT.parent / 'assets' / 'justhud'
    dest.mkdir(parents=True, exist_ok=True)
    for f in dest.glob('*.jar'):
        f.unlink()
    for it in items:
        shutil.copy2(OUT / it['file'], dest / it['file'])
    shutil.copy2(OUT / 'index.json', dest / 'index.json')


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    gen_only = '--gen-only' in sys.argv
    allt = list(targets())
    ids = {t['id'] for t in allt}
    sel = [t for t in allt if not args or any(t['id'] == a or (a not in ids and t['id'].startswith(a)) for a in args)]
    ok, bad = [], []
    for t in sel:
        d = generate(t)
        if gen_only:
            print('wygenerowano', d)
            continue
        print(f'==> {t["id"]}', flush=True)
        jar = build(t, d)
        if jar:
            ok.append(t['id']); print(f'    OK  {jar.name}', flush=True)
        else:
            bad.append(t['id']); print(f'    BŁĄD  zobacz {d / "build.log"}', flush=True)
    if not gen_only:
        write_index()
        print(f'\nGotowe: {len(ok)}/{len(sel)}' + (f'  błędy: {", ".join(bad)}' if bad else ''))
        sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
