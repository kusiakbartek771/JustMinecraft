# JustMinecraft ⛏️🎵

Launcher Minecrafta do modów – **Vanilla, Fabric, Quilt, Forge i NeoForge**, mody / modpacki / resource packi /
shadery / datapacki z **Modrinth**, paczki z **Google Drive** dla wszystkich i integracja z **[JustMusic](https://github.com/kusiakbartek771/JustMusic)**.
Działa na **Windows, Linux i macOS**. Aktualizuje się sam – jednym kliknięciem.

> Wcześniej: **JustLauncher** – stare wersje same zaktualizują się do JustMinecraft, ustawienia i instancje zostają.

## Funkcje

| | |
|---|---|
| 🎮 **Wszystkie loadery** | Vanilla (od 1.5 do najnowszych), Fabric, Quilt, Forge (1.7.10 → najnowszy) i NeoForge (także 1.20.1). Forge/NeoForge instalują się bez okna instalatora. |
| ☕ **Java sama** | launcher pobiera dokładnie tę Javę, której potrzebuje wersja gry (8, 17, 21, 25…) – od Mojang, a gdy jej brak, Eclipse Temurin. Można też wskazać własną. |
| 📦 **Instancje** | osobne instalacje z własnymi modami i światami, ikony (emoji/obraz), okładki, kolory, grupy, ulubione, duplikowanie, import folderu `.minecraft` lub innego launchera, wybór folderu instalacji |
| 🧩 **Modrinth** | wyszukiwarka modów, modpacków, resource packów, shaderów i datapacków; automatyczne zależności; shadery same doinstalowują Iris/Oculus; sprawdzanie i instalacja aktualizacji; rozpoznawanie ręcznie dodanych modów po SHA1 |
| ⚡ **Wydajność** | równoległe pobieranie z weryfikacją SHA1, profile JVM (G1GC / ZGC / słaby PC), automatyczny dobór RAM do liczby modów, „Pakiet wydajności” jednym kliknięciem (Sodium/Embeddium, Lithium, FerriteCore, ModernFix, EntityCulling…), GameMode i dedykowana karta graficzna na Linuksie |
| ☁️ **Google Drive** | import modów z publicznego folderu/pliku; „Paczki autora” widoczne dla wszystkich; synchronizacja pobiera tylko zmiany |
| 🎵 **JustMusic** | muzyka sama startuje z grą (playlista / wznowienie), ciszej podczas gry, pauza po wyjściu, „teraz gra” w launcherze, uruchamianie Minecrafta z JustMusic |
| 🛠️ **Bez błędów** | czytelne komunikaty, okno awarii z podpowiedziami (pamięć, Java, konflikty modów), konsola na żywo, raporty awarii, „Napraw instalację” |
| 🎨 **Customizacja** | 12 motywów, kolor akcentu, tło (gradient / obraz z rozmyciem), efekt szkła, zaokrąglenia, czcionki, rozmiar tekstu, gęstość, panel po lewej/prawej, kompaktowy panel, animacje, własny CSS, polski i angielski |
| 🔄 **Aktualizacje** | z GitHub Releases – w tle albo jednym kliknięciem |

Skróty: <kbd>Ctrl</kbd>+<kbd>N</kbd> nowa instancja, <kbd>Ctrl</kbd>+<kbd>F</kbd> szukaj, <kbd>Ctrl</kbd>+<kbd>,</kbd> ustawienia, <kbd>Ctrl</kbd>+<kbd>1…5</kbd> sekcje.
Pliki `.jar`/`.zip`/`.mrpack` można przeciągnąć do okna.

## Instalacja

Pobierz z [Releases](https://github.com/kusiakbartek771/JustMinecraft/releases/latest):

- **Windows** – `JustMinecraft-Setup-x.y.z.exe` (możesz wybrać folder instalacji) albo wersja `portable`
- **Linux** – `JustMinecraft-x86_64.AppImage` (aktualizuje się sam; wymaga FUSE 2: Arch `sudo pacman -S fuse2`, Ubuntu `sudo apt install libfuse2`), `.deb` albo `.pacman`
- **macOS** – `.dmg` (Intel i Apple Silicon). Aplikacja nie jest podpisana: przy pierwszym uruchomieniu kliknij prawym → Otwórz.

> Na Linuksie stare wersje (LWJGL 2, np. 1.12.2) potrzebują programu `xrandr` (Arch: `sudo pacman -S xorg-xrandr`, Ubuntu: `sudo apt install x11-xserver-utils`). Launcher sam o tym przypomni.

## Logowanie Microsoft

Microsoft wymaga, by każdy launcher miał **własną aplikację Azure zatwierdzoną przez Mojang**:

1. [Azure Portal](https://portal.azure.com) → *App registrations* → *New registration* → konta: **Personal Microsoft accounts only**.
2. *Authentication* → *Allow public client flows* = **Yes**.
3. Skopiuj *Application (client) ID* i wypełnij formularz dostępu do API Minecrafta: <https://aka.ms/mce-reviewappid>.
4. Po akceptacji wpisz ID w `package.json` → `justminecraft.msClientId` (dla wszystkich) albo w Ustawienia → Zaawansowane.

Do tego czasu działają konta offline (singleplayer i serwery bez weryfikacji).

## Paczki z Google Drive dla wszystkich

1. Wrzuć mody do folderu na Google Drive (opcjonalnie podfoldery `mods`, `config`, `resourcepacks`, `shaderpacks`).
2. *Udostępnij* → **Każda osoba mająca link**.
3. Dopisz paczkę do [`packs/packs.json`](packs/packs.json) (wzór jest w pliku) i wypchnij zmianę –
   pojawi się każdemu w zakładce **Paczki i Drive** bez wydawania nowej wersji.

Każdy może też wkleić dowolny link w „Import z linku Drive”. Gdy zmienisz zawartość folderu, gracze klikają **Synchronizuj** – pobierają się tylko zmiany, a usunięte pliki znikają.

## JustMusic

1. Zainstaluj [JustMusic](https://github.com/kusiakbartek771/JustMusic).
2. W launcherze: **JustMusic → Zainstaluj wtyczkę** (albo w JustMusic: Ustawienia → Pluginy → sklep → „Minecraft (JustMinecraft)”).
3. Włącz wtyczkę w JustMusic – połączenie (lokalnie, `127.0.0.1:47851`) nawiąże się samo.

Wtyczka jest w folderze [`justmusic-plugin/`](justmusic-plugin).

## Rozwój

```bash
npm install
npm start                 # uruchom
npm run dev               # z narzędziami deweloperskimi
node scripts/test-install.mjs fabric 1.21.1 --launch   # test rdzenia: instalacja + start gry bez GUI
node scripts/test-content.mjs                          # test Modrinth / zawartości / .mrpack
npm run dist:linux        # paczki lokalnie
```

### Wydanie nowej wersji

1. Podbij `version` w `package.json`, commit.
2. `git tag v1.1.0 && git push origin main v1.1.0`
3. GitHub Actions zbuduje Windows/macOS/Linux i opublikuje wydanie – launchery użytkowników same się zaktualizują.

### Struktura

```
src/main/core/     rdzeń: sieć, ZIP, wersje Mojang, Java, loadery, uruchamianie
src/main/          okno, IPC, instancje, zawartość, Modrinth, Google Drive, konta, JustMusic, aktualizacje
src/renderer/      interfejs (bez frameworka): widoki, motywy, tłumaczenia
justmusic-plugin/  wtyczka „Minecraft” dla JustMusic
packs/packs.json   polecane paczki (pobierane z GitHuba przy starcie)
```

---
Nie jest to oficjalny produkt Minecrafta. Nie jest zatwierdzony przez Mojang ani Microsoft ani z nimi powiązany.
