/**
 * 全局事件管理器。
 * 参考 HongHuang 的事件系统，保留轻量订阅、派发和按目标自动清理能力。
 */
export class EventManager {
    private static _instance: EventManager | null = null;
    private _listeners: Map<string, Array<{ callback: Function; target: any; once: boolean }>> = new Map();

    public static get instance(): EventManager {
        if (!this._instance) {
            this._instance = new EventManager();
        }
        return this._instance;
    }

    public on(event: string, callback: Function, target?: any): void {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, []);
        }
        const list = this._listeners.get(event)!;
        const exists = list.some((item) => item.callback === callback && item.target === target);
        if (!exists) {
            list.push({ callback, target, once: false });
        }
    }

    public once(event: string, callback: Function, target?: any): void {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, []);
        }
        this._listeners.get(event)!.push({ callback, target, once: true });
    }

    public off(event: string, callback: Function, target?: any): void {
        const list = this._listeners.get(event);
        if (!list) return;
        for (let i = list.length - 1; i >= 0; i--) {
            const item = list[i];
            if (item.callback === callback && item.target === target) {
                list.splice(i, 1);
            }
        }
        if (list.length === 0) {
            this._listeners.delete(event);
        }
    }

    public offAllByTarget(target: any): void {
        this._listeners.forEach((list, event) => {
            for (let i = list.length - 1; i >= 0; i--) {
                if (list[i].target === target) {
                    list.splice(i, 1);
                }
            }
            if (list.length === 0) {
                this._listeners.delete(event);
            }
        });
    }

    public emit(event: string, ...args: any[]): void {
        const list = this._listeners.get(event);
        if (!list) return;
        const snapshot = list.slice();
        for (const listener of snapshot) {
            if (listener.target) {
                listener.callback.call(listener.target, ...args);
            } else {
                listener.callback(...args);
            }
            if (listener.once) {
                this.off(event, listener.callback, listener.target);
            }
        }
    }

    public clear(): void {
        this._listeners.clear();
    }
}
