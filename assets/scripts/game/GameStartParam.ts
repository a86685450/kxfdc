export type GameMode = "normal" | "test";

/**
 * 登录面板到游戏面板的轻量参数通道。
 * 参考 HongHuang 的 BattleLevelParam，一次性消费，避免跨界面状态残留。
 */
export class GameStartParam {
    private static _mode: GameMode = "normal";

    public static set mode(value: GameMode) {
        this._mode = value;
    }

    public static consumeMode(): GameMode {
        const mode = this._mode;
        this._mode = "normal";
        return mode;
    }

    public static peekMode(): GameMode {
        return this._mode;
    }
}
