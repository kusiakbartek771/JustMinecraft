package pl.justminecraft.hud;

import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;

import java.time.LocalTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Widżety HUD w stylu JustMusic: zaokrąglone ciemne karty z cienkim obramowaniem, okładka w gradiencie Just,
 * cienkie paski postępu, małe szare podpisy. Każdy widżet zna swój rozmiar (do kotwiczenia) i rysuje się od (0,0).
 */
public final class Widgets {
    public static final int TEXT = 0xFFEEF0F6, DIM = 0xFF8B91A3, GOOD = 0xFF4ADE80, WARN = 0xFFFACC15, BAD = 0xFFFF3D5E, PINK = 0xFFF0509F;
    static final int R = 4; // promień kart (jak --radius-sm w JustMusic)

    public abstract static class Widget {
        public final String id;
        protected Widget(String id) { this.id = id; }
        public abstract String name();
        public int styles() { return 1; }
        public String styleName(int style) { return ""; }
        /** null = nic do pokazania (widżet jest ukryty poza edytorem) */
        public abstract int[] size(Gfx g, boolean preview);
        public abstract void render(Gfx g, int w, int h, boolean preview);
        public Config.WidgetCfg cfg() { return JustHud.config().widget(id); }
    }

    public static final List<Widget> ALL = Arrays.asList(new MusicW(), new ArmorW(), new EffectsW(), new AmmoW(), new CoordsW(), new SpeedW(), new FpsW(), new ClockW());

    // ---------- wygląd kart ----------
    static void card(Gfx g, int w, int h) { card(g, w, h, R); }

    static void card(Gfx g, int w, int h, int r) {
        float bg = JustHud.config().background;
        if (bg <= 0) return;
        int a = Math.round(bg * 255);
        g.round(0, 0, w, h, r, (a << 24) | 0x15171D);
        g.roundBorder(0, 0, w, h, r, (Math.round(a * 0.9f) << 24) | 0x262A35);
    }

    /** Cienki pasek postępu jak w odtwarzaczu JustMusic. */
    static void bar(Gfx g, int x, int y, int w, float p, int color) {
        g.round(x, y, w, 2, 1, 0x33FFFFFF);
        int fw = Math.round(w * Math.max(0, Math.min(1, p)));
        if (fw > 0) g.round(x, y, fw, 2, 1, color);
    }

    static String time(double s) {
        if (s < 0 || Double.isNaN(s)) s = 0;
        int t = (int) s;
        return t / 60 + ":" + String.format("%02d", t % 60);
    }

    static int accent() { return JustHud.config().accent; }

    static ItemStack stack(Item item) {
        try { return new ItemStack(item); } catch (Throwable e) { return null; }
    }

    // ---------- JustMusic: teraz gra ----------
    static final class MusicW extends Widget {
        String lastKey = null;
        long changedAt = 0;
        float shownProgress = 0, shownVolume = 1;
        long lastFrame = Anim.now();

        MusicW() { super("music"); }
        public String name() { return T.t("Muzyka (JustMusic)", "Music (JustMusic)"); }
        public int styles() { return 2; }
        public String styleName(int s) { return s == 0 ? T.t("karta", "card") : T.t("kompaktowy", "compact"); }

