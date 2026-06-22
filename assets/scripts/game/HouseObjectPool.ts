import { Color, Label, Node, Sprite, Tween, UITransform } from "cc";
import { GameConfig, HouseSkinConfigs } from "./GameConfig";
import { ResourceLoader } from "./ResourceLoader";

/** 房子缓存池，复用离屏楼层节点。 */
export class HouseObjectPool {
    private _parent: Node;
    private _pool: Node[] = [];
    private _skinRequestIds: WeakMap<Node, string> = new WeakMap();
    private _createdCount = 0;
    private _reuseCount = 0;

    public constructor(parent: Node) {
        this._parent = parent;
    }

    public acquire(floor: number): Node {
        const node = this._acquireValidNode();
        const reused = node !== null;
        const house = node || this._createHouseNode();
        Tween.stopAllByTarget(house);
        if (house.parent !== this._parent) {
            this._parent.addChild(house);
        }
        house.active = true;
        house.angle = 0;
        house.setScale(1, 1, 1);
        this._applySkin(house, floor);
        if (reused) {
            this._reuseCount++;
        }
        return house;
    }

    public recycle(node: Node): void {
        if (!node.isValid) return;
        Tween.stopAllByTarget(node);
        node.active = false;
        node.angle = 0;
        node.setScale(1, 1, 1);
        node.removeFromParent();
        if (this._pool.indexOf(node) < 0) {
            this._pool.push(node);
        }
    }

    public getCreatedCount(): number {
        return this._createdCount;
    }

    public getReuseCount(): number {
        return this._reuseCount;
    }

    public destroy(): void {
        for (const node of this._pool) {
            if (node.isValid) {
                Tween.stopAllByTarget(node);
                node.destroy();
            }
        }
        this._pool = [];
    }

    private _acquireValidNode(): Node | null {
        while (this._pool.length > 0) {
            const node = this._pool.pop()!;
            if (node.isValid) {
                return node;
            }
        }
        return null;
    }

    private _createHouseNode(): Node {
        this._createdCount++;
        const node = new Node("House");
        const transform = node.addComponent(UITransform);
        transform.setContentSize(GameConfig.HOUSE_SIZE, GameConfig.HOUSE_SIZE);
        const sprite = node.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;

        const labelNode = new Node("FloorLabel");
        node.addChild(labelNode);
        const labelTransform = labelNode.addComponent(UITransform);
        labelTransform.setContentSize(GameConfig.HOUSE_SIZE, 42);
        const label = labelNode.addComponent(Label);
        label.fontSize = 28;
        label.lineHeight = 36;
        label.color = new Color(255, 255, 255, 255);
        label.isBold = true;
        labelNode.setPosition(0, 0, 0);
        return node;
    }

    private _applySkin(node: Node, floor: number): void {
        const randomIndex = Math.floor(Math.random() * HouseSkinConfigs.length);
        const config = HouseSkinConfigs[randomIndex];
        const requestKey = `${floor}_${randomIndex}_${Date.now()}_${Math.random()}`;
        this._skinRequestIds.set(node, requestKey);
        const sprite = node.getComponent(Sprite);
        if (sprite) {
            sprite.color = Color.WHITE;
            sprite.spriteFrame = null;
            // 缓存池节点会被快速复用，校验请求版本避免旧异步回调覆盖新房子贴图。
            ResourceLoader.setSpriteFrame(sprite, config.path, () => node.isValid && this._skinRequestIds.get(node) === requestKey);
        }
        const label = node.getChildByName("FloorLabel")?.getComponent(Label);
        if (label) {
            label.string = String(floor);
        }
    }
}
