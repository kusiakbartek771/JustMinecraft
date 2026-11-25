package pl.justminecraft.hud;

import net.minecraft.client.Minecraft;

/** Teksty po polsku albo angielsku – zależnie od języka gry. */
public final class T {
    public static String t(String pl, String en) {
        try {
            String lang = Minecraft.getInstance().options.languageCode;
            return lang != null && lang.startsWith("pl") ? pl : en;
        } catch (Throwable e) {
            return pl;
        }
    }

    private T() {}
}
