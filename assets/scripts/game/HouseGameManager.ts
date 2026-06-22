import { Color, Component, EventMouse, EventTouch, Input, input, Node, Sprite, Tween, tween, UITransform, Vec3 } from "cc";
import { BackgroundController } from "./BackgroundController";
import { BuildingController } from "./BuildingController";
import { FloatingTextManager } from "./FloatingTextManager";
import { GameAudioManager } from "./GameAudioManager";
import { GameConfig } from "./GameConfig";
import { GameMode } from "./GameStartParam";
import { HouseObjectPool } from "./HouseObjectPool";
import { HouseRuleEvaluator, LandingRuleState } from "./HouseRuleEvaluator";
import { HookController } from "./HookController";
import { ResourceLoader } from "./ResourceLoader";
import { ScoreController } from "./ScoreController";

export interface GameOverInfo {
    score: number;
    floor: number;
    bestScore: number;
    bestFloor: number;
    bestCombo: number;
}

export interface GameManagerOptions {
    mode: GameMode;
    onGameOver: (info: GameOverInfo) => void;
    onHudUpdate: (text: string) => void;
    onTestLog?: (text: string) => void;
}

interface DroppingState {
    node: Node;
    vx: number;
    vy: number;
    floor: number;
}

/** 主玩法控制，集中驱动吊钩、下落、判定、楼体摇摆和重开。 */
export class HouseGameManager {
    private _host: Component;
    private _root: Node;
    private _gameLayer: Node;
    private _buildingLayer: Node;
    private _effectLayer: Node;
    private _hudLayer: Node;
    private _background: BackgroundController;
    private _pool: HouseObjectPool;
    private _building: BuildingController;
    private _hook: HookController;
    private _floatingText: FloatingTextManager;
    private _score: ScoreController = new ScoreController();
    private _audio: GameAudioManager;
    private _options: GameManagerOptions;
    private _currentHouse: Node | null = null;
    private _dropping: DroppingState | null = null;
    private _failedHouse: Node | null = null;
    private _gameOver = false;
    private _roundToken = 0;
    private _destroyed = false;
    private _ruleState: LandingRuleState = { cumulativeRisk: 0, riskEverExceededFive: false, combo: 0 };

    public constructor(host: Component, root: Node, options: GameManagerOptions) {
        this._host = host;
        this._root = root;
        this._options = options;
        this._gameLayer = this._createLayer("GameLayer");
        this._buildingLayer = this._createLayer("BuildingLayer");
        this._effectLayer = this._createLayer("EffectLayer");
        this._hudLayer = this._createLayer("HudLayer");
        this._background = new BackgroundController(this._gameLayer);
        this._pool = new HouseObjectPool(this._gameLayer);
        this._building = new BuildingController(this._buildingLayer, this._pool);
        this._hook = new HookController(this._gameLayer);
        this._floatingText = new FloatingTextManager(this._effectLayer);
        this._audio = new GameAudioManager(host);
        this._createFoundation();
        input.on(Input.EventType.MOUSE_DOWN, this._onMouseDown, this);
        input.on(Input.EventType.TOUCH_START, this._onTouchStart, this);
    }

    public destroy(): void {
        if (this._destroyed) return;
        this._destroyed = true;
        input.off(Input.EventType.MOUSE_DOWN, this._onMouseDown, this);
        input.off(Input.EventType.TOUCH_START, this._onTouchStart, this);
        this._roundToken++;
        this._cleanupRuntimeNodes();
        this._building.reset();
        this._background.destroy();
        this._floatingText.destroy();
        this._pool.destroy();
    }

    public startGame(): void {
        this.reset();
    }

    public reset(): void {
        if (this._destroyed) return;
        this._roundToken++;
        this._cleanupRuntimeNodes();
        this._floatingText.clear();
        this._gameOver = false;
        this._dropping = null;
        this._currentHouse = null;
        this._failedHouse = null;
        this._ruleState = { cumulativeRisk: 0, riskEverExceededFive: false, combo: 0 };
        this._score.reset();
        this._building.reset();
        this._background.reset();
        this._hook.reset();
        this._hook.setActive(true);
        this._spawnNextHouse();
        this._updateHud();
    }

