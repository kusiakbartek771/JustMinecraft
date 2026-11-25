package pl.justminecraft.hud;

import net.minecraft.client.Minecraft;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Arrays;

/**
 * Test wydajności uruchamiany z launchera: -Djusthud.bench=60 -Djusthud.benchOut=plik.json.
 * Po wejściu do świata odczekuje 5 s, mierzy czasy klatek i pamięć przez zadany czas i zapisuje wynik.
 */
final class Bench {
    private static final int SECONDS = Integer.getInteger("justhud.bench", 0);
    private static final String OUT = System.getProperty("justhud.benchOut");
    private static long inWorldSince = 0, startedAt = 0, last = 0, doneAt = 0;
    private static float[] frames = new float[20000];
    private static int n = 0;
    private static long memPeak = 0;
    private static boolean done;

    static boolean active() { return SECONDS > 0 && OUT != null; }

    static void frame(Gfx g) {
        if (!active()) return;
        Minecraft mc = Minecraft.getInstance();
        long now = System.nanoTime();
        if (mc.player == null) { inWorldSince = 0; last = now; return; }
        if (inWorldSince == 0) inWorldSince = now;
        int w = g.screenW();
        if (done) {
            if ((now - doneAt) / 1e9 < 6) banner(g, w, T.t("Test wydajności zakończony – wyniki w launcherze", "Benchmark finished – results in the launcher"), 1f);
            last = now;
            return;
        }
        double warm = (now - inWorldSince) / 1e9;
        if (warm < 5) {
            banner(g, w, T.t("Test wydajności za ", "Benchmark starts in ") + (int) Math.ceil(5 - warm) + " s – " + T.t("graj normalnie", "play normally"), 0f);
            last = now;
            return;
        }
        if (startedAt == 0) { startedAt = now; last = now; return; }
        float ms = (now - last) / 1e6f;
        last = now;
        if (n == frames.length) frames = Arrays.copyOf(frames, n * 2);
        frames[n++] = ms;
        Runtime rt = Runtime.getRuntime();
        memPeak = Math.max(memPeak, rt.totalMemory() - rt.freeMemory());
        double el = (now - startedAt) / 1e9;
        banner(g, w, T.t("Test wydajności: ", "Benchmark: ") + (int) Math.ceil(SECONDS - el) + " s", (float) (el / SECONDS));
        if (el >= SECONDS) finish(el);
    }

    private static void banner(Gfx g, int sw, String text, float p) {
        int w = g.width(text) + 20, x = (sw - w) / 2, y = g.screenH() - 76;
        g.round(x, y, w, 20, 4, 0xE615171D);
        g.roundBorder(x, y, w, 20, 4, 0xFF262A35);
        g.text(text, x + 10, y + 5, Widgets.TEXT);
        if (p > 0) Widgets.bar(g, x + 6, y + 17, w - 12, p, JustHud.config().accent);
    }

    private static void finish(double seconds) {
        done = true;
        doneAt = System.nanoTime();
        float[] f = Arrays.copyOf(frames, n);
        double total = 0;
        for (float x : f) total += x;
        Arrays.sort(f);
        int lowN = Math.max(1, n / 100);
        double lowSum = 0;
        for (int i = n - lowN; i < n; i++) lowSum += f[i];
        double avgFps = n / (total / 1000.0);
        double low1 = 1000.0 / (lowSum / lowN);
        double median = 1000.0 / f[n / 2];
        Runtime rt = Runtime.getRuntime();
        String json = String.format(java.util.Locale.ROOT,
                "{\"seconds\":%.1f,\"frames\":%d,\"fpsAvg\":%.1f,\"fpsMedian\":%.1f,\"fps1Low\":%.1f,\"worstFrameMs\":%.1f,\"memPeakMb\":%d,\"memMaxMb\":%d,\"cpus\":%d}",
                seconds, n, avgFps, median, low1, f[n - 1], memPeak / 1048576, rt.maxMemory() / 1048576, rt.availableProcessors());
        try {
            Path p = Paths.get(OUT);
            Files.createDirectories(p.getParent());
            Files.write(p, json.getBytes(StandardCharsets.UTF_8));
            JustHud.LOG("bench: " + json);
        } catch (Exception e) {
            JustHud.LOG("bench: nie udało się zapisać wyniku: " + e);
        }
    }

    private Bench() {}
}
