package pl.justminecraft.hud;

import com.mojang.blaze3d.platform.InputConstants;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;

/**
 * JustHUD – widżety JustMusic i Minecrafta (wytrzymałość zbroi, współrzędne, FPS, zegar).
 * Dokładany automatycznie przez launcher JustMinecraft. Edytor w grze: klawisz J (zmienisz w edytorze).
 */
public final class JustHud {
    public static final String ID = "justhud";
    private static Config config;
    private static boolean started;

    public static void LOG(String s) { System.out.println("[JustHUD] " + s); }

    /** Wywoływane przez loader przy starcie klienta (wczytanie ustawień jest leniwe). */
    public static void init() {
        LOG("start");
    }

    public static Config config() {
        if (config == null) config = Config.load(Minecraft.getInstance().gameDirectory.toPath());
        return config;
    }

    public static void save() { config().save(); }

    private static void ensureStarted() {
        if (started) return;
        started = true;
        config();
        Music.start();
    }

    // ---------- FPS (liczony z klatek HUD) ----------
    private static int frames, fps;
    private static long fpsAt = Anim.now();

    public static int fps() { return fps; }

    private static void countFrame() {
        frames++;
        long n = Anim.now();
        if (n - fpsAt >= 1000) { fps = Math.round(frames * 1000f / (n - fpsAt)); frames = 0; fpsAt = n; }
    }

    public static long dayTime() {
        Minecraft mc = Minecraft.getInstance();
        //#if MC >= 26.1
        return mc.level == null ? 6000 : mc.level.getDefaultClockTime();
        //#else
        return mc.level == null ? 6000 : mc.level.getDayTime();
        //#endif
    }

    // ---------- HUD ----------
    public static void renderHud(GuiGraphics graphics) {
        ensureStarted();
        countFrame();
        Minecraft mc = Minecraft.getInstance();
        if (!config().enabled || hudHidden(mc) || screen(mc) instanceof EditorScreen) return;
        if (mc.player == null) return;
        Gfx g = new Gfx(graphics);
        for (Widgets.Widget w : Widgets.ALL) {
            Config.WidgetCfg c = w.cfg();
            if (!c.on) continue;
            drawWidget(g, w, false);
        }
    }

    static final java.util.Map<String, int[]> lastSizes = new java.util.HashMap<>(), lastRects = new java.util.HashMap<>();

    /** Rysuje widżet w jego miejscu; zwraca prostokąt {x, y, w, h} na ekranie (albo null). */
    static int[] drawWidget(Gfx g, Widgets.Widget w, boolean preview) {
        int[] sz;
        try {
            sz = w.size(g, preview);
        } catch (Throwable e) {
            LOG("Błąd widżetu " + w.id + ": " + e);
            return null;
        }
        if (sz == null) return null;
        Config.WidgetCfg c = w.cfg();
        int[] r = place(c, sz[0], sz[1], g.screenW(), g.screenH());
        lastSizes.put(w.id, sz);
        lastRects.put(w.id, r);
        g.push(r[0], r[1], c.scale);
        try {
            w.render(g, sz[0], sz[1], preview);
        } catch (Throwable e) {
            LOG("Błąd widżetu " + w.id + ": " + e);
        } finally {
            g.pop();
        }
        return r;
    }

    /** Pozycja z kotwicy (siatka 3×3) i przesunięcia; widżet nie wychodzi poza ekran. */
    static int[] place(Config.WidgetCfg c, int w, int h, int sw, int sh) {
        int W = Math.round(w * c.scale), H = Math.round(h * c.scale);
        int col = c.anchor % 3, row = c.anchor / 3;
        int x = (col == 0 ? 0 : col == 1 ? (sw - W) / 2 : sw - W) + c.x;
        int y = (row == 0 ? 0 : row == 1 ? (sh - H) / 2 : sh - H) + c.y;
        x = Math.max(0, Math.min(sw - W, x));
        y = Math.max(0, Math.min(sh - H, y));
        return new int[] { x, y, W, H };
    }

    // ---------- klawisze (bez rejestracji w opcjach – działa tak samo na każdym loaderze) ----------
    private static final boolean[] wasDown = new boolean[4];

    // test automatyczny: -Djusthud.selftest=1 otwiera edytor na ekranie tytułowym i po kilku sekundach zamyka grę
    private static long selftestAt = 0;
    private static boolean selftestShot;

    public static void tick() {
        Minecraft mc = Minecraft.getInstance();
        if (Boolean.getBoolean("justhud.selftest")) {
            if (selftestAt == 0 && screen(mc) instanceof net.minecraft.client.gui.screens.TitleScreen) {
                selftestAt = Anim.now();
                ensureStarted();
                setScreen(mc, new EditorScreen());
                LOG("selftest: edytor otwarty");
            } else if (selftestAt > 0 && !selftestShot && Anim.now() - selftestAt > 4000) {
                selftestShot = true;
                //#if MC < 26.3
                net.minecraft.client.Screenshot.grab(mc.gameDirectory, mc.getMainRenderTarget(), msg -> LOG("selftest: zrzut " + msg.getString()));
                //#endif
            } else if (selftestAt > 0 && Anim.now() - selftestAt > Long.getLong("justhud.selftestMs", 12000L)) {
                LOG("selftest: OK – zamykam grę");
                mc.stop();
            }
        }
        if (mc.player == null) return;
        ensureStarted();
        Config c = config();
        int[] keys = { c.editorKey, c.playPauseKey, c.nextKey, c.prevKey };
        for (int i = 0; i < keys.length; i++) {
            boolean down = keys[i] > 0 && screen(mc) == null && isDown(keys[i]);
            if (down && !wasDown[i]) {
                switch (i) {
                    case 0: setScreen(mc, new EditorScreen()); break;
                    case 1: Music.command("toggle"); break;
                    case 2: Music.command("next"); break;
                    case 3: Music.command("prev"); break;
                    default: break;
                }
            }
            wasDown[i] = down;
        }
    }

    static net.minecraft.client.gui.screens.Screen screen(Minecraft mc) {
        //#if MC >= 26.3
        return mc.gui.screen();
        //#else
        return mc.screen;
        //#endif
    }

    static void setScreen(Minecraft mc, net.minecraft.client.gui.screens.Screen s) {
        //#if MC >= 26.3
        mc.gui.setScreen(s);
        //#else
        mc.setScreen(s);
        //#endif
    }

    static boolean hudHidden(Minecraft mc) {
        //#if MC >= 26.3
        return mc.gui.hud.isHidden();
        //#else
        return mc.options.hideGui;
        //#endif
    }

    static boolean isDown(int key) {
        //#if MC >= 26.3
        return InputConstants.isKeyDown(key);
        //#elif MC >= 1.21.9
        return InputConstants.isKeyDown(Minecraft.getInstance().getWindow(), key);
        //#else
        return InputConstants.isKeyDown(Minecraft.getInstance().getWindow().getWindow(), key);
        //#endif
    }

    private JustHud() {}
}
