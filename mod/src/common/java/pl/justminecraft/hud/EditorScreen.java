package pl.justminecraft.hud;

import com.mojang.blaze3d.platform.InputConstants;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
//#if MC >= 1.21.9
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
//#endif

import java.util.ArrayList;
import java.util.List;

/**
 * Edytor JustHUD w grze: przeciąganie widżetów, kółko = rozmiar, prawy przycisk = styl,
 * panel z włączaniem widżetów, kolorem akcentu, tłem, animacjami i klawiszami.
 */
public class EditorScreen extends Screen {
    private static final int PW = 168, ROW = 13;
    private boolean panelHidden;
    private Widgets.Widget dragging, hovered;
    private int dragDX, dragDY;
    private int listening = -1; // który klawisz ustawiamy
    private final long openedAt = Anim.now();
    private final List<Row> rows = new ArrayList<>();

    private interface Action { void run(int button); }

    private static final class Row {
        final int x, y, w, h;
        final Action action;
        Row(int x, int y, int w, int h, Action a) { this.x = x; this.y = y; this.w = w; this.h = h; this.action = a; }
        boolean hit(double mx, double my) { return mx >= x && mx < x + w && my >= y && my < y + h; }
    }

    public EditorScreen() {
        super(Component.literal("JustHUD"));
    }

    @Override
    public boolean isPauseScreen() { return false; }

    @Override
    public void onClose() {
        JustHud.save();
        super.onClose();
    }

    //#if MC >= 1.20.2
    @Override
    //#if MC >= 26.3
    public void extractBackground(GuiGraphics g, int mouseX, int mouseY, float partial) {}
    //#else
    public void renderBackground(GuiGraphics g, int mouseX, int mouseY, float partial) {}
    //#endif
    //#endif

