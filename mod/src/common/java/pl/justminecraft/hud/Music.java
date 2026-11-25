package pl.justminecraft.hud;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Stan muzyki z JustMusic – przez most launchera JustMinecraft (127.0.0.1, port z -Djusthud.port, domyślnie 47851).
 * Osobny wątek odpytuje launcher co pół sekundy; gra nigdy nie czeka na sieć.
 */
public final class Music {
    public static final class State {
        public final boolean launcher;   // launcher odpowiada
        public final boolean connected;  // JustMusic jest połączony z launcherem
        public final String title, artist;
        public final boolean playing;
        public final double time, duration, volume;
        final long receivedAt;

        State(boolean launcher, boolean connected, String title, String artist, boolean playing, double time, double duration, double volume) {
            this.launcher = launcher; this.connected = connected; this.title = title; this.artist = artist;
            this.playing = playing; this.time = time; this.duration = duration; this.volume = volume; this.receivedAt = System.currentTimeMillis();
        }

        public boolean hasTrack() { return connected && title != null; }

        /** Aktualna pozycja utworu (dolicza czas od ostatniego odczytu, gdy gra). */
        public double position() {
            double t = time + (playing ? (System.currentTimeMillis() - receivedAt) / 1000.0 : 0);
            return duration > 0 ? Math.min(t, duration) : t;
        }
    }

    private static final State OFFLINE = new State(false, false, null, null, false, 0, 0, 1);
    private static volatile State state = OFFLINE;
    private static Thread thread;
    private static final int PORT = Integer.getInteger("justhud.port", 47851);

    public static State state() { return state; }

    static synchronized void start() {
        if (thread != null) return;
        thread = new Thread(Music::loop, "JustHUD-Music");
        thread.setDaemon(true);
        thread.setPriority(Thread.MIN_PRIORITY);
        thread.start();
    }

    private static void loop() {
        int fails = 0;
        while (true) {
            try {
                state = fetch();
                fails = 0;
            } catch (Exception e) {
                state = OFFLINE;
                fails++;
            }
            try { Thread.sleep(fails == 0 ? 500 : Math.min(5000, 1000L * fails)); } catch (InterruptedException e) { return; }
        }
    }

    private static State fetch() throws Exception {
        JsonObject o = JsonParser.parseString(request("GET", "/game/nowplaying", null)).getAsJsonObject();
        boolean connected = o.has("connected") && o.get("connected").getAsBoolean();
        JsonElement tr = o.get("track");
        String title = null, artist = null;
        if (tr != null && tr.isJsonObject()) {
            title = str(tr.getAsJsonObject().get("title"));
            artist = str(tr.getAsJsonObject().get("artist"));
        }
        double time = num(o.get("time")), duration = num(o.get("duration"));
        boolean playing = o.has("playing") && o.get("playing").getAsBoolean();
        // stan z JustMusic mógł być wysłany chwilę temu – dolicz upływ czasu
        long at = (long) num(o.get("at")), now = (long) num(o.get("now"));
        if (playing && at > 0 && now >= at) time += (now - at) / 1000.0;
        double volume = o.has("volume") ? num(o.get("volume")) : 1;
        if (localVolumeAt > 0 && System.currentTimeMillis() - localVolumeAt < 2500) volume = localVolume;
        return new State(true, connected, title, artist, playing, time, duration, volume);
    }

    // głośność ustawiona z gry – pokazujemy ją od razu, zanim JustMusic odeśle stan
    static volatile double localVolume = 1;
    static volatile long localVolumeAt = 0, volumeShownAt = 0;

    public static long volumeShownAt() { return volumeShownAt; }

    /** Zmienia głośność JustMusic o krok (np. +0.1 / -0.1). */
    public static void volumeStep(double delta) {
        double v = Math.max(0, Math.min(1, Math.round((state.volume + delta) * 20) / 20.0));
        localVolume = v;
        localVolumeAt = volumeShownAt = System.currentTimeMillis();
        State s = state;
        state = new State(s.launcher, s.connected, s.title, s.artist, s.playing, s.position(), s.duration, v);
        send("{\"cmd\":\"volume\",\"value\":" + v + "}");
    }

    /** Polecenie dla JustMusic: toggle, next, prev, shuffle. Wysyłane w tle. */
    public static void command(String cmd) {
        send("{\"cmd\":\"" + cmd + "\"}");
    }

    private static void send(String json) {
        Thread t = new Thread(() -> {
            try { request("POST", "/game/cmd", json); } catch (Exception ignored) {}
        }, "JustHUD-Cmd");
        t.setDaemon(true);
        t.start();
    }

    private static String request(String method, String path, String body) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL("http://127.0.0.1:" + PORT + path).openConnection();
        c.setConnectTimeout(400);
        c.setReadTimeout(800);
        c.setRequestMethod(method);
        c.setRequestProperty("X-JustLauncher", "1");
        if (body != null) {
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            try (OutputStream os = c.getOutputStream()) { os.write(body.getBytes(StandardCharsets.UTF_8)); }
        }
        int code = c.getResponseCode();
        try (InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            if (in != null) {
                byte[] buf = new byte[4096];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
            if (code >= 400) throw new IllegalStateException("HTTP " + code);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } finally {
            c.disconnect();
        }
    }

    private static String str(JsonElement e) { return e == null || e.isJsonNull() ? null : e.getAsString(); }
    private static double num(JsonElement e) { try { return e == null || e.isJsonNull() ? 0 : e.getAsDouble(); } catch (Exception x) { return 0; } }

    private Music() {}
}
