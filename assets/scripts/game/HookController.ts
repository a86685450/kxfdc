import { Color, Graphics, Node, Sprite, UITransform } from "cc";
import { GameConfig } from "./GameConfig";
import { ResourceLoader } from "./ResourceLoader";

export interface HookState {
    x: number;
    y: number;
    angleRad: number;
    angularVelocity: number;
    horizontalVelocity: number;
}

/** 吊钩控制，使用正弦钟摆，点击时可读取水平惯性。 */
export class HookController {
    private _node: Node;
    private _ropeLine: Graphics;
    private _hookNode: Node;
    private _time = 0;
    private _active = true;
    private _lastAngle = 0;
    private _currentState: HookState = { x: 0, y: 0, angleRad: 0, angularVelocity: 0, horizontalVelocity: 0 };

    public constructor(parent: Node) {
        this._node = new Node("Hook");
        parent.addChild(this._node);
        this._node.addComponent(UITransform).setContentSize(GameConfig.DESIGN_WIDTH, GameConfig.DESIGN_HEIGHT);
        this._ropeLine = this._node.addComponent(Graphics);
        this._hookNode = new Node("TopHookSprite");
        this._node.addChild(this._hookNode);
        this._hookNode.addComponent(UITransform).setContentSize(GameConfig.HOOK_SPRITE_WIDTH, GameConfig.HOOK_SPRITE_HEIGHT);
        const hookSprite = this._hookNode.addComponent(Sprite);
        hookSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        hookSprite.color = Color.WHITE;
        ResourceLoader.setSpriteFrame(hookSprite, GameConfig.HOOK_SPRITE_PATH);
        this._setInitialState();
    }

    public reset(): void {
        this._time = 0;
        this._active = true;
        this._lastAngle = 0;
        this._setInitialState();
        this._clearRopes();
    }

    public setActive(active: boolean): void {
        this._active = active;
        this._node.active = active;
    }

    public update(dt: number): HookState {
        if (!this._active) {
            return this._currentState;
        }
        this._time += dt;
        const amplitude = GameConfig.HOOK_AMPLITUDE_DEG * Math.PI / 180;
        const angle = Math.sin(this._time * GameConfig.HOOK_SPEED) * amplitude;
        const angularVelocity = (angle - this._lastAngle) / Math.max(dt, 0.0001);
        this._lastAngle = angle;
        const x = Math.sin(angle) * GameConfig.HOOK_LENGTH;
        const y = GameConfig.HOOK_PIVOT_Y - Math.cos(angle) * GameConfig.HOOK_LENGTH;
        const horizontalVelocity = angularVelocity * GameConfig.HOOK_LENGTH * GameConfig.DROP_INERTIA_SCALE;
        this._currentState = { x, y, angleRad: angle, angularVelocity, horizontalVelocity };
        this._syncHookSprite(x, y, angle);
        return this._currentState;
    }

    public getState(): HookState {
        return this._currentState;
    }

    public syncAttachedHouse(house: Node | null): void {
        if (!this._active || !house || !house.isValid) {
            this._clearRopes();
            return;
        }
        const angleRad = house.angle * Math.PI / 180;
        const hookCenter = this._calculateHookCenter(house.position.x, house.position.y, angleRad);
        this._syncHookSpriteWithCenter(hookCenter.x, hookCenter.y, angleRad);
        const leftSource = this._getRotatedPoint(hookCenter.x, hookCenter.y, angleRad, -GameConfig.HOOK_ROPE_SOURCE_HALF_SPREAD, GameConfig.HOOK_ROPE_SOURCE_Y);
        const rightSource = this._getRotatedPoint(hookCenter.x, hookCenter.y, angleRad, GameConfig.HOOK_ROPE_SOURCE_HALF_SPREAD, GameConfig.HOOK_ROPE_SOURCE_Y);
        const leftAnchor = this._getHouseAnchor(house.position.x, house.position.y, angleRad, -GameConfig.HOOK_HOUSE_ATTACH_X, GameConfig.HOOK_HOUSE_ATTACH_Y);
        const rightAnchor = this._getHouseAnchor(house.position.x, house.position.y, angleRad, GameConfig.HOOK_HOUSE_ATTACH_X, GameConfig.HOOK_HOUSE_ATTACH_Y);

        this._ropeLine.clear();
        this._ropeLine.lineWidth = GameConfig.HOOK_ROPE_WIDTH;
        this._ropeLine.strokeColor = new Color(24, 20, 18, 255);
        // 钩子本体承担钟摆视觉，两条细绳只负责连接房子两侧并随角度改变长度。
        this._ropeLine.moveTo(leftSource.x, leftSource.y);
        this._ropeLine.lineTo(leftAnchor.x, leftAnchor.y);
        this._ropeLine.moveTo(rightSource.x, rightSource.y);
        this._ropeLine.lineTo(rightAnchor.x, rightAnchor.y);
        this._ropeLine.stroke();
    }

    private _setInitialState(): void {
        this._currentState = {
            x: 0,
            y: GameConfig.HOOK_PIVOT_Y - GameConfig.HOOK_LENGTH,
            angleRad: 0,
            angularVelocity: 0,
            horizontalVelocity: 0,
        };
        this._syncHookSprite(this._currentState.x, this._currentState.y, this._currentState.angleRad);
    }

    private _clearRopes(): void {
        this._ropeLine.clear();
    }

    private _syncHookSprite(houseCenterX: number, houseCenterY: number, angleRad: number): void {
        const center = this._calculateHookCenter(houseCenterX, houseCenterY, angleRad);
        this._syncHookSpriteWithCenter(center.x, center.y, angleRad);
    }

    private _syncHookSpriteWithCenter(x: number, y: number, angleRad: number): void {
        this._hookNode.setPosition(x, y, 0);
        this._hookNode.angle = angleRad * 180 / Math.PI;
    }

    private _calculateHookCenter(houseCenterX: number, houseCenterY: number, angleRad: number): { x: number; y: number } {
        const offsetY = GameConfig.HOUSE_SIZE * 0.5 + GameConfig.HOOK_SPRITE_HOUSE_GAP + GameConfig.HOOK_SPRITE_HEIGHT * 0.5;
        return this._getRotatedPoint(houseCenterX, houseCenterY, angleRad, 0, offsetY);
    }

    private _getHouseAnchor(centerX: number, centerY: number, angleRad: number, localX: number, localY: number): { x: number; y: number } {
        return this._getRotatedPoint(centerX, centerY, angleRad, localX, localY);
    }

    private _getRotatedPoint(centerX: number, centerY: number, angleRad: number, localX: number, localY: number): { x: number; y: number } {
        const cos = Math.cos(angleRad);
        const sin = Math.sin(angleRad);
        return {
            x: centerX + localX * cos - localY * sin,
            y: centerY + localX * sin + localY * cos,
        };
    }
}
