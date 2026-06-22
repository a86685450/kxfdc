import { Node } from "cc";
import { EventManager } from "../event/EventManager";
import { UIConfig } from "./UIDefine";
import { UIManager } from "./UIManager";

/**
 * UI 面板基类。
 * 参考 HongHuang 的 UIBase 生命周期，业务面板只关心初始化、显示和关闭。
 */
export class UIBase {
    public uiName = "";
    public config: UIConfig | null = null;
    public node: Node | null = null;
    public isInited = false;
    public isShowing = false;
    public isHiddenByOther = false;

    private _hideCount = 0;

    protected onInit(): void { }
    protected onShow(_params?: any): void { }
    protected onHide(): void { }
    protected onResume(): void { }
    protected onClose(): void { }

    public _doInit(uiName: string, config: UIConfig, node: Node): void {
        this.uiName = uiName;
        this.config = config;
        this.node = node;
        this.isInited = true;
        this.onInit();
    }

    public _doShow(params?: any): void {
        this.isShowing = true;
        this.isHiddenByOther = false;
        this._hideCount = 0;
        if (this.node) {
            this.node.active = true;
        }
        this.onShow(params);
    }

    public _doHideByOther(): void {
        if (!this.node) return;
        if (!this.isHiddenByOther) {
            this.isHiddenByOther = true;
            this._hideCount = 1;
            this.node.active = false;
            this.onHide();
            return;
        }
        this._hideCount++;
    }

    public _doResumeFromHide(): boolean {
        if (!this.node) return false;
        this._hideCount--;
        if (this._hideCount <= 0) {
            this.isHiddenByOther = false;
            this.node.active = true;
            this.onResume();
            return true;
        }
        return false;
    }

    public _doClose(): void {
        this.isShowing = false;
        EventManager.instance.offAllByTarget(this);
        this.onClose();
        if (this.node && this.node.isValid) {
            this.node.destroy();
        }
        this.node = null;
    }

    public close(): void {
        UIManager.instance.close(this.uiName);
    }

    protected registerEvent(event: string, callback: Function): void {
        EventManager.instance.on(event, callback, this);
    }

    protected emitEvent(event: string, ...args: any[]): void {
        EventManager.instance.emit(event, ...args);
    }
}