        public int[] size(Gfx g, boolean preview) {
            Music.State st = Music.state();
            if (!preview && !st.hasTrack() && (JustHud.config().hideMusicWhenIdle || !st.launcher)) return null;
            return cfg().style == 1 ? new int[] { 156, 22 } : new int[] { 184, 48 };
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
            boolean compact = cfg().style == 1;

            card(g, w, h, compact ? 3 : R);
            int sq = compact ? 14 : 34, pad = compact ? 4 : 7;

            // okładka: gradient Just + korektor; przy zmianie utworu „wskakuje” (npcover z JustMusic)
            float pop = Anim.spring(Anim.progress(changedAt, 420));
            float s = changedAt == 0 ? 1 : 0.82f + 0.18f * pop;
            g.push(pad + sq / 2f, pad + sq / 2f, s);
            int half = sq / 2;
            g.round(-half, -half, sq, sq, compact ? 2 : 3, accent());
            g.gradient(-half + 1, -half + (compact ? 1 : 2), half - 1, half - (compact ? 1 : 2), 0x00000000, (0xB0 << 24) | (PINK & 0xFFFFFF));
            int bars = 4, bw = compact ? 2 : 3, gap = compact ? 1 : 2;
            int total = bars * bw + (bars - 1) * gap;
            double tt = nowMs / 1000.0;
            int base = half - (compact ? 3 : 7), maxH = sq - (compact ? 6 : 14);
            for (int i = 0; i < bars; i++) {
                float k = playing && JustHud.config().animations ? (float) (0.5 + 0.5 * Math.sin(tt * (2 * Math.PI / 0.9) + i * 1.3)) : (i % 2 == 0 ? 0.3f : 0.5f);
                int bh = Math.max(2, Math.round(2 + (maxH - 2) * k));
                int bx = -total / 2 + i * (bw + gap);
                g.fill(bx, base - bh, bx + bw, base, 0xF2FFFFFF);
            }
            g.pop();

            // tekst wjeżdża z lewej (nptext)
            float tp = changedAt == 0 ? 1 : Anim.easeOut(Anim.progress(changedAt + 60, 360));
            float oldAlpha = g.alpha;
            g.alpha = oldAlpha * tp;
            int tx = pad + sq + 7 - Math.round(10 * (1 - tp));
            int tw = w - tx - (playing ? 7 : 16);
            boolean vol = nowMs - Music.volumeShownAt() < 1600 && Music.volumeShownAt() > 0;
            shownVolume = Anim.approach(shownVolume, (float) st.volume, 14f, dt);
            if (compact) {
                g.text(g.fit(vol ? T.t("Głośność ", "Volume ") + Math.round(st.volume * 100) + "%" : title + (artist.isEmpty() ? "" : " · " + artist), tw), tx, 7, TEXT);
            } else {
                g.text(g.fit(title, tw), tx, 8, TEXT);
                if (vol) {
                    g.small(T.t("Głośność ", "Volume ") + Math.round(st.volume * 100) + "%", tx, 20, DIM);
                } else g.text(g.fit(artist, tw), tx, 19, DIM);
            }
            g.alpha = oldAlpha;

            // pasek postępu + czasy (jak w odtwarzaczu JustMusic)
            double dur = sample ? 213 : st.duration;
            double pos = sample ? 77 + (nowMs / 1000.0) % 100 : st.position();
            float target = vol ? shownVolume : dur > 0 ? (float) Math.min(1, pos / dur) : 0;
            shownProgress = Math.abs(target - shownProgress) > 0.25f ? target : Anim.approach(shownProgress, target, 8f, dt);
            if (compact) {
                if (dur > 0 || vol) bar(g, tx, h - 4, w - tx - 5, shownProgress, vol ? 0xFFFFFFFF : accent());
            } else if (dur > 0 || vol) {
                int bx = tx, bw2 = w - tx - 8;
                bar(g, bx, 32, bw2, shownProgress, vol ? 0xFFFFFFFF : accent());
                if (!vol) {
                    g.small(time(pos), bx, 37, DIM);
                    String d = time(dur);
                    g.small(d, bx + bw2 - g.smallWidth(d), 37, DIM);
                }
            }
            if (!playing && st.hasTrack()) {
                int px = w - 10, py = compact ? 7 : 8;
                g.fill(px, py, px + 2, py + 7, DIM);
                g.fill(px + 4, py, px + 6, py + 7, DIM);
            }
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

        static float frac(ItemStack s) {
            return s.isDamageableItem() ? (s.getMaxDamage() - s.getDamageValue()) / (float) s.getMaxDamage() : 1f;
        }

        static String label(ItemStack s, int style) {
            if (!s.isDamageableItem()) return s.getCount() > 1 ? "×" + s.getCount() : "";
            int left = s.getMaxDamage() - s.getDamageValue();
            return style == 1 ? String.valueOf(left) : Math.round(100f * left / s.getMaxDamage()) + "%";
        }

        static int color(ItemStack s) {
            if (!s.isDamageableItem()) return TEXT;
            float f = frac(s);
            int c = f > 0.5f ? Anim.lerpColor(WARN, GOOD, (f - 0.5f) * 2) : Anim.lerpColor(BAD, WARN, f * 2);
            if (f < 0.1f && JustHud.config().animations) {
                float pulse = (float) (0.55 + 0.45 * Math.sin(Anim.now() / 160.0));
                c = (Math.round(255 * pulse) << 24) | (c & 0xFFFFFF);
            }
            return c;
        }

        public int[] size(Gfx g, boolean preview) {
            List<ItemStack> it = items(preview);
            if (it.isEmpty()) return preview ? new int[] { g.width(name()) + 14, 17 } : null;
            int style = cfg().style;
            if (style == 2) return new int[] { 6 + it.size() * 22, 34 };
            int tw = 26;
            for (ItemStack s : it) tw = Math.max(tw, g.width(label(s, style)));
            return new int[] { 6 + 16 + 5 + tw + 7, 6 + it.size() * 19 };
        }

        public void render(Gfx g, int w, int h, boolean preview) {
            List<ItemStack> it = items(preview);
            int style = cfg().style;
            card(g, w, h);
            if (it.isEmpty()) { g.text(name(), 7, 5, DIM); return; }
            for (int i = 0; i < it.size(); i++) {
                ItemStack s = it.get(i);
                if (style == 2) {
                    int x = 6 + i * 22;
                    g.item(s, x + 1, 4);
                    String l = label(s, 0);
                    g.small(l, x + 9 - g.smallWidth(l) / 2f, 22, color(s));
                    if (s.isDamageableItem()) bar(g, x + 1, 29, 16, frac(s), color(s) | 0xFF000000);
                } else {
                    int y = 4 + i * 19;
                    g.item(s, 6, y);
                    int tx = 6 + 16 + 5;
                    g.text(label(s, style), tx, y + 2, color(s));
                    if (s.isDamageableItem()) bar(g, tx, y + 12, w - tx - 7, frac(s), color(s) | 0xFF000000);
                }
            }
        }
    }

