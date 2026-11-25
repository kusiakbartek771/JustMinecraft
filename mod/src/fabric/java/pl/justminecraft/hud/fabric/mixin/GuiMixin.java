package pl.justminecraft.hud.fabric.mixin;

//#if MC >= 26.3
import net.minecraft.client.gui.Hud;
//#else
import net.minecraft.client.gui.Gui;
//#endif
import net.minecraft.client.gui.GuiGraphics;
//#if MC >= 1.21
import net.minecraft.client.DeltaTracker;
//#endif
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import pl.justminecraft.hud.JustHud;

//#if MC >= 26.3
@Mixin(Hud.class)
//#else
@Mixin(Gui.class)
//#endif
public class GuiMixin {
    //#if MC >= 26.3
    @Inject(method = "extractRenderState", at = @At("TAIL"))
    private void justhud$render(GuiGraphics g, DeltaTracker delta, CallbackInfo ci) { JustHud.renderHud(g); }
    //#elif MC >= 1.21
    @Inject(method = "render", at = @At("TAIL"))
    private void justhud$render(GuiGraphics g, DeltaTracker delta, CallbackInfo ci) { JustHud.renderHud(g); }
    //#else
    @Inject(method = "render", at = @At("TAIL"))
    private void justhud$render(GuiGraphics g, float partial, CallbackInfo ci) { JustHud.renderHud(g); }
    //#endif
}
