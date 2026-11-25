package pl.justminecraft.hud;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

/** Ustawienia JustHUD (config/justhud.json). Wszystko zmienia się w edytorze w grze (domyślnie klawisz J). */
public class Config {
    public static final int[] ACCENTS = { 0xFF7C5CFF, 0xFF5B8CFF, 0xFF38BDF8, 0xFF14B8A6, 0xFF4ADE80, 0xFFA3E635, 0xFFFACC15, 0xFFFF9F43, 0xFFFF7A45, 0xFFFF3D5E, 0xFFFF4FD8, 0xFFC084FC };
    public static final float[] BACKGROUNDS = { 0f, 0.25f, 0.4f, 0.55f, 0.7f, 0.85f };

    public static class WidgetCfg {
        public boolean on = true;
        /** 0 lewy-górny … 8 prawy-dolny (siatka 3×3) */
        public int anchor;
        public int x;
        public int y;
        public float scale = 1f;
        public int style;

        WidgetCfg() {}
        WidgetCfg(boolean on, int anchor, int x, int y, int style) { this.on = on; this.anchor = anchor; this.x = x; this.y = y; this.style = style; }
    }

    public boolean enabled = true;
    public int accent = ACCENTS[0];
    public float background = 0.55f;
    public boolean shadow = true;
    public boolean animations = true;
    public boolean hideMusicWhenIdle = false;
    public int editorKey = com.mojang.blaze3d.platform.InputConstants.KEY_J;
    public int playPauseKey = -1;
    public int nextKey = -1;
    public int prevKey = -1;
    public Map<String, WidgetCfg> widgets = new LinkedHashMap<>();

    static Config defaults() {
        Config c = new Config();
        c.widgets.put("music", new WidgetCfg(true, 2, -6, 6, 0));
        c.widgets.put("armor", new WidgetCfg(true, 5, -6, 0, 0));
        c.widgets.put("coords", new WidgetCfg(true, 0, 6, 6, 0));
        c.widgets.put("fps", new WidgetCfg(false, 0, 6, 30, 0));
        c.widgets.put("clock", new WidgetCfg(false, 1, 0, 6, 0));
        return c;
    }

    public WidgetCfg widget(String id) {
        WidgetCfg w = widgets.get(id);
        if (w == null) {
            w = defaults().widgets.getOrDefault(id, new WidgetCfg());
            widgets.put(id, w);
        }
        return w;
    }

    // ---------- zapis / odczyt ----------
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    private static Path file;

    static Config load(Path gameDir) {
        file = gameDir.resolve("config").resolve("justhud.json");
        Config d = defaults();
        try {
            if (Files.exists(file)) {
                Config c = GSON.fromJson(new String(Files.readAllBytes(file), StandardCharsets.UTF_8), Config.class);
                if (c != null) {
                    if (c.widgets == null) c.widgets = new LinkedHashMap<>();
                    for (Map.Entry<String, WidgetCfg> e : d.widgets.entrySet()) c.widgets.putIfAbsent(e.getKey(), e.getValue());
                    return c;
                }
            }
        } catch (Exception e) {
            JustHud.LOG("Nie udało się wczytać config/justhud.json – używam domyślnych: " + e);
        }
        return d;
    }

    void save() {
        if (file == null) return;
        try {
            Files.createDirectories(file.getParent());
            Path tmp = file.resolveSibling("justhud.json.tmp");
            Files.write(tmp, GSON.toJson(this).getBytes(StandardCharsets.UTF_8));
            Files.move(tmp, file, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        } catch (Exception e) {
            JustHud.LOG("Nie udało się zapisać ustawień: " + e);
        }
    }
}