    // ---------- efekty mikstur z czasem do końca ----------
    static final class EffectsW extends Widget {
        EffectsW() { super("effects"); }
        public String name() { return T.t("Efekty mikstur", "Potion effects"); }

        static final class E {
            final String name; final int color; final int ticks; final boolean infinite;
            E(String n, int c, int t, boolean inf) { name = n; color = c; ticks = t; infinite = inf; }
        }

        List<E> effects(boolean preview) {
            List<E> out = new ArrayList<>();
            LocalPlayer p = Minecraft.getInstance().player;
            if (p != null) {
                for (MobEffectInstance e : p.getActiveEffects()) {
                    //#if MC >= 1.20.5
                    net.minecraft.world.effect.MobEffect eff = e.getEffect().value();
                    //#else
                    net.minecraft.world.effect.MobEffect eff = e.getEffect();
                    //#endif
                    String n = eff.getDisplayName().getString() + (e.getAmplifier() > 0 ? " " + roman(e.getAmplifier() + 1) : "");
                    out.add(new E(n, 0xFF000000 | eff.getColor(), e.getDuration(), e.isInfiniteDuration()));
                }
            }
            if (out.isEmpty() && preview) {
                out.add(new E(T.t("Szybkość II", "Speed II"), 0xFF33EBFF, 20 * 95, false));
                out.add(new E(T.t("Regeneracja", "Regeneration"), 0xFFCD5CAB, 20 * 8, false));
            }
            return out;
        }

        static String roman(int n) { return n >= 1 && n <= 10 ? new String[] { "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X" }[n - 1] : String.valueOf(n); }

        public int[] size(Gfx g, boolean preview) {
            List<E> l = effects(preview);
            if (l.isEmpty()) return null;
            int w = 40;
            for (E e : l) w = Math.max(w, g.width(e.name) + 8 + g.width("88:88"));
            return new int[] { w + 20, 6 + l.size() * 12 };
        }

