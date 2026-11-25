package pl.justminecraft.hud;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.world.item.ItemStack;

/** Rysowanie niezależne od wersji (różnice API Minecrafta są tylko tutaj). */
public final class Gfx {
    public final GuiGraphics g;
    public final Font font;
    public float alpha = 1f;

    public Gfx(GuiGraphics g) {
        this.g = g;
        this.font = Minecraft.getInstance().font;
    }

    /** Kolor z przezroczystością całego widżetu. */
    public int a(int argb) {
        int al = Math.round(((argb >>> 24) & 0xFF) * alpha);
        return (Math.max(0, Math.min(255, al)) << 24) | (argb & 0xFFFFFF);
    }

    public void fill(int x1, int y1, int x2, int y2, int argb) {
        if (x2 <= x1 || y2 <= y1) return;
        g.fill(x1, y1, x2, y2, a(argb));
    }

    /** Prostokąt z zaokrąglonymi rogami (1 px), jak panele w JustMusic. */
    public void panel(int x, int y, int w, int h, int argb) {
        fill(x + 1, y, x + w - 1, y + h, argb);
        fill(x, y + 1, x + 1, y + h - 1, argb);
        fill(x + w - 1, y + 1, x + w, y + h - 1, argb);
    }

    public void outline(int x, int y, int w, int h, int argb) {
        fill(x, y, x + w, y + 1, argb);
        fill(x, y + h - 1, x + w, y + h, argb);
        fill(x, y + 1, x + 1, y + h - 1, argb);
        fill(x + w - 1, y + 1, x + w, y + h - 1, argb);
    }

    public int text(String s, int x, int y, int argb) {
        int c = a(argb);
        if (((c >>> 24) & 0xFF) < 8) return x + font.width(s);
        //#if MC >= 26.3
        g.text(font, s, x, y, c, JustHud.config().shadow);
        //#else
        g.drawString(font, s, x, y, c, JustHud.config().shadow);
        //#endif
        return x + font.width(s);
    }

    public int width(String s) { return font.width(s); }

    /** Tekst przycięty do szerokości (z „…”). */
    public String fit(String s, int max) {
        if (s == null) return "";
        if (font.width(s) <= max) return s;
        String dots = "…";
        int w = max - font.width(dots);
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            if (font.width(b.toString() + s.charAt(i)) > w) break;
            b.append(s.charAt(i));
        }
        return b.toString().trim() + dots;
    }

    public void item(ItemStack stack, int x, int y) {
        //#if MC >= 26.3
        g.item(stack, x, y);
        g.itemDecorations(font, stack, x, y);
        //#else
        g.renderItem(stack, x, y);
        g.renderItemDecorations(font, stack, x, y);
        //#endif
    }

    public void push(float x, float y, float scale) {
        //#if MC >= 1.21.6
        g.pose().pushMatrix();
        g.pose().translate(x, y);
        g.pose().scale(scale, scale);
        //#else
        g.pose().pushPose();
        g.pose().translate(x, y, 0);
        g.pose().scale(scale, scale, 1);
        //#endif
    }

    public void pop() {
        //#if MC >= 1.21.6
        g.pose().popMatrix();
        //#else
        g.pose().popPose();
        //#endif
    }

    /** Następna warstwa: wszystko narysowane dalej przykryje to, co już jest (także tekst). */
    public void layer() {
        //#if MC >= 1.21.6
        g.nextStratum();
        //#else
        g.flush();
        //#endif
    }

    public int screenW() { return g.guiWidth(); }
    public int screenH() { return g.guiHeight(); }
}
