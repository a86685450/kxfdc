import { Color, Label, Node, Tween, tween, UITransform, Vec3 } from "cc";

/** 飘字表现管理，负责 perfect / good / combo 的短反馈。 */
export class FloatingTextManager {
    private _parent: Node;
    private _pool: Node[] = [];

    public constructor(parent: Node) {
        this._parent = parent;
    }

    public show(text: string, x: number, y: number, color: Color = new Color(255, 246, 122, 255)): void {
        if (!text) return;
        const node = this._pool.pop() || this._createNode();
        Tween.stopAllByTarget(node);
        node.active = true;
        if (node.parent !== this._parent) {
            this._parent.addChild(node);
        }
        node.setPosition(x, y, 0);
        node.setScale(0.7, 0.7, 1);
        const label = node.getComponent(Label)!;
        label.string = text;
        label.color = color;
        tween(node)
            .parallel(
                tween().to(0.18, { scale: new Vec3(1.25, 1.25, 1) }),
                tween().by(0.55, { position: new Vec3(0, 96, 0) }),
            )
            .to(0.12, { scale: new Vec3(0.9, 0.9, 1) })
            .call(() => this._recycle(node))
            .start();
    }

    public clear(): void {
        for (const child of this._parent.children.slice()) {
            Tween.stopAllByTarget(child);
            child.active = false;
            child.removeFromParent();
            if (this._pool.indexOf(child) < 0) {
                this._pool.push(child);
            }
        }
    }

    public destroy(): void {
        this.clear();
        for (const node of this._pool) {
            if (node.isValid) {
                Tween.stopAllByTarget(node);
                node.destroy();
            }
        }
        this._pool = [];
    }

    private _createNode(): Node {
        const node = new Node("FloatingText");
        this._parent.addChild(node);
        const transform = node.addComponent(UITransform);
        transform.setContentSize(280, 72);
        const label = node.addComponent(Label);
        label.fontSize = 46;
        label.lineHeight = 60;
        label.isBold = true;
        return node;
    }

    private _recycle(node: Node): void {
        if (!node.isValid) return;
        node.active = false;
        node.removeFromParent();
        if (this._pool.indexOf(node) < 0) {
            this._pool.push(node);
        }
    }
}
