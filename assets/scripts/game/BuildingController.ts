import { Node, Tween, tween, Vec3 } from "cc";
import { GameConfig } from "./GameConfig";
import { HouseObjectPool } from "./HouseObjectPool";

export interface HouseRecord {
    floor: number;
    x: number;
    y: number;
    node: Node | null;
}

/** 已盖楼体管理，负责楼层记录、可见层复用和真实摇摆偏移。 */
export class BuildingController {
    private _parent: Node;
    private _pool: HouseObjectPool;
    private _records: HouseRecord[] = [];
    private _swayTime = 0;
    private _swayOffsetX = 0;
    private _currentRisk = 0;

    public constructor(parent: Node, pool: HouseObjectPool) {
        this._parent = parent;
        this._pool = pool;
    }

    public reset(): void {
        Tween.stopAllByTarget(this._parent);
        for (const record of this._records) {
            if (record.node) {
                this._pool.recycle(record.node);
            }
        }
        this._records = [];
        this._swayTime = 0;
        this._swayOffsetX = 0;
        this._currentRisk = 0;
        this._parent.setPosition(0, 0, 0);
    }

    public update(dt: number, cumulativeRisk: number): void {
        this._currentRisk = cumulativeRisk;
        const floorCount = this._records.length;
        if (floorCount < GameConfig.SWAY_START_FLOOR) {
            this._swayOffsetX = 0;
            this._parent.setPosition(0, this._parent.position.y, 0);
            return;
        }
        this._swayTime += dt;
        const amplitude = Math.min(42, 5 + cumulativeRisk * 0.42);
        this._swayOffsetX = Math.sin(this._swayTime * (0.9 + cumulativeRisk * 0.01)) * amplitude;
        this._parent.setPosition(this._swayOffsetX, this._parent.position.y, 0);
    }

    public commitHouse(house: Node, floor: number, x: number): number {
        const y = GameConfig.FOUNDATION_TOP_Y + GameConfig.HOUSE_SIZE * 0.5 + (floor - 1) * GameConfig.HOUSE_SIZE;
        house.removeFromParent();
        this._parent.addChild(house);
        house.setPosition(x, y, 0);
        house.angle = 0;
        this._records.push({ floor, x, y, node: house });
        this._refreshVisibleNodes();
        return this._scrollToTop();
    }

    public getFloorCount(): number {
        return this._records.length;
    }

    public getTopRecord(): HouseRecord | null {
        if (this._records.length === 0) return null;
        return this._records[this._records.length - 1];
    }

    public getTargetWorldX(): number {
        const top = this.getTopRecord();
        if (!top) return 0;
        return top.x + this._swayOffsetX;
    }

    public getTargetTopWorldY(): number {
        const top = this.getTopRecord();
        if (!top) return GameConfig.FOUNDATION_TOP_Y;
        return top.y + GameConfig.HOUSE_SIZE * 0.5 + this._parent.position.y;
    }

    public getSwayOffsetX(): number {
        return this._swayOffsetX;
    }

    public getCurrentRisk(): number {
        return this._currentRisk;
    }

    public getCameraOffsetY(): number {
        return this._parent.position.y;
    }

    private _refreshVisibleNodes(): void {
        const minVisibleFloor = Math.max(1, this._records.length - GameConfig.MAX_VISIBLE_FLOOR_NODES + 1);
        for (const record of this._records) {
            if (record.floor >= minVisibleFloor) {
                if (record.node) {
                    record.node.active = true;
                }
            } else if (record.node) {
                this._pool.recycle(record.node);
                record.node = null;
            }
        }
    }

    private _scrollToTop(): number {
        const floorCount = this._records.length;
        if (floorCount <= 2) {
            tween(this._parent).to(0.22, { position: new Vec3(this._swayOffsetX, 0, 0) }).start();
            return 0;
        }
        const targetY = -(floorCount - GameConfig.VISIBLE_FLOOR_COUNT) * GameConfig.HOUSE_SIZE;
        tween(this._parent).to(0.26, { position: new Vec3(this._swayOffsetX, targetY, 0) }).start();
        return targetY;
    }
}
