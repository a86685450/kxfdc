import { _decorator, Component } from "cc";
import { HouseGameManager } from "./HouseGameManager";

const { ccclass } = _decorator;

/** Cocos update 桥接组件，让非组件式的玩法管理器跟随帧循环。 */
@ccclass("GameRuntime")
export class GameRuntime extends Component {
    private _manager: HouseGameManager | null = null;

    public setManager(manager: HouseGameManager): void {
        this._manager = manager;
    }

    protected update(dt: number): void {
        this._manager?.update(dt);
    }

    protected onDestroy(): void {
        this._manager?.destroy();
        this._manager = null;
    }
}
