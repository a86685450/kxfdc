import { Color, Label, Node, Sprite, UITransform } from "cc";
import { UIBase } from "../../../framework/ui/UIBase";
import { UIManager } from "../../../framework/ui/UIManager";
import { GameRuntime } from "../../../game/GameRuntime";
import { GameStartParam, GameMode } from "../../../game/GameStartParam";
import { HouseGameManager } from "../../../game/HouseGameManager";
import { GameplaySmokeTest } from "../../../test/GameplaySmokeTest";
import { UIIds } from "../../UIIds";

/** 游戏主面板，承载盖房子玩法和测试模式日志。 */
export class GamePanel extends UIBase {
    private _manager: HouseGameManager | null = null;
    private _hudLabel: Label | null = null;
    private _testLabel: Label | null = null;
    private _autoPlayTimerId: ReturnType<typeof setInterval> | null = null;
    private _autoPlayTargetFloor = 0;
    private _autoPlayInterval = 0.18;
    private _autoPlaying = false;

    protected onInit(): void {
        this._buildView();
    }

    protected onShow(params?: { mode?: GameMode; autoPlay?: boolean; autoPlayFloors?: number; autoPlayInterval?: number }): void {
        if (!this.node) return;
        const mode = params?.mode || GameStartParam.consumeMode();
        const runtime = this.node.getComponent(GameRuntime) || this.node.addComponent(GameRuntime);
        this._manager = new HouseGameManager(this as any, this.node, {
            mode,
            onGameOver: async (info) => {
                await UIManager.instance.open(UIIds.GameOverPanel, info);
            },
            onHudUpdate: (text) => {
                if (this._hudLabel) this._hudLabel.string = text;
            },
            onTestLog: (text) => this._appendTestLog(text),
        });
        runtime.setManager(this._manager);
        this._manager.startGame();
        if (params?.autoPlay) {
            this._startAutoPlay(params.autoPlayFloors || 110, params.autoPlayInterval || 0.18);
        } else if (mode === "test") {
            this._runGameplayTest();
        }
    }

    protected onClose(): void {
        this._stopAutoPlay();
        this._manager?.destroy();
        this._manager = null;
    }

    public restart(): void {
        this._manager?.reset();
    }

    private _buildView(): void {
        if (!this.node) return;
        const hudBg = new Node("HudBg");
        this.node.addChild(hudBg);
        hudBg.setPosition(0, 548, 0);
        hudBg.addComponent(UITransform).setContentSize(660, 96);
        const sprite = hudBg.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.color = new Color(22, 31, 50, 130);

        const hud = this._createLabel("HudLabel", "", 28, new Color(255, 255, 255, 255), 620, 86);
        hud.setPosition(0, 548, 0);
        this.node.addChild(hud);
        this._hudLabel = hud.getComponent(Label);

        const test = this._createLabel("TestLog", "", 20, new Color(178, 255, 189, 255), 650, 240);
        test.setPosition(0, -470, 0);
        this.node.addChild(test);
        this._testLabel = test.getComponent(Label);
    }

    private _createLabel(name: string, text: string, fontSize: number, color: Color, width: number, height: number): Node {
        const node = new Node(name);
        node.addComponent(UITransform).setContentSize(width, height);
        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = fontSize;
        label.lineHeight = fontSize + 8;
        label.color = color;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        return node;
    }

    private _runGameplayTest(): void {
        if (!this._manager) return;
        if (this._testLabel) {
            this._testLabel.string = "[玩法测试] 开始执行...";
        }
        const result = GameplaySmokeTest.run(this._manager, (line) => this._appendTestLog(line));
        this._appendTestLog(`[玩法测试] ${result.passed ? "通过" : "失败"}`);
    }

    private _startAutoPlay(targetFloor: number, interval: number): void {
        this._stopAutoPlay();
        this._autoPlayTargetFloor = Math.max(1, Math.floor(targetFloor));
        this._autoPlayInterval = Math.max(0.03, interval);
        this._autoPlaying = true;
        if (this._testLabel) {
            this._testLabel.string = "";
        }
        this._appendTestLog(`[AutoPlay] 开始自动盖房子 target=${this._autoPlayTargetFloor} interval=${this._autoPlayInterval}`);
        this._autoPlayTimerId = setInterval(() => this._stepAutoPlay(), this._autoPlayInterval * 1000);
        this._stepAutoPlay();
    }

    private _stopAutoPlay(): void {
        this._autoPlaying = false;
        if (this._autoPlayTimerId !== null) {
            clearInterval(this._autoPlayTimerId);
            this._autoPlayTimerId = null;
        }
    }

    private _stepAutoPlay(): void {
        if (!this._autoPlaying || !this._manager) return;
        const snapshot = this._manager.getDebugSnapshot();
        if (snapshot.floor >= this._autoPlayTargetFloor) {
            this._appendTestLog(`[AutoPlay] 完成 floor=${snapshot.floor}`);
            this._stopAutoPlay();
            return;
        }
        const nextOffset = this._getAutoPlayOffset(snapshot.floor + 1);
        const success = this._manager.forceDropForTest(nextOffset);
        const after = this._manager.getDebugSnapshot();
        if (!success) {
            this._appendTestLog(`[AutoPlay] 失败 floor=${after.floor}`);
            this._stopAutoPlay();
            return;
        }
        if (after.floor % 5 === 0 || after.floor === 1) {
            this._appendTestLog(`[AutoPlay] floor=${after.floor} bgY=${after.backgroundY.toFixed(0)} decor=${after.backgroundDecorIds.join(",")}`);
        }
    }

    private _getAutoPlayOffset(floor: number): number {
        if (floor <= 1) return 4;
        if (floor % 11 === 0) return 8;
        if (floor % 7 === 0) return -6;
        return floor % 2 === 0 ? 2 : -2;
    }

    private _appendTestLog(text: string): void {
        if (!this._testLabel) return;
        const oldLines = this._testLabel.string ? this._testLabel.string.split("\n") : [];
        oldLines.push(text);
        this._testLabel.string = oldLines.slice(-8).join("\n");
        console.log(text);
    }
}
