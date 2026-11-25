package pl.justminecraft.hud.fabric;

import net.fabricmc.api.ClientModInitializer;
import pl.justminecraft.hud.JustHud;

/** Fabric / Quilt – HUD i tick przez mixiny, bez Fabric API. */
public class JustHudFabric implements ClientModInitializer {
    @Override
    public void onInitializeClient() { JustHud.init(); }
}
