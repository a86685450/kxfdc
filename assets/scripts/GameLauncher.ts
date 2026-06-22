import { _decorator, Canvas, Component, ResolutionPolicy, UITransform, view } from "cc";
import { UIManager } from "./framework/ui/UIManager";
import { GameConfig } from "./game/GameConfig";
import { GameStartParam } from "./game/GameStartParam";
import { UIIds } from "./ui/UIIds";
import { registerAllUI } from "./ui/UIRegister";

const { ccclass } = _decorator;

/** 游戏启动器，挂载到 Canvas，流程参考 HongHuang 的 GameLauncher。 */
@ccclass("GameLauncher")
export class GameLauncher extends Component {
    protected async start(): Promise<void> {
        this._setupDesignResolution();
        UIManager.instance.init(this.node);
        registerAllUI();
        const shouldAutoPlay = this._shouldAutoPlay();
        if (this._shouldAutoRunTest() || shouldAutoPlay) {
            GameStartParam.mode = "test";
            await UIManager.instance.open(UIIds.GamePanel, { mode: "test", autoPlay: shouldAutoPlay, autoPlayFloors: this._getNumberParam("floors", 110), autoPlayInterval: this._getNumberParam("interval", 0.18) });
            console.log(shouldAutoPlay ? "[GameLauncher] 检测到 autoPlay 参数，自动盖房子" : "[GameLauncher] 检测到 autoTest 参数，自动进入玩法测试");
            return;
        }
        await UIManager.instance.open(UIIds.LoginPanel);
        console.log("[GameLauncher] 开心房地产启动完成");
    }

    private _setupDesignResolution(): void {
        // 按 720x1280 完整显示设计画面，避免宽屏预览下底部登录按钮和地面被裁剪。
        view.setDesignResolutionSize(GameConfig.DESIGN_WIDTH, GameConfig.DESIGN_HEIGHT, ResolutionPolicy.SHOW_ALL);
        const transform = this.node.getComponent(UITransform);
        if (transform) {
            transform.setContentSize(GameConfig.DESIGN_WIDTH, GameConfig.DESIGN_HEIGHT);
        }
        const canvas = this.node.getComponent(Canvas);
        if (canvas) {
            canvas.alignCanvasWithScreen = true;
        }
    }

    private _shouldAutoRunTest(): boolean {
        if (typeof window === "undefined") return false;
        const search = window.location.search || "";
        return search.indexOf("autoTest=1") >= 0 || search.indexOf("test=1") >= 0;
    }

    private _shouldAutoPlay(): boolean {
        if (typeof window === "undefined") return false;
        return (window.location.search || "").indexOf("autoPlay=1") >= 0;
    }

    private _getNumberParam(name: string, defaultValue: number): number {
        if (typeof window === "undefined") return defaultValue;
        const value = new URLSearchParams(window.location.search || "").get(name);
        if (!value) return defaultValue;
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
    }
}