        public void render(Gfx g, int w, int h, boolean preview) {
            card(g, w, h);
            List<E> l = effects(preview);
            for (int i = 0; i < l.size(); i++) {
                E e = l.get(i);
                int y = 4 + i * 12;
                g.round(6, y + 1, 6, 6, 2, e.color);
                boolean ending = !e.infinite && e.ticks < 200;
                float oldA = g.alpha;
                if (ending && JustHud.config().animations) g.alpha = oldA * (float) (0.55 + 0.45 * Math.sin(Anim.now() / 140.0));
                g.text(e.name, 16, y, TEXT);
                String t = e.infinite ? "∞" : time(e.ticks / 20.0);
                g.text(t, w - 7 - g.width(t), y, ending ? WARN : DIM);
                g.alpha = oldA;
            }
        }
    }

    // ---------- strzały, totemy i bloki w ręce ----------
    static final class AmmoW extends Widget {
        AmmoW() { super("ammo"); }
        public String name() { return T.t("Strzały, totemy, bloki", "Arrows, totems, blocks"); }

        static int count(LocalPlayer p, Item... items) {
            int n = 0;
            for (int i = 0; i < p.getInventory().getContainerSize(); i++) {
                ItemStack s = p.getInventory().getItem(i);
                for (Item it : items) if (s.getItem() == it) n += s.getCount();
            }
            return n;
        }

        List<Object[]> entries(boolean preview) {
            List<Object[]> out = new ArrayList<>();
            LocalPlayer p = Minecraft.getInstance().player;
            if (p != null) {
                int arrows = count(p, Items.ARROW, Items.SPECTRAL_ARROW, Items.TIPPED_ARROW);
                Item main = p.getMainHandItem().getItem();
                boolean bow = main == Items.BOW || main == Items.CROSSBOW || p.getOffhandItem().getItem() == Items.BOW || p.getOffhandItem().getItem() == Items.CROSSBOW;
                if (arrows > 0 || bow) out.add(new Object[] { new ItemStack(Items.ARROW), arrows });
                int totems = count(p, Items.TOTEM_OF_UNDYING);
                if (totems > 0) out.add(new Object[] { new ItemStack(Items.TOTEM_OF_UNDYING), totems });
                if (main instanceof BlockItem) out.add(new Object[] { new ItemStack(main), count(p, main) });
            }
            if (out.isEmpty() && preview) {
                ItemStack a = stack(Items.ARROW), t = stack(Items.TOTEM_OF_UNDYING);
                if (a != null) out.add(new Object[] { a, 64 });
                if (t != null) out.add(new Object[] { t, 2 });
            }
            return out;
        }

        public int[] size(Gfx g, boolean preview) {
            List<Object[]> l = entries(preview);
            if (l.isEmpty()) return null;
            int w = 6;
            for (Object[] e : l) w += 16 + 3 + g.width(String.valueOf(e[1])) + 8;
            return new int[] { w, 24 };
        }

        public void render(Gfx g, int w, int h, boolean preview) {
            card(g, w, h);
            int x = 6;
            for (Object[] e : entries(preview)) {
                g.item((ItemStack) e[0], x, 4);
                String n = String.valueOf(e[1]);
                int c = ((Integer) e[1]) == 0 ? BAD : TEXT;
                g.text(n, x + 19, 8, c);
                x += 16 + 3 + g.width(n) + 8;
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
            String xyz = x + "  " + y + "  " + z;
            if (cfg().style == 1) return new String[] { xyz };
            return new String[] { xyz, facing(dir) };
        }

        static String facing(String d) {
            switch (d) {
                case "north": return T.t("Północ (−Z)", "North (−Z)");
                case "south": return T.t("Południe (+Z)", "South (+Z)");
                case "east": return T.t("Wschód (+X)", "East (+X)");
                case "west": return T.t("Zachód (−X)", "West (−X)");
                default: return d;
            }
        }

        public int[] size(Gfx g, boolean preview) {
            String[] l = lines();
            int w = g.smallWidth("XYZ");
            for (String s : l) w = Math.max(w, g.width(s));
            return new int[] { w + 16, (cfg().style == 1 ? 8 : 15) + l.length * 10 };
        }

        public void render(Gfx g, int w, int h, boolean preview) {
            card(g, w, h);
            String[] l = lines();
            if (cfg().style == 1) { g.text(l[0], 8, 4, TEXT); return; }
            g.small(T.t("POZYCJA", "POSITION"), 8, 5, DIM);
            g.round(w - 9, 5, 3, 3, 1, accent());
            for (int i = 0; i < l.length; i++) g.text(l[i], 8, 13 + i * 10, i == 0 ? TEXT : DIM);
        }
    }