    public update(dt: number): void {
        if (this._gameOver) return;
        this._building.update(dt, this._ruleState.cumulativeRisk);
        const hookState = this._hook.update(dt);
        if (this._currentHouse && !this._dropping) {
            this._currentHouse.setPosition(hookState.x, hookState.y, 0);
            this._currentHouse.angle = hookState.angleRad * 180 / Math.PI;
            this._hook.syncAttachedHouse(this._currentHouse);
        } else {
            this._hook.syncAttachedHouse(null);
        }
        if (this._dropping) {
            this._updateDropping(dt);
        }
    }

    public forceDropForTest(offsetPercent: number): boolean {
        if (this._gameOver) return false;
        if (!this._currentHouse) {
            this._spawnNextHouse();
        }
        const floor = this._building.getFloorCount() + 1;
        const targetX = floor === 1 ? 0 : this._building.getTargetWorldX();
        const x = targetX + offsetPercent / 100 * GameConfig.HOUSE_SIZE;
        this._currentHouse!.setPosition(x, GameConfig.FOUNDATION_TOP_Y + 500, 0);
        this._landCurrentHouse(x);
        return !this._gameOver;
    }

    public getDebugSnapshot(): { floor: number; risk: number; poolCreated: number; poolReuse: number; score: number; combo: number; topX: number; cameraY: number; backgroundY: number; looseHouseCount: number; backgroundDecorCount: number; backgroundDecorIds: string[] } {
        const score = this._score.getSnapshot();
        const top = this._building.getTopRecord();
        return {
            floor: this._building.getFloorCount(),
            risk: this._ruleState.cumulativeRisk,
            poolCreated: this._pool.getCreatedCount(),
            poolReuse: this._pool.getReuseCount(),
            score: score.score,
            combo: score.combo,
            topX: top ? top.x : 0,
            cameraY: this._building.getCameraOffsetY(),
            backgroundY: this._background.getDebugY(),
            looseHouseCount: this._gameLayer.children.filter((child) => child.name === "House").length,
            backgroundDecorCount: this._background.getDebugActiveDecorCount(),
            backgroundDecorIds: this._background.getDebugActiveDecorIds(),
        };
    }

    private _onMouseDown(event: EventMouse): void {
        if (event.getButton() !== EventMouse.BUTTON_LEFT) return;
        this._releaseCurrentHouse();
    }

    private _onTouchStart(_event: EventTouch): void {
        this._releaseCurrentHouse();
    }

    private _releaseCurrentHouse(): void {
        if (this._gameOver || this._dropping || !this._currentHouse) return;
        const state = this._hook.getState();
        const floor = this._building.getFloorCount() + 1;
        this._dropping = {
            node: this._currentHouse,
            vx: state.horizontalVelocity,
            vy: GameConfig.DROP_INITIAL_Y_SPEED,
            floor,
        };
        this._currentHouse.angle = 0;
        this._currentHouse = null;
        this._hook.syncAttachedHouse(null);
        this._audio.play("click");
    }

    private _updateDropping(dt: number): void {
        if (!this._dropping) return;
        const node = this._dropping.node;
        this._dropping.vy -= GameConfig.DROP_GRAVITY * dt;
        const nextX = node.position.x + this._dropping.vx * dt;
        const nextY = node.position.y + this._dropping.vy * dt;
        node.setPosition(nextX, nextY, 0);

        const targetTopY = this._dropping.floor === 1 ? GameConfig.FOUNDATION_TOP_Y : this._building.getTargetTopWorldY();
        const bottomY = node.position.y - GameConfig.HOUSE_SIZE * 0.5;
        if (bottomY <= targetTopY) {
            this._landCurrentHouse(node.position.x);
        }
    }

    private _landCurrentHouse(worldX: number): void {
        if (!this._dropping && !this._currentHouse) return;
        const house = this._dropping?.node || this._currentHouse!;
        const floor = this._dropping?.floor || this._building.getFloorCount() + 1;
        const isFirstFloor = floor === 1;
        const targetX = isFirstFloor ? 0 : this._building.getTargetWorldX();
        const offsetPercent = Math.abs(worldX - targetX) / GameConfig.HOUSE_SIZE * 100;
        const result = HouseRuleEvaluator.evaluate(offsetPercent, this._ruleState, isFirstFloor);

        if (result.shouldFail) {
            this._failHouse(house, worldX);
            return;
        }

        this._dropping = null;
        // 第一层不再强制居中，保留玩家真实落点；只有 Perfect 命中才吸附。
        const localX = result.shouldSnap ? (targetX - this._building.getSwayOffsetX()) : (worldX - this._building.getSwayOffsetX());
        const cameraOffsetY = this._building.commitHouse(house, floor, localX);
        this._background.updateCameraOffset(cameraOffsetY);
        this._ruleState = result.nextState;
        this._score.apply(result.scoreAdd, floor, this._ruleState.combo);
        this._background.updateByFloor(floor);
        this._audio.play(result.feedback.indexOf("perfect") >= 0 ? (this._ruleState.combo > 1 ? "combo" : "perfect") : result.feedback === "good" ? "good" : "drop");
        if (result.feedback) {
            const color = result.feedback.indexOf("perfect") >= 0 ? new Color(255, 235, 91, 255) : new Color(126, 238, 255, 255);
            this._floatingText.show(result.feedback, targetX, this._building.getTargetTopWorldY() + 140, color);
        }
        this._spawnNextHouse();
        this._updateHud();
    }

