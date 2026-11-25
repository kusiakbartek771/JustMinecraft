package pl.justminecraft.hud;

import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;

import java.time.LocalTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** Widżety HUD. Każdy zna swój rozmiar (do kotwiczenia) i rysuje się od (0,0). */
public final class Widgets {
    public static final int TEXT = 0xFFEEF0F6, DIM = 0xFF8B91A3, GOOD = 0xFF4ADE80, WARN = 0xFFFACC15, BAD = 0xFFFF3D5E;

    public abstract static class Widget {
        public final String id;
        protected Widget(String id) { this.id = id; }
        public abstract String name();
        public abstract int styles();
        public abstract String styleName(int style);
        /** null = nic do pokazania (widżet jest ukryty poza edytorem) */
        public abstract int[] size(Gfx g, boolean preview);
        public abstract void render(Gfx g, int w, int h, boolean preview);
        public Config.WidgetCfg cfg() { return JustHud.config().widget(id); }
    }

    public static final List<Widget> ALL = Arrays.asList(new MusicW(), new ArmorW(), new CoordsW(), new FpsW(), new ClockW());

    static int bg() {
        int a = Math.round(JustHud.config().background * 255);
        return (a << 24) | 0x0D0E12;
    }

    static void panel(Gfx g, int w, int h) {
        if (JustHud.config().background > 0) g.panel(0, 0, w, h, bg());
    }

    // ---------- JustMusic: teraz gra ----------
    static final class MusicW extends Widget {
        String lastKey = null;
        long changedAt = 0;
        float shownProgress = 0;
        long lastFrame = Anim.now();

        MusicW() { super("music"); }
        public String name() { return T.t("Muzyka (JustMusic)", "Music (JustMusic)"); }
        public int styles() { return 2; }
        public String styleName(int s) { return s == 0 ? T.t("pełny", "full") : T.t("kompaktowy", "compact"); }

        public int[] size(Gfx g, boolean preview) {
            Music.State st = Music.state();
            if (!preview && !st.hasTrack() && (JustHud.config().hideMusicWhenIdle || !st.launcher)) return null;
            return cfg().style == 1 ? new int[] { 150, 22 } : new int[] { 172, 36 };
        }

        public void render(Gfx g, int w, int h, boolean preview) {
            Music.State st = Music.state();
            boolean sample = preview && !st.hasTrack();
            String title = sample ? "Never Gonna Give You Up" : st.hasTrack() ? st.title : "JustMusic";
            String artist = sample ? "Rick Astley" : st.hasTrack() ? (st.artist == null ? "" : st.artist)
                    : !st.launcher ? T.t("uruchom launcher JustMinecraft", "start JustMinecraft launcher")
                    : !st.connected ? T.t("włącz JustMusic", "start JustMusic") : T.t("nic nie gra", "nothing playing");
            boolean playing = sample || st.playing;
            String key = title + "|" + artist;
            if (!key.equals(lastKey)) { if (lastKey != null) changedAt = Anim.now(); lastKey = key; }
            long nowMs = Anim.now();
            float dt = Math.min(0.1f, (nowMs - lastFrame) / 1000f);
            lastFrame = nowMs;

            panel(g, w, h);
            int accent = JustHud.config().accent;
            boolean compact = cfg().style == 1;
            int sq = compact ? 14 : 26, pad = compact ? 4 : 5;

            // kwadrat z „korektorem” – wskakuje sprężyście przy zmianie utworu (npcover)
            float pop = Anim.spring(Anim.progress(changedAt, 420));
            float s = 0.82f + 0.18f * pop;
            g.push(pad + sq / 2f, pad + sq / 2f, s);
            g.panel(-sq / 2, -sq / 2, sq, sq, accent);
            int bars = 4, bw = compact ? 2 : 3, gap = compact ? 1 : 2;
            int total = bars * bw + (bars - 1) * gap;
            double tt = nowMs / 1000.0;
            for (int i = 0; i < bars; i++) {
                float k = playing && JustHud.config().animations ? (float) (0.5 + 0.5 * Math.sin(tt * (2 * Math.PI / 0.9) + i * 1.3)) : 0.25f + 0.1f * i % 3;
                int maxH = sq - (compact ? 4 : 10);
                int bh = Math.max(2, Math.round(2 + (maxH - 2) * k));
                int bx = -total / 2 + i * (bw + gap);
                g.fill(bx, sq / 2 - (compact ? 2 : 5) - bh, bx + bw, sq / 2 - (compact ? 2 : 5), 0xF2FFFFFF);
            }
            g.pop();

            // tekst wjeżdża z lewej (nptext)
            float tp = Anim.easeOut(Anim.progress(changedAt + 60, 360));
            float oldAlpha = g.alpha;
            g.alpha = oldAlpha * (changedAt == 0 ? 1 : tp);
            int tx = pad + sq + 6 - Math.round(10 * (1 - (changedAt == 0 ? 1 : tp)));
            int tw = w - tx - 6;
            if (compact) {
                g.text(g.fit(title + (artist.isEmpty() ? "" : " · " + artist), tw), tx, 7, TEXT);
            } else {
                g.text(g.fit(title, tw), tx, 7, TEXT);
                g.text(g.fit(artist, tw), tx, 18, DIM);
            }
            g.alpha = oldAlpha;

            // pasek postępu (płynny)
            double dur = sample ? 213 : st.duration;
            double pos = sample ? 77 + (nowMs / 1000.0) % 100 : st.position();
            float target = dur > 0 ? (float) Math.min(1, pos / dur) : 0;
            shownProgress = Math.abs(target - shownProgress) > 0.2f ? target : Anim.approach(shownProgress, target, 8f, dt);
            if (dur > 0) {
                int by = h - 3, bx0 = compact ? tx : pad, bx1 = w - pad;
                g.fill(bx0, by, bx1, by + 2, 0x33FFFFFF);
                g.fill(bx0, by, bx0 + Math.round((bx1 - bx0) * shownProgress), by + 2, accent);
            }
            if (!playing && st.hasTrack()) g.text("II", w - 12, compact ? 7 : 7, DIM);
        }
    }

