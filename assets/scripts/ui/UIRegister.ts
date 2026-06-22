import { UIManager } from "../framework/ui/UIManager";
import { UILayer, UIOpenType } from "../framework/ui/UIDefine";
import { GameOverPanel } from "./panels/gameover/GameOverPanel";
import { GamePanel } from "./panels/game/GamePanel";
import { LoginPanel } from "./panels/login/LoginPanel";
import { UIIds } from "./UIIds";

/** UI 注册入口，结构参考 HongHuang。 */
export function registerAllUI(): void {
    const manager = UIManager.instance;
    manager.register(UIIds.LoginPanel, LoginPanel, {
        layer: UILayer.Scene,
        openType: UIOpenType.HidePrevious,
        closeOnSceneChange: false,
    });
    manager.register(UIIds.GamePanel, GamePanel, {
        layer: UILayer.Scene,
        openType: UIOpenType.HidePrevious,
        closeOnSceneChange: false,
    });
    manager.register(UIIds.GameOverPanel, GameOverPanel, {
        layer: UILayer.Popup,
        openType: UIOpenType.DontHideOthers,
        closeOnSceneChange: true,
    });
    console.log("[UIRegister] UI 注册完成");
}
