import { instantiate, Node, Prefab, resources, UITransform, Widget } from "cc";
import { EventManager } from "../event/EventManager";
import { UIBase } from "./UIBase";
import { UIConfig, UIEvents, UILayer, UIOpenType } from "./UIDefine";

/**
 * UI 管理器。
 * 参考 HongHuang 的 UIManager，同时支持无 prefab 的代码生成面板，方便当前空项目快速搭建。
 */
export class UIManager {
    private static _instance: UIManager | null = null;

    private _uiRoot: Node | null = null;
    private _layerNodes: Map<UILayer, Node> = new Map();
    private _configs: Map<string, UIConfig> = new Map();
    private _ctorMap: Map<string, new () => UIBase> = new Map();
    private _openedPanels: Map<string, UIBase> = new Map();
    private _panelStack: string[] = [];
    private _hiddenByMap: Map<string, string[]> = new Map();
    private _preloadCache: Map<string, Prefab> = new Map();

    public static get instance(): UIManager {
        if (!this._instance) {
            this._instance = new UIManager();
        }
        return this._instance;
    }

    public init(canvas: Node): void {
        if (this._uiRoot === canvas && canvas.isValid) return;
        this._uiRoot = canvas;
        this._layerNodes.clear();
        this._openedPanels.clear();
        this._panelStack = [];
        this._hiddenByMap.clear();
        this._preloadCache.clear();

        const layers: [UILayer, string][] = [
            [UILayer.Scene, "LayerScene"],
            [UILayer.Default, "LayerDefault"],
            [UILayer.Popup, "LayerPopup"],
            [UILayer.Guide, "LayerGuide"],
            [UILayer.Loading, "LayerLoading"],
            [UILayer.Toast, "LayerToast"],
            [UILayer.System, "LayerSystem"],
        ];

        for (const [layer, name] of layers) {
            let node = canvas.getChildByName(name);
            if (!node) {
                node = new Node(name);
                canvas.addChild(node);
                this._fitParent(node, canvas);
            }
            node.setSiblingIndex(layer);
            this._layerNodes.set(layer, node);
        }

        console.log("[UIManager] 初始化完成");
    }

    public getRoot(): Node | null {
        return this._uiRoot;
    }

    public register<T extends UIBase>(uiName: string, ctor: new () => T, config: UIConfig): void {
        config.openType = config.openType ?? UIOpenType.DontHideOthers;
        config.canHideByOther = config.canHideByOther ?? true;
        config.closeOnSceneChange = config.closeOnSceneChange ?? true;
        this._configs.set(uiName, config);
        this._ctorMap.set(uiName, ctor);
    }

    public async open<T extends UIBase>(uiName: string, params?: any): Promise<T | null> {
        const config = this._configs.get(uiName);
        const ctor = this._ctorMap.get(uiName);
        if (!config || !ctor) {
            console.error(`[UIManager] UI 未注册: ${uiName}`);
            return null;
        }

        const existing = this._openedPanels.get(uiName);
        if (existing) {
            existing._doShow(params);
            return existing as T;
        }

        const layerNode = this._layerNodes.get(config.layer);
        if (!layerNode) {
            console.error(`[UIManager] 层级不存在: ${config.layer}`);
            return null;
        }

        const node = await this._createPanelNode(uiName, config, layerNode);
        const panel = new ctor() as T;
        panel._doInit(uiName, config, node);
        this._handleOpenType(uiName, config);
        this._openedPanels.set(uiName, panel);
        this._panelStack.push(uiName);
        panel._doShow(params);
        EventManager.instance.emit(UIEvents.UI_OPEN, uiName, panel);
        return panel;
    }

    public close(uiName: string): void {
        const panel = this._openedPanels.get(uiName);
        if (!panel) return;
        this._restoreHiddenPanels(uiName);
        this._openedPanels.delete(uiName);
        const index = this._panelStack.indexOf(uiName);
        if (index >= 0) {
            this._panelStack.splice(index, 1);
        }
        this._removeFromHiddenMap(uiName);
        panel._doClose();
        EventManager.instance.emit(UIEvents.UI_CLOSE, uiName);
    }

    public find<T extends UIBase>(uiName: string): T | null {
        return (this._openedPanels.get(uiName) as T) || null;
    }

    public closeAll(excludes?: string[]): void {
        const excludeSet = new Set(excludes || []);
        const stack = this._panelStack.slice();
        for (let i = stack.length - 1; i >= 0; i--) {
            if (!excludeSet.has(stack[i])) {
                this.close(stack[i]);
            }
        }
    }

    public async preload(uiName: string): Promise<void> {
        const config = this._configs.get(uiName);
        if (!config || !config.prefabPath || this._preloadCache.has(uiName)) return;
        const prefab = await this._loadPrefab(config.prefabPath);
        if (prefab) {
            this._preloadCache.set(uiName, prefab);
        }
    }

    private async _createPanelNode(uiName: string, config: UIConfig, parent: Node): Promise<Node> {
        let node: Node | null = null;
        if (config.prefabPath) {
            const prefab = this._preloadCache.get(uiName) || await this._loadPrefab(config.prefabPath);
            if (prefab) {
                node = instantiate(prefab);
            }
        }
        if (!node) {
            node = new Node(uiName);
            this._fitParent(node, parent);
        }
        parent.addChild(node);
        return node;
    }

    private _fitParent(node: Node, parent: Node): void {
        let transform = node.getComponent(UITransform);
        if (!transform) {
            transform = node.addComponent(UITransform);
        }
        const parentTransform = parent.getComponent(UITransform);
        if (parentTransform) {
            transform.setContentSize(parentTransform.contentSize);
        }
        const widget = node.getComponent(Widget) || node.addComponent(Widget);
        widget.isAlignTop = true;
        widget.isAlignBottom = true;
        widget.isAlignLeft = true;
        widget.isAlignRight = true;
        widget.top = 0;
        widget.bottom = 0;
        widget.left = 0;
        widget.right = 0;
    }

    private _loadPrefab(path: string): Promise<Prefab | null> {
        return new Promise((resolve) => {
            resources.load(path, Prefab, (err, prefab) => {
                if (err) {
                    console.warn(`[UIManager] 预制体加载失败，改用代码面板: ${path}`);
                    resolve(null);
                    return;
                }
                resolve(prefab);
            });
        });
    }

    private _handleOpenType(uiName: string, config: UIConfig): void {
        if (config.openType !== UIOpenType.HidePrevious) return;
        const hidden: string[] = [];
        for (const name of this._panelStack) {
            const panel = this._openedPanels.get(name);
            if (name !== uiName && panel && panel.config?.canHideByOther) {
                panel._doHideByOther();
                hidden.push(name);
            }
        }
        if (hidden.length > 0) {
            this._hiddenByMap.set(uiName, hidden);
        }
    }

    private _restoreHiddenPanels(uiName: string): void {
        const hidden = this._hiddenByMap.get(uiName);
        if (!hidden) return;
        for (const hiddenName of hidden) {
            const panel = this._openedPanels.get(hiddenName);
            if (panel) {
                panel._doResumeFromHide();
            }
        }
        this._hiddenByMap.delete(uiName);
    }

    private _removeFromHiddenMap(uiName: string): void {
        this._hiddenByMap.forEach((list, key) => {
            const next = list.filter((name) => name !== uiName);
            if (next.length === 0) {
                this._hiddenByMap.delete(key);
            } else {
                this._hiddenByMap.set(key, next);
            }
        });
    }
}