    // ---------- zbroja i przedmioty w rękach ----------
    static final class ArmorW extends Widget {
        ArmorW() { super("armor"); }
        public String name() { return T.t("Wytrzymałość zbroi", "Armor durability"); }
        public int styles() { return 3; }
        public String styleName(int s) { return s == 0 ? T.t("procenty", "percent") : s == 1 ? T.t("wartości", "values") : T.t("poziomo", "horizontal"); }

        List<ItemStack> items(boolean preview) {
            List<ItemStack> out = new ArrayList<>();
            LocalPlayer p = Minecraft.getInstance().player;
            if (p != null) {
                for (EquipmentSlot slot : new EquipmentSlot[] { EquipmentSlot.HEAD, EquipmentSlot.CHEST, EquipmentSlot.LEGS, EquipmentSlot.FEET }) {
                    ItemStack s = p.getItemBySlot(slot);
                    if (!s.isEmpty()) out.add(s);
                }
                if (p.getMainHandItem().isDamageableItem()) out.add(p.getMainHandItem());
                if (p.getOffhandItem().isDamageableItem()) out.add(p.getOffhandItem());
            }
            if (out.isEmpty() && preview) {
                // przykład do edytora (bez świata część wersji nie pozwala tworzyć przedmiotów)
                try {
                    out.add(damaged(new ItemStack(Items.DIAMOND_HELMET), 0.15f));
                    out.add(damaged(new ItemStack(Items.DIAMOND_CHESTPLATE), 0.55f));
                    out.add(damaged(new ItemStack(Items.IRON_LEGGINGS), 0.85f));
                    out.add(new ItemStack(Items.NETHERITE_BOOTS));
                } catch (Throwable e) {
                    out.clear();
                }
            }
            return out;
        }

        static ItemStack damaged(ItemStack s, float frac) {
            s.setDamageValue(Math.round(s.getMaxDamage() * frac));
            return s;
        }

        static String label(ItemStack s, int style) {
            if (!s.isDamageableItem()) return s.getCount() > 1 ? "×" + s.getCount() : "";
            int left = s.getMaxDamage() - s.getDamageValue();
            return style == 1 ? String.valueOf(left) : Math.round(100f * left / s.getMaxDamage()) + "%";
        }

        static int color(ItemStack s) {
            if (!s.isDamageableItem()) return TEXT;
            float f = (s.getMaxDamage() - s.getDamageValue()) / (float) s.getMaxDamage();
            int c = f > 0.5f ? Anim.lerpColor(WARN, GOOD, (f - 0.5f) * 2) : Anim.lerpColor(BAD, WARN, f * 2);
            if (f < 0.1f && JustHud.config().animations) {
                float pulse = (float) (0.55 + 0.45 * Math.sin(Anim.now() / 160.0));
                c = (Math.round(255 * pulse) << 24) | (c & 0xFFFFFF);
            }
            return c;
        }

        public int[] size(Gfx g, boolean preview) {
            List<ItemStack> it = items(preview);
            if (it.isEmpty()) return preview ? new int[] { g.width(name()) + 12, 15 } : null;
            int style = cfg().style;
            if (style == 2) return new int[] { 4 + it.size() * 20, 30 };
            int tw = 0;
            for (ItemStack s : it) tw = Math.max(tw, g.width(label(s, style)));
            return new int[] { 4 + 16 + 4 + tw + 5, 4 + it.size() * 18 };
        }

