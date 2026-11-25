package pl.justminecraft.hud.neoforge;

import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.RenderGuiEvent;
import net.neoforged.neoforge.common.NeoForge;
import pl.justminecraft.hud.JustHud;

@Mod(value = "justhud", dist = Dist.CLIENT)
public class JustHudNeoForge {
    public JustHudNeoForge(IEventBus modBus) {
        JustHud.init();
        NeoForge.EVENT_BUS.addListener((RenderGuiEvent.Post e) -> JustHud.renderHud(e.getGuiGraphics()));
        NeoForge.EVENT_BUS.addListener((ClientTickEvent.Post e) -> JustHud.tick());
    }
}