    private _failHouse(house: Node, worldX: number): void {
        this._gameOver = true;
        this._dropping = null;
        this._currentHouse = null;
        this._failedHouse = house;
        this._hook.setActive(false);
        house.setPosition(worldX, house.position.y, 0);
        this._audio.play("fail");
        const token = this._roundToken;
        tween(house)
            .parallel(
                tween().by(0.72, { position: new Vec3(worldX > 0 ? 240 : -240, -460, 0) }),
                tween().to(0.72, { angle: worldX > 0 ? -55 : 55 }),
            )
            .call(() => {
                if (token === this._roundToken && this._failedHouse === house && this._gameOver) {
                    this._showGameOver();
                }
            })
            .start();
    }

    private _showGameOver(): void {
        const best = this._score.flushBest();
        const snapshot = this._score.getSnapshot();
        this._options.onGameOver({
            score: snapshot.score,
            floor: snapshot.floor,
            bestScore: best.bestScore,
            bestFloor: best.bestFloor,
            bestCombo: best.bestCombo,
        });
    }

    private _spawnNextHouse(): void {
        const floor = this._building.getFloorCount() + 1;
        const node = this._pool.acquire(floor);
        this._gameLayer.addChild(node);
        const hookState = this._hook.getState();
        node.setPosition(hookState.x, hookState.y, 0);
        node.angle = hookState.angleRad * 180 / Math.PI;
        this._currentHouse = node;
        this._hook.syncAttachedHouse(node);
    }

    private _createLayer(name: string): Node {
        const node = new Node(name);
        this._root.addChild(node);
        const transform = node.addComponent(UITransform);
        transform.setContentSize(GameConfig.DESIGN_WIDTH, GameConfig.DESIGN_HEIGHT);
        return node;
    }

    private _createFoundation(): void {
        const foundation = new Node("Foundation");
        this._buildingLayer.addChild(foundation);
        const transform = foundation.addComponent(UITransform);
        transform.setContentSize(GameConfig.GROUND_WIDTH, GameConfig.GROUND_HEIGHT);
        const sprite = foundation.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.color = Color.WHITE;
        foundation.setPosition(0, GameConfig.FOUNDATION_TOP_Y - GameConfig.GROUND_HEIGHT * 0.5, 0);
        ResourceLoader.setSpriteFrame(sprite, GameConfig.GROUND_PATH);
    }

    private _updateHud(): void {
        const snapshot = this._score.getSnapshot();
        this._options.onHudUpdate(
            `分数 ${snapshot.score}    层数 ${snapshot.floor}\n最高分 ${snapshot.best.bestScore}    最高层 ${snapshot.best.bestFloor}    连击 ${snapshot.combo}`,
        );
    }

    private _cleanupRuntimeNodes(): void {
        // 重开时回收所有未提交到楼体记录的房子，避免失败掉落节点残留在场景中。
        const looseHouses = new Set<Node>();
        if (this._currentHouse?.isValid) looseHouses.add(this._currentHouse);
        if (this._dropping?.node?.isValid) looseHouses.add(this._dropping.node);
        if (this._failedHouse?.isValid) looseHouses.add(this._failedHouse);
        for (const child of this._gameLayer.children.slice()) {
            if (child.name === "House" && child.isValid) {
                looseHouses.add(child);
            }
        }
        looseHouses.forEach((node) => {
            Tween.stopAllByTarget(node);
            this._pool.recycle(node);
        });
        this._currentHouse = null;
        this._dropping = null;
        this._failedHouse = null;
    }
}
