import { Color, Graphics, ImageAsset, Label, Node, Sprite, SpriteFrame, Texture2D, Tween, tween, UITransform, Vec3 } from "cc";
import { BottomBackgroundGradientColors, GameConfig, MiddleBackgroundDecorConfigs } from "./GameConfig";
import type { MiddleBackgroundDecorConfig } from "./GameConfig";
import { ResourceLoader } from "./ResourceLoader";

interface ActiveDecor {
    config: MiddleBackgroundDecorConfig;
    node: Node;
    content: Node;
}

interface BottomTile {
    node: Node;
    sprite: Sprite;
    logicalIndex: number;
}

/** 三层背景控制：底层双 Tile 渐变循环、中层动态装饰、顶层预留。 */
export class BackgroundController {
    private _root: Node;
    private _bottomLayer: Node;
    private _bottomScrollLayer: Node;
    private _middleLayer: Node;
    private _topLayer: Node;
    private _bottomTiles: BottomTile[] = [];
    private _currentBackgroundOffset = 0;
    private _targetBackgroundOffset = 0;
    private _offsetTweenState = { value: 0 };
    private _gradientFrameCache: Map<string, SpriteFrame> = new Map();
    private _gradientTextures: Texture2D[] = [];
    private _activeDecors: Map<string, ActiveDecor> = new Map();
    private _decorPool: Node[] = [];
    private _decorRequestIds: WeakMap<Node, string> = new WeakMap();

    public constructor(parent: Node) {
        this._root = new Node("Background");
        parent.addChild(this._root);
        this._root.setSiblingIndex(0);
        this._root.addComponent(UITransform).setContentSize(GameConfig.DESIGN_WIDTH, GameConfig.DESIGN_HEIGHT);

        this._bottomLayer = this._createLayer("BottomBackgroundLayer", 0);
        this._middleLayer = this._createLayer("MiddleDecorLayer", 1);
        this._topLayer = this._createLayer("TopReservedLayer", 2);

        this._bottomScrollLayer = new Node("BottomScrollLayer");
        this._bottomLayer.addChild(this._bottomScrollLayer);
        this._bottomScrollLayer.addComponent(UITransform).setContentSize(GameConfig.DESIGN_WIDTH, this._getTileHeight() * 2);
        this._buildBottomTiles();
    }

    public reset(): void {
        Tween.stopAllByTarget(this._root);
        Tween.stopAllByTarget(this._bottomLayer);
        Tween.stopAllByTarget(this._bottomScrollLayer);
        Tween.stopAllByTarget(this._offsetTweenState);
        Tween.stopAllByTarget(this._middleLayer);
        Tween.stopAllByTarget(this._topLayer);
        this._currentBackgroundOffset = 0;
        this._targetBackgroundOffset = 0;
        this._offsetTweenState.value = 0;
        this._root.setPosition(0, 0, 0);
        this._bottomLayer.setPosition(0, 0, 0);
        this._bottomScrollLayer.setPosition(0, 0, 0);
        this._middleLayer.setPosition(0, 0, 0);
        this._topLayer.setPosition(0, 0, 0);
        this._clearActiveDecors();
        this._resetBottomTiles();
        this._applyBackgroundOffset(0);
    }

    public updateByFloor(_floor: number): void {
        // 底层背景由偏移量连续滚动驱动，不再按楼层突变切换颜色。
    }

    public updateCameraOffset(cameraOffsetY: number): void {
        // 记录背景偏移量，供底层双 Tile 循环和中层装饰动态加载/回收。
        const nextOffset = cameraOffsetY * GameConfig.BACKGROUND_SCROLL_RATIO;
        const targetOffset = Math.min(0, nextOffset);
        this._targetBackgroundOffset = targetOffset;
        this._refreshMiddleDecors();

        Tween.stopAllByTarget(this._offsetTweenState);
        if (Math.abs(targetOffset - this._currentBackgroundOffset) < 0.01) {
            this._applyBackgroundOffset(targetOffset);
            return;
        }

        this._offsetTweenState.value = this._currentBackgroundOffset;
        tween(this._offsetTweenState)
            .to(GameConfig.BACKGROUND_SCROLL_DURATION, { value: targetOffset }, {
                easing: "quadOut",
                onUpdate: () => this._applyBackgroundOffset(this._offsetTweenState.value),
            })
            .call(() => this._applyBackgroundOffset(targetOffset))
            .start();
    }