    @Override
    //#if MC >= 26.3
    public void extractRenderState(GuiGraphics graphics, int mouseX, int mouseY, float partial) {
    //#else
    public void render(GuiGraphics graphics, int mouseX, int mouseY, float partial) {
    //#endif
        Gfx g = new Gfx(graphics);
        float open = Anim.easeOut(Anim.progress(openedAt, 280));
        g.fill(0, 0, width, height, ((int) (0x55 * open) << 24));

        // widżety
        hovered = null;
        for (Widgets.Widget w : Widgets.ALL) {
            if (!w.cfg().on) continue;
            int[] r = JustHud.drawWidget(g, w, true);
            if (r == null) continue;
            boolean hot = dragging == w || (dragging == null && !inPanel(mouseX, mouseY) && mouseX >= r[0] && mouseX < r[0] + r[2] && mouseY >= r[1] && mouseY < r[1] + r[3]);
            if (hot) hovered = w;
            g.outline(r[0] - 1, r[1] - 1, r[2] + 2, r[3] + 2, hot ? JustHud.config().accent : 0x66FFFFFF);
            if (hot) {
                String info = w.name() + (w.styles() > 1 ? " · " + w.styleName(w.cfg().style) : "") + " · " + Math.round(w.cfg().scale * 100) + "%";
                int ty = r[1] + r[3] + 3 + 10 > height ? r[1] - 12 : r[1] + r[3] + 3;
                int tw = g.width(info);
                g.panel(r[0], ty - 1, tw + 6, 11, 0xE00D0E12);
                g.text(info, r[0] + 3, ty, Widgets.TEXT);
            }
        }

        // panel (na osobnej warstwie – przykrywa widżety)
        g.layer();
        rows.clear();
        if (!panelHidden) drawPanel(g, mouseX, mouseY, open);
        else {
            String s = T.t("Tab – pokaż panel", "Tab – show panel");
            g.panel(6, 6, g.width(s) + 10, 14, 0xE00D0E12);
            g.text(s, 11, 9, Widgets.DIM);
            rows.add(new Row(6, 6, g.width(s) + 10, 14, b -> panelHidden = false));
        }

        String hint = T.t("Przeciągnij widżet · kółko: rozmiar · prawy przycisk: styl · Esc: zapisz i wyjdź",
                "Drag a widget · scroll: size · right click: style · Esc: save & exit");
        int hw = g.width(hint);
        g.panel((width - hw) / 2 - 6, height - 18, hw + 12, 14, 0xD00D0E12);
        g.text(hint, (width - hw) / 2, height - 15, Widgets.DIM);
    }

    private boolean inPanel(double mx, double my) {
        for (Row r : rows) if (r.hit(mx, my)) return true;
        return !panelHidden && mx >= px && mx < px + PW * ps && my >= py && my < py + PH * ps;
    }

    // panel: pozycja i skala na ekranie (rysujemy w lokalnych współrzędnych)
    private float px, py, ps = 1f;
    private static final int PH = 14 + 12 + 5 * ROW + 4 + 11 + 16 + 4 * ROW + 4 + 11 + 4 * ROW + 4 + 2 * ROW + 6;

    private void drawPanel(Gfx g, int smx, int smy, float open) {
        Config c = JustHud.config();
        ps = Math.min(1f, (height - 26f) / PH);
        px = (width - PW * ps) / 2f;
        py = Math.max(4f, (height - 22 - PH * ps) / 2f) + (1 - open) * 12;
        g.push(px, py, ps);
        int mx = Math.round((smx - px) / ps), my = Math.round((smy - py) / ps);
        int x = 0, y = 0;
        int accent = c.accent;
        g.panel(x, y, PW, PH, 0xF00D0E12);
        g.fill(x, y, x + PW, y + 2, accent);
        y += 6;
        g.text("JustHUD", x + 6, y, accent);
        String hide = T.t("ukryj (Tab)", "hide (Tab)");
        rowText(g, x + PW - g.width(hide) - 6, y, g.width(hide), hide, mx, my, Widgets.DIM, b -> panelHidden = true);
        y += 14;

        g.text(T.t("WIDŻETY", "WIDGETS"), x + 6, y, Widgets.DIM);
        y += 11;
        for (Widgets.Widget w : Widgets.ALL) {
            Config.WidgetCfg wc = w.cfg();
            String label = (wc.on ? "■ " : "□ ") + w.name();
            rowText(g, x + 6, y, PW - 12, label, mx, my, wc.on ? Widgets.TEXT : Widgets.DIM, b -> { wc.on = !wc.on; JustHud.save(); });
            y += ROW;
        }
        y += 4;
        g.text(T.t("WYGLĄD", "LOOK"), x + 6, y, Widgets.DIM);
        y += 11;
        // akcenty jak w JustMusic
        int sx = x + 6;
        for (int col : Config.ACCENTS) {
            final int cc = col;
            boolean on = col == c.accent;
            g.panel(sx, y, 10, 10, col);
            if (on) g.outline(sx - 1, y - 1, 12, 12, 0xFFFFFFFF);
            rows.add(screenRow(sx, y, 10, 10, b -> { c.accent = cc; JustHud.save(); }));
            sx += 13;
        }
        y += 16;
        rowText(g, x + 6, y, PW - 12, T.t("Tło: ", "Background: ") + Math.round(c.background * 100) + "%", mx, my, Widgets.TEXT, b -> {
            int i = 0;
            for (int k = 0; k < Config.BACKGROUNDS.length; k++) if (Math.abs(Config.BACKGROUNDS[k] - c.background) < 0.01f) i = k;
            c.background = Config.BACKGROUNDS[(i + (b == 1 ? Config.BACKGROUNDS.length - 1 : 1)) % Config.BACKGROUNDS.length];
            JustHud.save();
        });
        y += ROW;
        rowText(g, x + 6, y, PW - 12, T.t("Cień tekstu: ", "Text shadow: ") + yes(c.shadow), mx, my, Widgets.TEXT, b -> { c.shadow = !c.shadow; JustHud.save(); });
        y += ROW;
        rowText(g, x + 6, y, PW - 12, T.t("Animacje: ", "Animations: ") + yes(c.animations), mx, my, Widgets.TEXT, b -> { c.animations = !c.animations; JustHud.save(); });
        y += ROW;
        rowText(g, x + 6, y, PW - 12, T.t("Muzyka tylko gdy gra: ", "Music only when playing: ") + yes(c.hideMusicWhenIdle), mx, my, Widgets.TEXT, b -> { c.hideMusicWhenIdle = !c.hideMusicWhenIdle; JustHud.save(); });
        y += ROW + 4;

        g.text(T.t("KLAWISZE", "KEYS"), x + 6, y, Widgets.DIM);
        y += 11;
        String[] names = { T.t("Edytor", "Editor"), T.t("Play / pauza", "Play / pause"), T.t("Następny utwór", "Next track"), T.t("Poprzedni utwór", "Previous track") };
        int[] keys = { c.editorKey, c.playPauseKey, c.nextKey, c.prevKey };
        for (int i = 0; i < names.length; i++) {
            final int idx = i;
            String val = listening == i ? T.t("> naciśnij klawisz <", "> press a key <") : keyName(keys[i]);
            rowText(g, x + 6, y, PW - 12, names[i] + ": " + val, mx, my, listening == i ? accent : Widgets.TEXT, b -> listening = b == 1 && idx > 0 ? clearKey(idx) : idx);
            y += ROW;
        }
        y += 4;
        rowText(g, x + 6, y, PW - 12, T.t("Przywróć domyślne", "Reset to defaults"), mx, my, Widgets.BAD, b -> {
            Config d = Config.defaults();
            c.widgets = d.widgets; c.accent = d.accent; c.background = d.background; c.shadow = d.shadow; c.animations = d.animations;
            JustHud.save();
        });
        y += ROW;
        rowText(g, x + 6, y, PW - 12, T.t("Gotowe", "Done"), mx, my, accent, b -> onClose());
        g.pop();
    }

    /** Wiersz panelu w lokalnych współrzędnych → prostokąt na ekranie. */
    private Row screenRow(int x, int y, int w, int h, Action a) {
        return new Row(Math.round(px + x * ps), Math.round(py + y * ps), Math.max(1, Math.round(w * ps)), Math.max(1, Math.round(h * ps)), a);
    }

    private int clearKey(int idx) {
        Config c = JustHud.config();
        if (idx == 1) c.playPauseKey = -1;
        if (idx == 2) c.nextKey = -1;
        if (idx == 3) c.prevKey = -1;
        JustHud.save();
        return -1;
    }

    private static String yes(boolean b) { return b ? T.t("tak", "on") : T.t("nie", "off"); }

    static String keyName(int key) {
        if (key <= 0) return "—";
        try {
            //#if MC >= 26.3
            return InputConstants.Type.KEYBOARD.getOrCreate(key).getDisplayName().getString();
            //#else
            return InputConstants.Type.KEYSYM.getOrCreate(key).getDisplayName().getString();
            //#endif
        } catch (Throwable e) {
            return "#" + key;
        }
    }

    private void rowText(Gfx g, int x, int y, int w, String s, int mx, int my, int color, Action a) {
        Row local = new Row(x - 2, y - 2, w + 4, ROW - 1, a);
        if (local.hit(mx, my)) g.panel(local.x, local.y, local.w, local.h, 0x22FFFFFF);
        g.text(s, x, y, color);
        rows.add(screenRow(local.x, local.y, local.w, local.h, a));
    }

    // ---------- obsługa myszy i klawiatury (wspólna dla wszystkich wersji) ----------
    private boolean onClick(double mx, double my, int button) {
        for (Row r : new ArrayList<>(rows)) {
            if (r.hit(mx, my)) { r.action.run(button); return true; }
        }
        if (hovered != null) {
            if (button == 1) {
                Config.WidgetCfg c = hovered.cfg();
                c.style = (c.style + 1) % Math.max(1, hovered.styles());
                JustHud.save();
                return true;
            }
            if (button == 0) {
                int[] r = rect(hovered);
                if (r != null) { dragging = hovered; dragDX = (int) mx - r[0]; dragDY = (int) my - r[1]; }
                return true;
            }
        }
        return false;
    }

    private int[] rect(Widgets.Widget w) { return JustHud.lastRects.get(w.id); }

    private boolean onDrag(double mx, double my) {
        if (dragging == null) return false;
        Config.WidgetCfg c = dragging.cfg();
        int[] sz = lastSize(dragging);
        if (sz == null) return true;
        int W = Math.round(sz[0] * c.scale), H = Math.round(sz[1] * c.scale);
        int left = Math.max(0, Math.min(width - W, (int) mx - dragDX));
        int topY = Math.max(0, Math.min(height - H, (int) my - dragDY));
        int cx = left + W / 2, cy = topY + H / 2;
        int col = cx < width / 3 ? 0 : cx < 2 * width / 3 ? 1 : 2;
        int row = cy < height / 3 ? 0 : cy < 2 * height / 3 ? 1 : 2;
        c.anchor = row * 3 + col;
        c.x = left - (col == 0 ? 0 : col == 1 ? (width - W) / 2 : width - W);
        c.y = topY - (row == 0 ? 0 : row == 1 ? (height - H) / 2 : height - H);
        return true;
    }

    private boolean onRelease() {
        if (dragging == null) return false;
        dragging = null;
        JustHud.save();
        return true;
    }

    private boolean onScroll(double amount) {
        if (hovered == null) return false;
        Config.WidgetCfg c = hovered.cfg();
        c.scale = Math.max(0.5f, Math.min(2.5f, Math.round((c.scale + (amount > 0 ? 0.1f : -0.1f)) * 10) / 10f));
        JustHud.save();
        return true;
    }

    private boolean onKey(int key) {
        if (key == InputConstants.KEY_TAB) { panelHidden = !panelHidden; return true; }
        if (listening >= 0) {
            Config c = JustHud.config();
            if (key != InputConstants.KEY_ESCAPE) {
                if (listening == 0) c.editorKey = key;
                if (listening == 1) c.playPauseKey = key;
                if (listening == 2) c.nextKey = key;
                if (listening == 3) c.prevKey = key;
                JustHud.save();
            }
            listening = -1;
            return true;
        }
        if (key == JustHud.config().editorKey) { onClose(); return true; }
        return false;
    }

    // rozmiary widżetów z ostatniej klatki (do przeciągania)
    private int[] lastSize(Widgets.Widget w) {
        return JustHud.lastSizes.get(w.id);
    }

    //#if MC >= 1.21.9
    @Override
    public boolean mouseClicked(MouseButtonEvent e, boolean doubleClick) {
        return onClick(e.x(), e.y(), e.button()) || super.mouseClicked(e, doubleClick);
    }

    @Override
    public boolean mouseReleased(MouseButtonEvent e) {
        return onRelease() || super.mouseReleased(e);
    }

    @Override
    public boolean mouseDragged(MouseButtonEvent e, double dx, double dy) {
        return onDrag(e.x(), e.y()) || super.mouseDragged(e, dx, dy);
    }

    @Override
    public boolean keyPressed(KeyEvent e) {
        return onKey(e.key()) || super.keyPressed(e);
    }
    //#else
    @Override
    public boolean mouseClicked(double mx, double my, int button) {
        return onClick(mx, my, button) || super.mouseClicked(mx, my, button);
    }

    @Override
    public boolean mouseReleased(double mx, double my, int button) {
        return onRelease() || super.mouseReleased(mx, my, button);
    }

    @Override
    public boolean mouseDragged(double mx, double my, int button, double dx, double dy) {
        return onDrag(mx, my) || super.mouseDragged(mx, my, button, dx, dy);
    }

    @Override
    public boolean keyPressed(int key, int scan, int mods) {
        return onKey(key) || super.keyPressed(key, scan, mods);
    }
    //#endif

    //#if MC >= 1.20.2
    @Override
    public boolean mouseScrolled(double mx, double my, double h, double v) {
        return onScroll(v) || super.mouseScrolled(mx, my, h, v);
    }
    //#else
    @Override
    public boolean mouseScrolled(double mx, double my, double amount) {
        return onScroll(amount) || super.mouseScrolled(mx, my, amount);
    }
    //#endif
}