    // ---------- prędkość ----------
    static final class SpeedW extends Widget {
        double lx, ly, lz;
        boolean has;
        float speed;
        long lastTick;

        SpeedW() { super("speed"); }
        public String name() { return T.t("Prędkość", "Speed"); }

        void sample() {
            LocalPlayer p = Minecraft.getInstance().player;
            long now = Anim.now();
            if (p == null) { has = false; return; }
            if (now - lastTick < 50) return;
            float dt = (now - lastTick) / 1000f;
            if (has && dt < 1) {
                double dx = p.getX() - lx, dz = p.getZ() - lz, dy = p.getY() - ly;
                float v = (float) (Math.sqrt(dx * dx + dz * dz + dy * dy) / dt);
                speed = Anim.approach(speed, v, 6f, dt);
            }
            lx = p.getX(); ly = p.getY(); lz = p.getZ(); has = true; lastTick = now;
        }

        public int[] size(Gfx g, boolean preview) { return new int[] { 80, 26 }; }

        public void render(Gfx g, int w, int h, boolean preview) {
            sample();
            card(g, w, h);
            float v = preview && !has ? 5.6f : speed;
            g.small(T.t("PRĘDKOŚĆ", "SPEED"), 8, 5, DIM);
            g.text(String.format("%.1f m/s", v), 8, 13, TEXT);
            bar(g, 8, h - 3, w - 16, Math.min(1, v / 20f), accent());
        }
    }

    // ---------- FPS ----------
    static final class FpsW extends Widget {
        FpsW() { super("fps"); }
        public String name() { return "FPS"; }

        public int[] size(Gfx g, boolean preview) { return new int[] { g.width(JustHud.fps() + " FPS") + 20, 15 }; }

        public void render(Gfx g, int w, int h, boolean preview) {
            card(g, w, h, 6);
            int fps = JustHud.fps();
            int c = fps >= 60 ? GOOD : fps >= 30 ? WARN : BAD;
            g.round(7, 5, 5, 5, 2, c);
            g.text(fps + " FPS", 15, 4, TEXT);
        }
    }

    // ---------- zegar i dzień w grze ----------
    static final class ClockW extends Widget {
        ClockW() { super("clock"); }
        public String name() { return T.t("Zegar i dzień", "Clock & day"); }
        public int styles() { return 2; }
        public String styleName(int s) { return s == 0 ? T.t("godzina + dzień w grze", "time + game day") : T.t("tylko godzina", "time only"); }

        String real() { LocalTime t = LocalTime.now(); return String.format("%02d:%02d", t.getHour(), t.getMinute()); }

        String game() {
            long dt = JustHud.dayTime();
            long day = dt / 24000L + 1, tod = (dt + 6000) % 24000;
            return String.format("%s %d · %02d:%02d", T.t("Dzień", "Day"), day, tod / 1000, (tod % 1000) * 60 / 1000);
        }

        public int[] size(Gfx g, boolean preview) {
            int w = Math.round(g.width(real()) * 1.5f);
            if (cfg().style == 0) w = Math.max(w, g.smallWidth(game()));
            return new int[] { w + 16, cfg().style == 0 ? 26 : 19 };
        }

        public void render(Gfx g, int w, int h, boolean preview) {
            card(g, w, h);
            String r = real();
            float rw = g.width(r) * 1.5f;
            g.push((w - rw) / 2f, 4, 1.5f);
            g.text(r, 0, 0, TEXT);
            g.pop();
            if (cfg().style == 0) {
                String gm = game();
                g.small(gm, (w - g.smallWidth(gm)) / 2f, 18, DIM);
            }
        }
    }

    private Widgets() {}
}
