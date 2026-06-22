import { _decorator, Component } from "cc";

const { ccclass } = _decorator;
const API_URL = "http://localhost:7458/api/log";
let injected = false;

function sendLog(level: string, args: any[], stack?: string): void {
    try {
        const message = Array.prototype.map.call(args, (item: any) => {
            if (typeof item === "object") {
                try {
                    return JSON.stringify(item);
                } catch {
                    return String(item);
                }
            }
            return String(item);
        }).join(" ");
        if (message.indexOf("[DebugLogCollector]") >= 0) return;
        const xhr = new XMLHttpRequest();
        xhr.open("POST", API_URL, true);
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.send(JSON.stringify({ level, message, stack: stack || "" }));
    } catch {
        // 日志采集不能影响游戏主流程，失败时静默跳过。
    }
}

function injectConsole(): void {
    const levels = ["log", "warn", "error", "info", "debug"];
    for (const level of levels) {
        const original = (console as any)[level];
        (console as any)[level] = function(...args: any[]) {
            original.apply(console, args);
            sendLog(level, args);
        };
    }
    if (typeof window !== "undefined") {
        window.addEventListener("error", (event: Event) => {
            const errorEvent = event as ErrorEvent;
            sendLog("error", [errorEvent.message], errorEvent.error ? errorEvent.error.stack : "");
        }, true);
        window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
            const reason = event.reason;
            const message = reason ? (reason.message || String(reason)) : "Unhandled promise rejection";
            sendLog("error", [`[UnhandledRejection] ${message}`], reason ? reason.stack : "");
        });
    }
    console.log("[DebugLogCollector] 运行时日志采集已启动");
}

/** 预览调试日志采集器，参考 HongHuang 的 auto-preview 开发闭环。 */
@ccclass("DebugLogCollector")
export class DebugLogCollector extends Component {
    protected start(): void {
        if (injected) return;
        injected = true;
        injectConsole();
    }
}
