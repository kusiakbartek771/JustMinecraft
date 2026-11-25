package pl.justminecraft.hud.forge;

import net.minecraftforge.client.event.RenderGuiEvent;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.event.TickEvent;
import pl.justminecraft.hud.JustHud;

final class ForgeClient {
    static void init() {
        JustHud.init();
        MinecraftForge.EVENT_BUS.addListener((RenderGuiEvent.Post e) -> JustHud.renderHud(e.getGuiGraphics()));
        MinecraftForge.EVENT_BUS.addListener((TickEvent.ClientTickEvent e) -> { if (e.phase == TickEvent.Phase.END) JustHud.tick(); });
    }

    private ForgeClient() {}
}