        public void render(Gfx g, int w, int h, boolean preview) {
            List<ItemStack> it = items(preview);
            int style = cfg().style;
            panel(g, w, h);
            if (it.isEmpty()) { g.text(name(), 6, 4, DIM); return; }
            for (int i = 0; i < it.size(); i++) {
                ItemStack s = it.get(i);
                if (style == 2) {
                    int x = 4 + i * 20;
                    g.item(s, x, 3);
                    String l = label(s, 0);
                    g.text(l, x + 8 - g.width(l) / 2, 20, color(s));
                } else {
                    int y = 3 + i * 18;
                    g.item(s, 4, y);
                    g.text(label(s, style), 24, y + 4, color(s));
                }
            }
        }
    }

    // ---------- współrzędne i kierunek ----------
    static final class CoordsW extends Widget {
        CoordsW() { super("coords"); }
        public String name() { return T.t("Współrzędne", "Coordinates"); }
        public int styles() { return 2; }
        public String styleName(int s) { return s == 0 ? T.t("z kierunkiem", "with facing") : T.t("jedna linia", "single line"); }

        String[] lines() {
            LocalPlayer p = Minecraft.getInstance().player;
            int x = 0, y = 64, z = 0;
            String dir = "north";
            if (p != null) { x = p.getBlockX(); y = p.getBlockY(); z = p.getBlockZ(); dir = p.getDirection().getName(); }
            String xyz = "X " + x + "  Y " + y + "  Z " + z;
            if (cfg().style == 1) return new String[] { xyz };
            return new String[] { xyz, T.t("Kierunek: ", "Facing: ") + facing(dir) };
        }

        static String facing(String d) {
            switch (d) {
                case "north": return T.t("północ (−Z)", "north (−Z)");
                case "south": return T.t("południe (+Z)", "south (+Z)");
                case "east": return T.t("wschód (+X)", "east (+X)");
                case "west": return T.t("zachód (−X)", "west (−X)");
                default: return d;
            }
        }

        public int[] size(Gfx g, boolean preview) {
            String[] l = lines();
            int w = 0;
            for (String s : l) w = Math.max(w, g.width(s));
            return new int[] { w + 12, 6 + l.length * 11 };
        }

        public void render(Gfx g, int w, int h, boolean preview) {
            panel(g, w, h);
            g.fill(0, 3, 2, h - 3, JustHud.config().accent);
            String[] l = lines();
            for (int i = 0; i < l.length; i++) g.text(l[i], 6, 4 + i * 11, i == 0 ? TEXT : DIM);
        }
    }

    // ---------- FPS ----------
    static final class FpsW extends Widget {
        FpsW() { super("fps"); }
        public String name() { return "FPS"; }
        public int styles() { return 1; }
        public String styleName(int s) { return ""; }

        public int[] size(Gfx g, boolean preview) { return new int[] { g.width(JustHud.fps() + " FPS") + 16, 15 }; }

        public void render(Gfx g, int w, int h, boolean preview) {
            panel(g, w, h);
            int fps = JustHud.fps();
            int c = fps >= 60 ? GOOD : fps >= 30 ? WARN : BAD;
            g.panel(5, 5, 4, 5, c);
            g.text(fps + " FPS", 12, 4, TEXT);
        }
    }

    // ---------- zegar i dzień w grze ----------
    static final class ClockW extends Widget {
        ClockW() { super("clock"); }
        public String name() { return T.t("Zegar i dzień", "Clock & day"); }
        public int styles() { return 2; }
        public String styleName(int s) { return s == 0 ? T.t("godzina + dzień w grze", "time + game day") : T.t("tylko godzina", "time only"); }

        String[] lines() {
            LocalTime t = LocalTime.now();
            String real = String.format("%02d:%02d", t.getHour(), t.getMinute());
            if (cfg().style == 1) return new String[] { real };
            long dt = JustHud.dayTime();
            long day = dt / 24000L + 1, tod = (dt + 6000) % 24000;
            String game = String.format("%s %d · %02d:%02d", T.t("Dzień", "Day"), day, tod / 1000, (tod % 1000) * 60 / 1000);
            return new String[] { real, game };
        }

        public int[] size(Gfx g, boolean preview) {
            String[] l = lines();
            int w = 0;
            for (String s : l) w = Math.max(w, g.width(s));
            return new int[] { w + 12, 6 + l.length * 11 };
        }

        public void render(Gfx g, int w, int h, boolean preview) {
            panel(g, w, h);
            String[] l = lines();
            for (int i = 0; i < l.length; i++) {
                int tw = g.width(l[i]);
                g.text(l[i], (w - tw) / 2, 4 + i * 11, i == 0 ? TEXT : DIM);
            }
        }
    }

    private Widgets() {}
}
