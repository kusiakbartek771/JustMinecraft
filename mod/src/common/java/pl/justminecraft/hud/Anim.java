package pl.justminecraft.hud;

/** Krzywe animacji z JustMusic (--ease-out i --ease-spring). */
public final class Anim {
    public static long now() { return System.nanoTime() / 1_000_000L; }

    /** 0..1 od chwili start przez ms milisekund. */
    public static float progress(long start, int ms) {
        if (!JustHud.config().animations) return 1f;
        long d = now() - start;
        return d >= ms ? 1f : Math.max(0f, d / (float) ms);
    }

    /** cubic-bezier(.22, 1, .36, 1) – przybliżenie easeOutQuint */
    public static float easeOut(float t) { return 1f - (float) Math.pow(1f - t, 5); }

    /** cubic-bezier(.34, 1.56, .64, 1) – easeOutBack (lekkie „przestrzelenie”) */
    public static float spring(float t) {
        float c1 = 1.70158f, c3 = c1 + 1;
        return 1 + c3 * (float) Math.pow(t - 1, 3) + c1 * (float) Math.pow(t - 1, 2);
    }

    /** Płynne dojście wartości do celu (niezależne od FPS). */
    public static float approach(float cur, float target, float perSecond, float dt) {
        if (!JustHud.config().animations) return target;
        float k = 1f - (float) Math.exp(-perSecond * dt);
        return cur + (target - cur) * k;
    }

    public static int lerpColor(int a, int b, float t) {
        t = Math.max(0, Math.min(1, t));
        int ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255, aa = (a >>> 24);
        int br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255, ba = (b >>> 24);
        return (Math.round(aa + (ba - aa) * t) << 24) | (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
    }

    private Anim() {}
}