    public destroy(): void {
        Tween.stopAllByTarget(this._root);
        Tween.stopAllByTarget(this._bottomLayer);
        Tween.stopAllByTarget(this._bottomScrollLayer);
        Tween.stopAllByTarget(this._offsetTweenState);
        Tween.stopAllByTarget(this._middleLayer);
        Tween.stopAllByTarget(this._topLayer);
        this._clearActiveDecors();
        this._clearGradientCache();
        for (const node of this._decorPool) {
            if (node.isValid) {
                Tween.stopAllByTarget(node);
                node.destroy();
            }
        }
        this._decorPool = [];
    }

    public getDebugY(): number {
        return this._targetBackgroundOffset;
    }

    public getDebugActiveDecorCount(): number {
        return this._activeDecors.size;
    }

    public getDebugActiveDecorIds(): string[] {
        return Array.from(this._activeDecors.keys()).sort();
    }

    private _createLayer(name: string, siblingIndex: number): Node {
        const node = new Node(name);
        this._root.addChild(node);
        node.setSiblingIndex(siblingIndex);
        node.addComponent(UITransform).setContentSize(GameConfig.DESIGN_WIDTH, GameConfig.DESIGN_HEIGHT);
        return node;
    }

    private _buildBottomTiles(): void {
        for (let i = 0; i < 2; i++) {
            const tile = this._createBottomTile(i === 0 ? "BottomTileA" : "BottomTileB");
            this._bottomTiles.push(tile);
        }
        this._resetBottomTiles();
    }

    private _createBottomTile(name: string): BottomTile {
        const tileHeight = this._getTileHeight();
        const node = new Node(name);
        this._bottomScrollLayer.addChild(node);
        node.addComponent(UITransform).setContentSize(GameConfig.DESIGN_WIDTH, tileHeight);
        const sprite = node.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.color = Color.WHITE;
        return { node, sprite, logicalIndex: -1 };
    }

    private _resetBottomTiles(): void {
        for (const tile of this._bottomTiles) {
            tile.logicalIndex = -1;
        }
        this._updateBottomTiles();
    }

    private _updateBottomTiles(): void {
        const tileHeight = this._getTileHeight();
        const distance = Math.max(0, -this._currentBackgroundOffset);
        const baseTileIndex = Math.floor(distance / tileHeight);
        const localOffset = -(distance - baseTileIndex * tileHeight);
        this._bottomScrollLayer.setPosition(0, localOffset, 0);

        for (let i = 0; i < this._bottomTiles.length; i++) {
            const tile = this._bottomTiles[i];
            const logicalIndex = baseTileIndex + i;
            tile.node.setPosition(0, this._getTileBaseY() + i * tileHeight, 0);
            if (tile.logicalIndex !== logicalIndex) {
                tile.logicalIndex = logicalIndex;
                this._applyGradient(tile, logicalIndex);
            }
        }
    }

    private _applyGradient(tile: BottomTile, logicalIndex: number): void {
        tile.sprite.spriteFrame = this._getGradientFrame(logicalIndex);
    }

    private _getGradientFrame(logicalIndex: number): SpriteFrame {
        const start = this._getGradientColor(logicalIndex);
        const end = this._getGradientColor(logicalIndex + 1);
        const key = `${start.r},${start.g},${start.b},${start.a}-${end.r},${end.g},${end.b},${end.a}`;
        const cached = this._gradientFrameCache.get(key);
        if (cached) {
            return cached;
        }

        const canvas = document.createElement("canvas");
        canvas.width = 8;
        canvas.height = Math.ceil(this._getTileHeight());
        const context = canvas.getContext("2d")!;
        const gradient = context.createLinearGradient(0, canvas.height, 0, 0);
        gradient.addColorStop(0, this._toCssColor(start));
        gradient.addColorStop(1, this._toCssColor(end));
        context.fillStyle = gradient;
        context.fillRect(0, 0, canvas.width, canvas.height);

        const image = new ImageAsset(canvas);
        const texture = new Texture2D();
        texture.image = image;
        const frame = new SpriteFrame();
        frame.texture = texture;
        this._gradientTextures.push(texture);
        this._gradientFrameCache.set(key, frame);
        return frame;
    }

    private _getGradientColor(index: number): Color {
        const lastColor = BottomBackgroundGradientColors[BottomBackgroundGradientColors.length - 1];
        if (index >= BottomBackgroundGradientColors.length) {
            return lastColor;
        }
        return BottomBackgroundGradientColors[Math.max(0, index)] || lastColor;
    }

    private _lerpColor(from: Color, to: Color, t: number): Color {
        const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
        return new Color(mix(from.r, to.r), mix(from.g, to.g), mix(from.b, to.b), mix(from.a, to.a));
    }

