package pl.justminecraft.hud.forge;

import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.loading.FMLEnvironment;

@Mod("justhud")
public class JustHudForge {
    public JustHudForge() {
        if (FMLEnvironment.dist == Dist.CLIENT) ForgeClient.init();
    }
}