    private _toCssColor(color: Color): string {
        return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a / 255})`;
    }

    private _getTileHeight(): number {
        return GameConfig.DESIGN_HEIGHT * GameConfig.BACKGROUND_TILE_HEIGHT_RATIO;
    }

    private _getTileBaseY(): number {
        return (this._getTileHeight() - GameConfig.DESIGN_HEIGHT) * 0.5;
    }

    private _refreshMiddleDecors(): void {
        for (const config of MiddleBackgroundDecorConfigs) {
            const visible = this._shouldShowDecor(config);
            const active = this._activeDecors.has(config.id);
            if (visible && !active) {
                this._addDecor(config);
            } else if (!visible && active) {
                this._removeDecor(config.id);
            }
        }

        for (const active of this._activeDecors.values()) {
            this._updateDecorPosition(active);
        }
    }

    private _shouldShowDecor(config: MiddleBackgroundDecorConfig): boolean {
        const y = this._calculateDecorY(config, this._targetBackgroundOffset);
        const halfView = GameConfig.DESIGN_HEIGHT * 0.5;
        const preload = GameConfig.BACKGROUND_DECOR_PRELOAD;
        const release = GameConfig.BACKGROUND_DECOR_RELEASE_PADDING;
        return y + config.height * 0.5 >= -halfView - release && y - config.height * 0.5 <= halfView + preload;
    }

    private _addDecor(config: MiddleBackgroundDecorConfig): void {
        const node = this._decorPool.pop() || this._createDecorNode();
        node.name = `Decor_${config.id}`;
        node.active = true;
        if (node.parent !== this._middleLayer) {
            this._middleLayer.addChild(node);
        }

        const transform = node.getComponent(UITransform)!;
        transform.setContentSize(config.width, config.height);
        const content = this._getDecorContent(node);
        content.getComponent(UITransform)!.setContentSize(config.width, config.height);
        this._applyDecorVisual(node, config);
        const label = content.getChildByName("Label")?.getComponent(Label);
        if (label) {
            label.string = config.label;
            label.enabled = config.label.length > 0;
        }
        this._activeDecors.set(config.id, { config, node, content });
        this._startDecorAnimation(config, content);
        this._updateDecorPosition({ config, node, content });
    }

    private _removeDecor(id: string): void {
        const active = this._activeDecors.get(id);
        if (!active) return;
        Tween.stopAllByTarget(active.node);
        Tween.stopAllByTarget(active.content);
        active.node.active = false;
        active.node.removeFromParent();
        this._decorPool.push(active.node);
        this._activeDecors.delete(id);
    }

    private _updateDecorPosition(active: ActiveDecor): void {
        active.node.setPosition(active.config.x, this._calculateDecorY(active.config, this._currentBackgroundOffset), 0);
    }

    private _calculateDecorY(config: MiddleBackgroundDecorConfig, offset: number): number {
        if (config.anchorFloor !== undefined) {
            const anchorOffset = this._getBackgroundOffsetByFloor(config.anchorFloor);
            return config.y + (offset - anchorOffset) * config.parallax + config.appearOffset;
        }
        return config.y + offset * config.parallax + config.appearOffset;
    }

    private _getBackgroundOffsetByFloor(floor: number): number {
        if (floor <= 2) {
            return 0;
        }
        const cameraOffsetY = -(floor - GameConfig.VISIBLE_FLOOR_COUNT) * GameConfig.HOUSE_SIZE;
        const backgroundOffset = cameraOffsetY * GameConfig.BACKGROUND_SCROLL_RATIO;
        return Math.min(0, backgroundOffset);
    }

    private _applyBackgroundOffset(offset: number): void {
        this._currentBackgroundOffset = offset;
        this._updateBottomTiles();
        this._refreshMiddleDecors();
        for (const active of this._activeDecors.values()) {
            this._updateDecorPosition(active);
        }
    }

    private _createDecorNode(): Node {
        const node = new Node("Decor");
        node.addComponent(UITransform);

        const content = new Node("Content");
        node.addChild(content);
        content.addComponent(UITransform);
        const sprite = content.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.enabled = false;
        content.addComponent(Graphics);

        const labelNode = new Node("Label");
        content.addChild(labelNode);
        labelNode.addComponent(UITransform).setContentSize(220, 44);
        const label = labelNode.addComponent(Label);
        label.fontSize = 24;
        label.lineHeight = 32;
        label.color = new Color(255, 255, 255, 220);
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        return node;
    }

    private _applyDecorVisual(node: Node, config: MiddleBackgroundDecorConfig): void {
        const content = this._getDecorContent(node);
        const sprite = content.getComponent(Sprite)!;
        const graphics = content.getComponent(Graphics)!;
        const path = this._getDecorPath(config);
        if (path) {
            graphics.clear();
            graphics.enabled = false;
            sprite.enabled = true;
            sprite.color = Color.WHITE;
            sprite.spriteFrame = null;
            const requestKey = `${config.id}_${Date.now()}_${Math.random()}`;
            this._decorRequestIds.set(node, requestKey);
            // 装饰节点也会进入缓存池，校验请求版本避免旧异步加载覆盖复用后的节点。
            ResourceLoader.setSpriteFrame(sprite, path, () => node.isValid && this._decorRequestIds.get(node) === requestKey);
            return;
        }

        this._decorRequestIds.delete(node);
        sprite.spriteFrame = null;
        sprite.enabled = false;
        graphics.enabled = true;
        this._drawRect(graphics, config.width, config.height, config.color || Color.WHITE);
    }

    private _getDecorContent(node: Node): Node {
        const content = node.getChildByName("Content");
        if (content) {
            return content;
        }
        const created = new Node("Content");
        node.addChild(created);
        created.addComponent(UITransform);
        const sprite = created.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.enabled = false;
        created.addComponent(Graphics);
        return created;
    }

    private _getDecorPath(config: MiddleBackgroundDecorConfig): string | undefined {
        if (config.paths && config.paths.length > 0) {
            const index = Math.floor(Math.random() * config.paths.length);
            return config.paths[index];
        }
        return config.path;
    }

    private _startDecorAnimation(config: MiddleBackgroundDecorConfig, content: Node): void {
        Tween.stopAllByTarget(content);
        content.setPosition(0, 0, 0);
        const amplitude = config.animationAmplitude || 0;
        const duration = Math.max(0.1, config.animationDuration || 4);
        if (config.animation === "sway") {
            tween(content)
                .repeatForever(
                    tween()
                        .to(duration * 0.25, { position: new Vec3(amplitude, 0, 0) }, { easing: "sineInOut" })
                        .to(duration * 0.5, { position: new Vec3(-amplitude, 0, 0) }, { easing: "sineInOut" })
                        .to(duration * 0.25, { position: new Vec3(0, 0, 0) }, { easing: "sineInOut" }),
                )
                .start();
            return;
        }
        if (config.animation === "flyAcross") {
            const startX = -GameConfig.DESIGN_WIDTH * 0.8;
            const endX = GameConfig.DESIGN_WIDTH * 0.8;
            content.setPosition(startX, 0, 0);
            tween(content)
                .repeatForever(
                    tween()
                        .to(duration, { position: new Vec3(endX, 0, 0) })
                        .call(() => content.setPosition(startX, 0, 0)),
                )
                .start();
            return;
        }
        if (config.animation === "drift") {
            tween(content)
                .repeatForever(
                    tween()
                        .to(duration * 0.5, { position: new Vec3(amplitude, amplitude * 0.25, 0) }, { easing: "sineInOut" })
                        .to(duration * 0.5, { position: new Vec3(-amplitude, -amplitude * 0.2, 0) }, { easing: "sineInOut" })
                        .to(duration * 0.25, { position: new Vec3(0, 0, 0) }, { easing: "sineInOut" }),
                )
                .start();
            return;
        }
        if (config.animation === "float") {
            tween(content)
                .repeatForever(
                    tween()
                        .to(duration * 0.5, { position: new Vec3(0, amplitude, 0) }, { easing: "sineInOut" })
                        .to(duration * 0.5, { position: new Vec3(0, -amplitude, 0) }, { easing: "sineInOut" })
                        .to(duration * 0.25, { position: new Vec3(0, 0, 0) }, { easing: "sineInOut" }),
                )
                .start();
        }
    }

    private _drawRect(graphics: Graphics, width: number, height: number, color: Color): void {
        graphics.clear();
        graphics.fillColor = color;
        graphics.rect(-width * 0.5, -height * 0.5, width, height);
        graphics.fill();
    }

    private _clearGradientCache(): void {
        this._gradientFrameCache.forEach((frame) => {
            if (frame.isValid) {
                frame.destroy();
            }
        });
        for (const texture of this._gradientTextures) {
            if (texture.isValid) {
                texture.destroy();
            }
        }
        this._gradientFrameCache.clear();
        this._gradientTextures = [];
    }

    private _clearActiveDecors(): void {
        for (const active of this._activeDecors.values()) {
            Tween.stopAllByTarget(active.node);
            Tween.stopAllByTarget(active.content);
            active.node.active = false;
            active.node.removeFromParent();
            this._decorPool.push(active.node);
        }
        this._activeDecors.clear();
    }
}
