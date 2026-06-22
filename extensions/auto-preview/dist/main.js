"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.methods = void 0;
exports.load = load;
exports.unload = unload;
const child_process_1 = require("child_process");
const http = __importStar(require("http"));
const url = __importStar(require("url"));
// ============================================================
// 全局状态
// ============================================================
let state = {
    running: false,
    port: 7456,
    apiPort: 7458,
    browserOpened: false,
};
/** 运行时日志缓冲区 */
const runtimeLogs = [];
const MAX_LOGS = 2000;
/** 轮询检测预览服务器的定时器 */
let pollTimer = null;
/** 本插件的 HTTP API 服务器 */
let apiServer = null;
// ============================================================
// 日志采集
// ============================================================
/** 添加一条运行时日志 */
function addLog(log) {
    runtimeLogs.push(log);
    if (runtimeLogs.length > MAX_LOGS) {
        runtimeLogs.splice(0, runtimeLogs.length - MAX_LOGS);
    }
}
/** 添加一条编辑器来源的日志 */
function editorLog(level, message) {
    const msg = `[auto-preview] ${message}`;
    // 同时输出到编辑器控制台
    if (level === 'error')
        console.error(msg);
    else if (level === 'warn')
        console.warn(msg);
    else
        console.log(msg);
    addLog({
        timestamp: new Date().toISOString(),
        level,
        source: 'editor',
        message,
    });
}
/** 清空日志 */
function clearLogs() {
    runtimeLogs.length = 0;
}
// ============================================================
// 工具函数
// ============================================================
/** 检测端口是否有 HTTP 服务 */
function checkPort(port) {
    return new Promise((resolve) => {
        const req = http.get(`http://localhost:${port}`, (res) => {
            res.resume();
            resolve(true);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(1500, () => { req.destroy(); resolve(false); });
    });
}
/** 在默认浏览器中打开 URL */
function openInBrowser(urlStr) {
    const platform = process.platform;
    let cmd;
    if (platform === 'darwin')
        cmd = `open "${urlStr}"`;
    else if (platform === 'win32')
        cmd = `start "" "${urlStr}"`;
    else
        cmd = `xdg-open "${urlStr}"`;
    (0, child_process_1.exec)(cmd, (err) => {
        if (err)
            editorLog('error', `打开浏览器失败: ${err.message}`);
        else
            editorLog('log', `已在浏览器中打开: ${urlStr}`);
    });
}
/** 等待预览服务器就绪后打开浏览器 */
function waitForServerAndOpenBrowser(port, maxRetries = 30) {
    let retries = 0;
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    editorLog('log', `等待预览服务器启动 (端口: ${port})...`);
    pollTimer = setInterval(async () => {
        retries++;
        const isReady = await checkPort(port);
        if (isReady) {
            if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
            }
            state.running = true;
            editorLog('log', `预览服务器已就绪 (轮询 ${retries} 次)`);
            if (!state.browserOpened) {
                openInBrowser(`http://localhost:${port}`);
                state.browserOpened = true;
            }
        }
        else if (retries >= maxRetries) {
            if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
            }
            editorLog('warn', `等待预览服务器超时 (${maxRetries} 次)`);
        }
    }, 1000);
}
// ============================================================
// HTTP API 服务器（供 AI / 外部工具调用）
// ============================================================
/**
 * 生成注入到预览页面的 JS 脚本
 * 该脚本会拦截浏览器的 console/error，通过 fetch 发送到本插件 API
 */
function generateInjectScript() {
    const apiBase = `http://localhost:${state.apiPort}`;
    return `
(function() {
    if (window.__autoPreviewInjected) return;
    window.__autoPreviewInjected = true;

    var API = "${apiBase}/api/log";

    function send(level, args, stack) {
        try {
            var msg = Array.prototype.map.call(args, function(a) {
                if (typeof a === 'object') {
                    try { return JSON.stringify(a); } catch(e) { return String(a); }
                }
                return String(a);
            }).join(' ');
            fetch(API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ level: level, message: msg, stack: stack || '' })
            }).catch(function(){});
        } catch(e) {}
    }

    // 拦截 console 方法
    ['log', 'warn', 'error', 'info', 'debug'].forEach(function(level) {
        var orig = console[level];
        console[level] = function() {
            orig.apply(console, arguments);
            send(level, arguments);
        };
    });

    // 捕获全局未处理错误
    window.addEventListener('error', function(e) {
        send('error', [e.message], e.error ? e.error.stack : (e.filename + ':' + e.lineno + ':' + e.colno));
    });

    // 捕获 Promise 未处理拒绝
    window.addEventListener('unhandledrejection', function(e) {
        var msg = e.reason ? (e.reason.message || String(e.reason)) : 'Unhandled promise rejection';
        var stack = e.reason ? e.reason.stack : '';
        send('error', ['[UnhandledRejection] ' + msg], stack);
    });

    // 捕获资源加载失败
    window.addEventListener('error', function(e) {
        if (e.target && (e.target.tagName === 'SCRIPT' || e.target.tagName === 'LINK' || e.target.tagName === 'IMG')) {
            send('error', ['[ResourceLoadError] ' + (e.target.src || e.target.href)]);
        }
    }, true);

    console.log('[auto-preview] 运行时日志采集已注入');
})();
`;
}
/** 处理 API 请求 */
function handleApiRequest(req, res) {
    var _a;
    // 允许跨域（预览页面向 API 端口发请求）
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    const parsedUrl = url.parse(req.url || '', true);
    const pathname = parsedUrl.pathname || '';
    // ---- POST /api/log : 接收浏览器运行时日志 ----
    if (req.method === 'POST' && pathname === '/api/log') {
        let body = '';
        req.on('data', (chunk) => body += chunk);
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                addLog({
                    timestamp: new Date().toISOString(),
                    level: data.level || 'log',
                    source: 'browser',
                    message: data.message || '',
                    stack: data.stack || undefined,
                    url: data.url || undefined,
                    line: data.line || undefined,
                    col: data.col || undefined,
                });
            }
            catch (e) {
                // 解析失败，忽略
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{"ok":true}');
        });
        return;
    }
    // ---- GET /api/logs : AI 获取运行时日志 ----
    if (req.method === 'GET' && pathname === '/api/logs') {
        const query = parsedUrl.query || {};
        const level = query.level || 'all';
        const limit = parseInt(query.limit || '100', 10);
        const source = query.source || 'all'; // browser | editor | all
        const since = query.since || ''; // ISO 时间戳，只返回此时间之后的日志
        let filtered = runtimeLogs;
        if (level !== 'all') {
            filtered = filtered.filter(l => l.level === level);
        }
        if (source !== 'all') {
            filtered = filtered.filter(l => l.source === source);
        }
        if (since) {
            filtered = filtered.filter(l => l.timestamp > since);
        }
        const result = filtered.slice(-limit);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            total: runtimeLogs.length,
            filtered: result.length,
            logs: result,
        }));
        return;
    }
    // ---- GET /api/errors : AI 快速获取所有错误 ----
    if (req.method === 'GET' && pathname === '/api/errors') {
        const limit = parseInt(((_a = parsedUrl.query) === null || _a === void 0 ? void 0 : _a.limit) || '50', 10);
        const errors = runtimeLogs
            .filter(l => l.level === 'error')
            .slice(-limit);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            total: errors.length,
            errors,
        }));
        return;
    }
    // ---- GET /api/status : 获取预览状态 ----
    if (req.method === 'GET' && pathname === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            previewRunning: state.running,
            previewPort: state.port,
            apiPort: state.apiPort,
            browserOpened: state.browserOpened,
            logCount: runtimeLogs.length,
            errorCount: runtimeLogs.filter(l => l.level === 'error').length,
            warnCount: runtimeLogs.filter(l => l.level === 'warn').length,
        }));
        return;
    }
    // ---- POST /api/clear : 清空日志 ----
    if (req.method === 'POST' && pathname === '/api/clear') {
        clearLogs();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true,"message":"日志已清空"}');
        return;
    }
    // ---- GET /api/inject.js : 预览页面手动引入的注入脚本 ----
    if (req.method === 'GET' && pathname === '/api/inject.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(generateInjectScript());
        return;
    }
    // ---- POST /api/start-preview : AI 远程启动预览 ----
    if (req.method === 'POST' && pathname === '/api/start-preview') {
        exports.methods.startPreview();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true,"message":"启动预览命令已发送"}');
        return;
    }
    // ---- POST /api/stop-preview : AI 远程停止预览 ----
    if (req.method === 'POST' && pathname === '/api/stop-preview') {
        exports.methods.stopPreview();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true,"message":"停止预览命令已发送"}');
        return;
    }
    // ---- POST /api/refresh-preview : AI 远程刷新预览 ----
    if (req.method === 'POST' && pathname === '/api/refresh-preview') {
        exports.methods.refreshPreview();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true,"message":"刷新预览命令已发送"}');
        return;
    }
    // ---- POST /api/reload-extension : 重新加载指定扩展 ----
    if (req.method === 'POST' && pathname === '/api/reload-extension') {
        let body = '';
        req.on('data', (chunk) => body += chunk);
        req.on('end', async () => {
            try {
                const data = body ? JSON.parse(body) : {};
                const extName = data.name || 'auto-preview';
                editorLog('log', `正在重新加载扩展: ${extName}`);
                try {
                    // Cocos Creator 3.x 扩展管理消息
                    await Editor.Message.request('extension', 'reload', extName);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true, message: `扩展 ${extName} 已重新加载` }));
                }
                catch (e) {
                    // 备用方式：先禁用再启用
                    try {
                        await Editor.Message.request('extension', 'disable', extName);
                        await new Promise(r => setTimeout(r, 500));
                        await Editor.Message.request('extension', 'enable', extName);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ok: true, message: `扩展 ${extName} 已通过禁用/启用方式重新加载` }));
                    }
                    catch (e2) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ok: false, error: e2.message, hint: '请在编辑器中手动刷新扩展' }));
                    }
                }
            }
            catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: e.message }));
            }
        });
        return;
    }
    // ---- GET /api/help : 接口说明 ----
    if (pathname === '/api/help') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            name: 'auto-preview API',
            endpoints: [
                { method: 'GET', path: '/api/status', desc: '获取预览状态和日志统计' },
                { method: 'GET', path: '/api/logs', desc: '获取运行时日志', params: 'level=error|warn|log|all, source=browser|editor|all, limit=100, since=ISO时间戳' },
                { method: 'GET', path: '/api/errors', desc: '获取所有错误日志', params: 'limit=50' },
                { method: 'POST', path: '/api/clear', desc: '清空日志' },
                { method: 'POST', path: '/api/start-preview', desc: '启动预览' },
                { method: 'POST', path: '/api/stop-preview', desc: '停止预览' },
                { method: 'POST', path: '/api/refresh-preview', desc: '刷新预览' },
                { method: 'POST', path: '/api/reload-extension', desc: '重新加载扩展', params: 'name=扩展名(默认auto-preview)' },
                { method: 'GET', path: '/api/inject.js', desc: '获取注入脚本（预览页面自动引入）' },
            ]
        }, null, 2));
        return;
    }
    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":"Not Found","hint":"访问 /api/help 查看可用接口"}');
}
/** 启动 API 服务器 */
function startApiServer() {
    if (apiServer)
        return;
    apiServer = http.createServer(handleApiRequest);
    apiServer.listen(state.apiPort, '127.0.0.1', () => {
        editorLog('log', `API 服务器已启动: http://127.0.0.1:${state.apiPort}`);
        editorLog('log', `接口说明: http://127.0.0.1:${state.apiPort}/api/help`);
        editorLog('log', `AI 调试流程:`);
        editorLog('log', `  1. POST /api/start-preview  → 启动预览`);
        editorLog('log', `  2. GET  /api/errors          → 获取错误日志`);
        editorLog('log', `  3. 修复代码后 POST /api/refresh-preview → 刷新预览`);
        editorLog('log', `  4. 重复 2-3 直到无错误`);
    });
    apiServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            editorLog('warn', `端口 ${state.apiPort} 被占用，尝试 ${state.apiPort + 1}`);
            state.apiPort++;
            apiServer = null;
            startApiServer();
        }
        else {
            editorLog('error', `API 服务器启动失败: ${err.message}`);
        }
    });
}
/** 停止 API 服务器 */
function stopApiServer() {
    if (apiServer) {
        apiServer.close();
        apiServer = null;
        editorLog('log', 'API 服务器已停止');
    }
}
// ============================================================
// 编辑器扩展方法（菜单 / 快捷键 / 消息）
// ============================================================
exports.methods = {
    /** 启动预览 */
    async startPreview() {
        editorLog('log', '正在启动预览...');
        try {
            // 检测预览是否已在运行
            const alreadyRunning = await checkPort(state.port);
            if (alreadyRunning) {
                editorLog('log', '预览服务器已在运行，直接打开浏览器');
                openInBrowser(`http://localhost:${state.port}`);
                state.browserOpened = true;
                state.running = true;
                return;
            }
            state.browserOpened = false;
            // 尝试多种方式启动预览
            try {
                await Editor.Message.request('preview', 'open-preview');
            }
            catch (e1) {
                try {
                    await Editor.Message.request('preview', 'start');
                }
                catch (e2) {
                    try {
                        Editor.Message.send('preview', 'open');
                    }
                    catch (e3) {
                        try {
                            Editor.Message.send('editor', 'execute-menu', { path: 'Project/Preview' });
                        }
                        catch (e4) {
                            editorLog('warn', '编辑器消息启动预览失败，请手动点击 ▶ 按钮');
                            editorLog('log', '预览启动后，插件会自动检测并打开浏览器');
                        }
                    }
                }
            }
            waitForServerAndOpenBrowser(state.port);
        }
        catch (err) {
            editorLog('error', `启动预览异常: ${err.message}`);
        }
    },
    /** 停止预览 */
    async stopPreview() {
        editorLog('log', '正在停止预览...');
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
        try {
            try {
                await Editor.Message.request('preview', 'close-preview');
            }
            catch (e1) {
                try {
                    await Editor.Message.request('preview', 'stop');
                }
                catch (e2) {
                    try {
                        Editor.Message.send('preview', 'close');
                    }
                    catch (e3) {
                        editorLog('warn', '无法通过消息停止预览，请手动停止');
                    }
                }
            }
        }
        catch (err) {
            editorLog('error', `停止预览异常: ${err.message}`);
        }
        state.running = false;
        state.browserOpened = false;
        editorLog('log', '预览已停止');
    },
    /** 刷新预览 */
    async refreshPreview() {
        editorLog('log', '正在刷新预览...');
        const isRunning = await checkPort(state.port);
        if (!isRunning) {
            editorLog('warn', '预览未运行，先启动预览');
            exports.methods.startPreview();
            return;
        }
        // 方案1：通过 AppleScript 控制浏览器刷新（macOS）
        if (process.platform === 'darwin') {
            const previewUrl = `localhost:${state.port}`;
            // 先尝试 Chrome，再尝试 Safari
            const chromeScript = `
                tell application "Google Chrome"
                    set found to false
                    repeat with w in windows
                        repeat with t in tabs of w
                            if URL of t contains "${previewUrl}" then
                                tell t to reload
                                set found to true
                            end if
                        end repeat
                    end repeat
                    if not found then
                        open location "http://localhost:${state.port}"
                    end if
                end tell
            `;
            const safariScript = `
                tell application "Safari"
                    set found to false
                    repeat with w in windows
                        repeat with t in tabs of w
                            if URL of t contains "${previewUrl}" then
                                tell t to do JavaScript "location.reload()"
                                set found to true
                            end if
                        end repeat
                    end repeat
                end tell
            `;
            (0, child_process_1.exec)(`osascript -e '${chromeScript}'`, (err) => {
                if (err) {
                    // Chrome 不可用，尝试 Safari
                    (0, child_process_1.exec)(`osascript -e '${safariScript}'`, (err2) => {
                        if (err2) {
                            editorLog('warn', '无法通过 AppleScript 刷新浏览器，尝试重新打开页面');
                            openInBrowser(`http://localhost:${state.port}`);
                        }
                        else {
                            editorLog('log', '已通过 Safari 刷新预览页面');
                        }
                    });
                }
                else {
                    editorLog('log', '已通过 Chrome 刷新预览页面');
                }
            });
        }
        else {
            // 非 macOS：回退到打开浏览器
            openInBrowser(`http://localhost:${state.port}`);
            editorLog('log', '已重新打开预览页面');
        }
        editorLog('log', '刷新命令已发送');
    },
    /** 打开浏览器 */
    openBrowser() {
        openInBrowser(`http://localhost:${state.port}`);
        state.browserOpened = true;
    },
    /** 场景保存时自动刷新 */
    async onSceneSaved() {
        if (state.running) {
            editorLog('log', '检测到场景保存，自动刷新预览');
            exports.methods.refreshPreview();
        }
    },
};
// ============================================================
// 扩展生命周期
// ============================================================
function load() {
    editorLog('log', '扩展已加载');
    editorLog('log', '快捷键: Cmd+Shift+P 启动 | Cmd+Shift+O 停止 | Cmd+Shift+R 刷新');
    // 启动 API 服务器
    startApiServer();
    // 检测预览是否已在运行
    checkPort(state.port).then((running) => {
        if (running) {
            state.running = true;
            editorLog('log', `检测到预览服务器已在端口 ${state.port} 运行`);
        }
    });
}
function unload() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    stopApiServer();
    editorLog('log', '扩展已卸载');
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NvdXJjZS9tYWluLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQXNsQkEsb0JBY0M7QUFFRCx3QkFJQztBQTFtQkQsaURBQXFDO0FBQ3JDLDJDQUE2QjtBQUM3Qix5Q0FBMkI7QUEwQjNCLCtEQUErRDtBQUMvRCxPQUFPO0FBQ1AsK0RBQStEO0FBRS9ELElBQUksS0FBSyxHQUFpQjtJQUN0QixPQUFPLEVBQUUsS0FBSztJQUNkLElBQUksRUFBRSxJQUFJO0lBQ1YsT0FBTyxFQUFFLElBQUk7SUFDYixhQUFhLEVBQUUsS0FBSztDQUN2QixDQUFDO0FBRUYsZUFBZTtBQUNmLE1BQU0sV0FBVyxHQUFpQixFQUFFLENBQUM7QUFDckMsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDO0FBRXRCLG9CQUFvQjtBQUNwQixJQUFJLFNBQVMsR0FBMEMsSUFBSSxDQUFDO0FBRTVELHdCQUF3QjtBQUN4QixJQUFJLFNBQVMsR0FBdUIsSUFBSSxDQUFDO0FBRXpDLCtEQUErRDtBQUMvRCxPQUFPO0FBQ1AsK0RBQStEO0FBRS9ELGdCQUFnQjtBQUNoQixTQUFTLE1BQU0sQ0FBQyxHQUFlO0lBQzNCLFdBQVcsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7SUFDdEIsSUFBSSxXQUFXLENBQUMsTUFBTSxHQUFHLFFBQVEsRUFBRSxDQUFDO1FBQ2hDLFdBQVcsQ0FBQyxNQUFNLENBQUMsQ0FBQyxFQUFFLFdBQVcsQ0FBQyxNQUFNLEdBQUcsUUFBUSxDQUFDLENBQUM7SUFDekQsQ0FBQztBQUNMLENBQUM7QUFFRCxtQkFBbUI7QUFDbkIsU0FBUyxTQUFTLENBQUMsS0FBMEIsRUFBRSxPQUFlO0lBQzFELE1BQU0sR0FBRyxHQUFHLGtCQUFrQixPQUFPLEVBQUUsQ0FBQztJQUN4QyxjQUFjO0lBQ2QsSUFBSSxLQUFLLEtBQUssT0FBTztRQUFF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QUFnQixNQUFNO0lBQ2xCLElBQUksU0FBUyxFQUFFLENBQUM7UUFBQyxhQUFhLENBQUMsU0FBUyxDQUFDLENBQUM7UUFBQyxTQUFTLEdBQUcsSUFBSSxDQUFDO0lBQUMsQ0FBQztJQUM5RCxhQUFhLEVBQUUsQ0FBQztJQUNoQixTQUFTLENBQUMsS0FBSyxFQUFFLE9BQU8sQ0FBQyxDQUFDO0FBQzlCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBleGVjIH0gZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgKiBhcyBodHRwIGZyb20gJ2h0dHAnO1xuaW1wb3J0ICogYXMgdXJsIGZyb20gJ3VybCc7XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8g57G75Z6L5a6a5LmJXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqIOi/kOihjOaXtuaXpeW/l+adoeebriAqL1xuaW50ZXJmYWNlIFJ1bnRpbWVMb2cge1xuICAgIHRpbWVzdGFtcDogc3RyaW5nOyAgICAvLyBJU08g5pe26Ze05oizXG4gICAgbGV2ZWw6ICdsb2cnIHwgJ3dhcm4nIHwgJ2Vycm9yJyB8ICdpbmZvJyB8ICdkZWJ1Zyc7XG4gICAgc291cmNlOiAnYnJvd3NlcicgfCAnZWRpdG9yJzsgIC8vIOadpea6kO+8mua1j+iniOWZqOi/kOihjOaXtiAvIOe8lui+keWZqFxuICAgIG1lc3NhZ2U6IHN0cmluZztcbiAgICBzdGFjaz86IHN0cmluZzsgICAgICAgLy8g6ZSZ6K+v5aCG5qCIXG4gICAgdXJsPzogc3RyaW5nOyAgICAgICAgIC8vIOaKpemUmeeahOaWh+S7tiBVUkxcbiAgICBsaW5lPzogbnVtYmVyOyAgICAgICAgLy8g6KGM5Y+3XG4gICAgY29sPzogbnVtYmVyOyAgICAgICAgIC8vIOWIl+WPt1xufVxuXG4vKiog6aKE6KeI54q25oCBICovXG5pbnRlcmZhY2UgUHJldmlld1N0YXRlIHtcbiAgICBydW5uaW5nOiBib29sZWFuO1xuICAgIHBvcnQ6IG51bWJlcjsgICAgICAgICAgIC8vIENvY29zIOmihOiniOerr+WPo1xuICAgIGFwaVBvcnQ6IG51bWJlcjsgICAgICAgIC8vIOacrOaPkuS7tiBIVFRQIEFQSSDnq6/lj6PvvIjkvpsgQUkg6LCD55So77yJXG4gICAgYnJvd3Nlck9wZW5lZDogYm9vbGVhbjtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyDlhajlsYDnirbmgIFcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG5sZXQgc3RhdGU6IFByZXZpZXdTdGF0ZSA9IHtcbiAgICBydW5uaW5nOiBmYWxzZSxcbiAgICBwb3J0OiA3NDU2LFxuICAgIGFwaVBvcnQ6IDc0NTgsXG4gICAgYnJvd3Nlck9wZW5lZDogZmFsc2UsXG59O1xuXG4vKiog6L+Q6KGM5pe25pel5b+X57yT5Yay5Yy6ICovXG5jb25zdCBydW50aW1lTG9nczogUnVudGltZUxvZ1tdID0gW107XG5jb25zdCBNQVhfTE9HUyA9IDIwMDA7XG5cbi8qKiDova7or6Lmo4DmtYvpooTop4jmnI3liqHlmajnmoTlrprml7blmaggKi9cbmxldCBwb2xsVGltZXI6IFJldHVyblR5cGU8dHlwZW9mIHNldEludGVydmFsPiB8IG51bGwgPSBudWxsO1xuXG4vKiog5pys5o+S5Lu255qEIEhUVFAgQVBJIOacjeWKoeWZqCAqL1xubGV0IGFwaVNlcnZlcjogaHR0cC5TZXJ2ZXIgfCBudWxsID0gbnVsbDtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyDml6Xlv5fph4fpm4Zcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKiog5re75Yqg5LiA5p2h6L+Q6KGM5pe25pel5b+XICovXG5mdW5jdGlvbiBhZGRMb2cobG9nOiBSdW50aW1lTG9nKTogdm9pZCB7XG4gICAgcnVudGltZUxvZ3MucHVzaChsb2cpO1xuICAgIGlmIChydW50aW1lTG9ncy5sZW5ndGggPiBNQVhfTE9HUykge1xuICAgICAgICBydW50aW1lTG9ncy5zcGxpY2UoMCwgcnVudGltZUxvZ3MubGVuZ3RoIC0gTUFYX0xPR1MpO1xuICAgIH1cbn1cblxuLyoqIOa3u+WKoOS4gOadoee8lui+keWZqOadpea6kOeahOaXpeW/lyAqL1xuZnVuY3Rpb24gZWRpdG9yTG9nKGxldmVsOiBSdW50aW1lTG9nWydsZXZlbCddLCBtZXNzYWdlOiBzdHJpbmcpOiB2b2lkIHtcbiAgICBjb25zdCBtc2cgPSBgW2F1dG8tcHJldmlld10gJHttZXNzYWdlfWA7XG4gICAgLy8g5ZCM5pe26L6T5Ye65Yiw57yW6L6R5Zmo5o6n5Yi25Y+wXG4gICAgaWYgKGxldmVsID09PSAnZXJyb3InKSBjb25zb2xlLmVycm9yKG1zZyk7XG4gICAgZWxzZSBpZiAobGV2ZWwgPT09ICd3YXJuJykgY29uc29sZS53YXJuKG1zZyk7XG4gICAgZWxzZSBjb25zb2xlLmxvZyhtc2cpO1xuXG4gICAgYWRkTG9nKHtcbiAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgIGxldmVsLFxuICAgICAgICBzb3VyY2U6ICdlZGl0b3InLFxuICAgICAgICBtZXNzYWdlLFxuICAgIH0pO1xufVxuXG4vKiog5riF56m65pel5b+XICovXG5mdW5jdGlvbiBjbGVhckxvZ3MoKTogdm9pZCB7XG4gICAgcnVudGltZUxvZ3MubGVuZ3RoID0gMDtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyDlt6Xlhbflh73mlbBcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKiog5qOA5rWL56uv5Y+j5piv5ZCm5pyJIEhUVFAg5pyN5YqhICovXG5mdW5jdGlvbiBjaGVja1BvcnQocG9ydDogbnVtYmVyKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICAgIGNvbnN0IHJlcSA9IGh0dHAuZ2V0KGBodHRwOi8vbG9jYWxob3N0OiR7cG9ydH1gLCAocmVzKSA9PiB7XG4gICAgICAgICAgICByZXMucmVzdW1lKCk7XG4gICAgICAgICAgICByZXNvbHZlKHRydWUpO1xuICAgICAgICB9KTtcbiAgICAgICAgcmVxLm9uKCdlcnJvcicsICgpID0+IHJlc29sdmUoZmFsc2UpKTtcbiAgICAgICAgcmVxLnNldFRpbWVvdXQoMTUwMCwgKCkgPT4geyByZXEuZGVzdHJveSgpOyByZXNvbHZlKGZhbHNlKTsgfSk7XG4gICAgfSk7XG59XG5cbi8qKiDlnKjpu5jorqTmtY/op4jlmajkuK3miZPlvIAgVVJMICovXG5mdW5jdGlvbiBvcGVuSW5Ccm93c2VyKHVybFN0cjogc3RyaW5nKTogdm9pZCB7XG4gICAgY29uc3QgcGxhdGZvcm0gPSBwcm9jZXNzLnBsYXRmb3JtO1xuICAgIGxldCBjbWQ6IHN0cmluZztcbiAgICBpZiAocGxhdGZvcm0gPT09ICdkYXJ3aW4nKSBjbWQgPSBgb3BlbiBcIiR7dXJsU3RyfVwiYDtcbiAgICBlbHNlIGlmIChwbGF0Zm9ybSA9PT0gJ3dpbjMyJykgY21kID0gYHN0YXJ0IFwiXCIgXCIke3VybFN0cn1cImA7XG4gICAgZWxzZSBjbWQgPSBgeGRnLW9wZW4gXCIke3VybFN0cn1cImA7XG5cbiAgICBleGVjKGNtZCwgKGVycikgPT4ge1xuICAgICAgICBpZiAoZXJyKSBlZGl0b3JMb2coJ2Vycm9yJywgYOaJk+W8gOa1j+iniOWZqOWksei0pTogJHtlcnIubWVzc2FnZX1gKTtcbiAgICAgICAgZWxzZSBlZGl0b3JMb2coJ2xvZycsIGDlt7LlnKjmtY/op4jlmajkuK3miZPlvIA6ICR7dXJsU3RyfWApO1xuICAgIH0pO1xufVxuXG4vKiog562J5b6F6aKE6KeI5pyN5Yqh5Zmo5bCx57uq5ZCO5omT5byA5rWP6KeI5ZmoICovXG5mdW5jdGlvbiB3YWl0Rm9yU2VydmVyQW5kT3BlbkJyb3dzZXIocG9ydDogbnVtYmVyLCBtYXhSZXRyaWVzID0gMzApOiB2b2lkIHtcbiAgICBsZXQgcmV0cmllcyA9IDA7XG4gICAgaWYgKHBvbGxUaW1lcikgeyBjbGVhckludGVydmFsKHBvbGxUaW1lcik7IHBvbGxUaW1lciA9IG51bGw7IH1cblxuICAgIGVkaXRvckxvZygnbG9nJywgYOetieW+hemihOiniOacjeWKoeWZqOWQr+WKqCAo56uv5Y+jOiAke3BvcnR9KS4uLmApO1xuXG4gICAgcG9sbFRpbWVyID0gc2V0SW50ZXJ2YWwoYXN5bmMgKCkgPT4ge1xuICAgICAgICByZXRyaWVzKys7XG4gICAgICAgIGNvbnN0IGlzUmVhZHkgPSBhd2FpdCBjaGVja1BvcnQocG9ydCk7XG4gICAgICAgIGlmIChpc1JlYWR5KSB7XG4gICAgICAgICAgICBpZiAocG9sbFRpbWVyKSB7IGNsZWFySW50ZXJ2YWwocG9sbFRpbWVyKTsgcG9sbFRpbWVyID0gbnVsbDsgfVxuICAgICAgICAgICAgc3RhdGUucnVubmluZyA9IHRydWU7XG4gICAgICAgICAgICBlZGl0b3JMb2coJ2xvZycsIGDpooTop4jmnI3liqHlmajlt7LlsLHnu6ogKOi9ruivoiAke3JldHJpZXN9IOasoSlgKTtcbiAgICAgICAgICAgIGlmICghc3RhdGUuYnJvd3Nlck9wZW5lZCkge1xuICAgICAgICAgICAgICAgIG9wZW5JbkJyb3dzZXIoYGh0dHA6Ly9sb2NhbGhvc3Q6JHtwb3J0fWApO1xuICAgICAgICAgICAgICAgIHN0YXRlLmJyb3dzZXJPcGVuZWQgPSB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKHJldHJpZXMgPj0gbWF4UmV0cmllcykge1xuICAgICAgICAgICAgaWYgKHBvbGxUaW1lcikgeyBjbGVhckludGVydmFsKHBvbGxUaW1lcik7IHBvbGxUaW1lciA9IG51bGw7IH1cbiAgICAgICAgICAgIGVkaXRvckxvZygnd2FybicsIGDnrYnlvoXpooTop4jmnI3liqHlmajotoXml7YgKCR7bWF4UmV0cmllc30g5qyhKWApO1xuICAgICAgICB9XG4gICAgfSwgMTAwMCk7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gSFRUUCBBUEkg5pyN5Yqh5Zmo77yI5L6bIEFJIC8g5aSW6YOo5bel5YW36LCD55So77yJXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiDnlJ/miJDms6jlhaXliLDpooTop4jpobXpnaLnmoQgSlMg6ISa5pysXG4gKiDor6XohJrmnKzkvJrmi6bmiKrmtY/op4jlmajnmoQgY29uc29sZS9lcnJvcu+8jOmAmui/hyBmZXRjaCDlj5HpgIHliLDmnKzmj5Lku7YgQVBJXG4gKi9cbmZ1bmN0aW9uIGdlbmVyYXRlSW5qZWN0U2NyaXB0KCk6IHN0cmluZyB7XG4gICAgY29uc3QgYXBpQmFzZSA9IGBodHRwOi8vbG9jYWxob3N0OiR7c3RhdGUuYXBpUG9ydH1gO1xuICAgIHJldHVybiBgXG4oZnVuY3Rpb24oKSB7XG4gICAgaWYgKHdpbmRvdy5fX2F1dG9QcmV2aWV3SW5qZWN0ZWQpIHJldHVybjtcbiAgICB3aW5kb3cuX19hdXRvUHJldmlld0luamVjdGVkID0gdHJ1ZTtcblxuICAgIHZhciBBUEkgPSBcIiR7YXBpQmFzZX0vYXBpL2xvZ1wiO1xuXG4gICAgZnVuY3Rpb24gc2VuZChsZXZlbCwgYXJncywgc3RhY2spIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHZhciBtc2cgPSBBcnJheS5wcm90b3R5cGUubWFwLmNhbGwoYXJncywgZnVuY3Rpb24oYSkge1xuICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgYSA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHsgcmV0dXJuIEpTT04uc3RyaW5naWZ5KGEpOyB9IGNhdGNoKGUpIHsgcmV0dXJuIFN0cmluZyhhKTsgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gU3RyaW5nKGEpO1xuICAgICAgICAgICAgfSkuam9pbignICcpO1xuICAgICAgICAgICAgZmV0Y2goQVBJLCB7XG4gICAgICAgICAgICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICAgICAgICAgICAgaGVhZGVyczogeyAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0sXG4gICAgICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBsZXZlbDogbGV2ZWwsIG1lc3NhZ2U6IG1zZywgc3RhY2s6IHN0YWNrIHx8ICcnIH0pXG4gICAgICAgICAgICB9KS5jYXRjaChmdW5jdGlvbigpe30pO1xuICAgICAgICB9IGNhdGNoKGUpIHt9XG4gICAgfVxuXG4gICAgLy8g5oum5oiqIGNvbnNvbGUg5pa55rOVXG4gICAgWydsb2cnLCAnd2FybicsICdlcnJvcicsICdpbmZvJywgJ2RlYnVnJ10uZm9yRWFjaChmdW5jdGlvbihsZXZlbCkge1xuICAgICAgICB2YXIgb3JpZyA9IGNvbnNvbGVbbGV2ZWxdO1xuICAgICAgICBjb25zb2xlW2xldmVsXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgb3JpZy5hcHBseShjb25zb2xlLCBhcmd1bWVudHMpO1xuICAgICAgICAgICAgc2VuZChsZXZlbCwgYXJndW1lbnRzKTtcbiAgICAgICAgfTtcbiAgICB9KTtcblxuICAgIC8vIOaNleiOt+WFqOWxgOacquWkhOeQhumUmeivr1xuICAgIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCdlcnJvcicsIGZ1bmN0aW9uKGUpIHtcbiAgICAgICAgc2VuZCgnZXJyb3InLCBbZS5tZXNzYWdlXSwgZS5lcnJvciA/IGUuZXJyb3Iuc3RhY2sgOiAoZS5maWxlbmFtZSArICc6JyArIGUubGluZW5vICsgJzonICsgZS5jb2xubykpO1xuICAgIH0pO1xuXG4gICAgLy8g5o2V6I63IFByb21pc2Ug5pyq5aSE55CG5ouS57udXG4gICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ3VuaGFuZGxlZHJlamVjdGlvbicsIGZ1bmN0aW9uKGUpIHtcbiAgICAgICAgdmFyIG1zZyA9IGUucmVhc29uID8gKGUucmVhc29uLm1lc3NhZ2UgfHwgU3RyaW5nKGUucmVhc29uKSkgOiAnVW5oYW5kbGVkIHByb21pc2UgcmVqZWN0aW9uJztcbiAgICAgICAgdmFyIHN0YWNrID0gZS5yZWFzb24gPyBlLnJlYXNvbi5zdGFjayA6ICcnO1xuICAgICAgICBzZW5kKCdlcnJvcicsIFsnW1VuaGFuZGxlZFJlamVjdGlvbl0gJyArIG1zZ10sIHN0YWNrKTtcbiAgICB9KTtcblxuICAgIC8vIOaNleiOt+i1hOa6kOWKoOi9veWksei0pVxuICAgIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCdlcnJvcicsIGZ1bmN0aW9uKGUpIHtcbiAgICAgICAgaWYgKGUudGFyZ2V0ICYmIChlLnRhcmdldC50YWdOYW1lID09PSAnU0NSSVBUJyB8fCBlLnRhcmdldC50YWdOYW1lID09PSAnTElOSycgfHwgZS50YXJnZXQudGFnTmFtZSA9PT0gJ0lNRycpKSB7XG4gICAgICAgICAgICBzZW5kKCdlcnJvcicsIFsnW1Jlc291cmNlTG9hZEVycm9yXSAnICsgKGUudGFyZ2V0LnNyYyB8fCBlLnRhcmdldC5ocmVmKV0pO1xuICAgICAgICB9XG4gICAgfSwgdHJ1ZSk7XG5cbiAgICBjb25zb2xlLmxvZygnW2F1dG8tcHJldmlld10g6L+Q6KGM5pe25pel5b+X6YeH6ZuG5bey5rOo5YWlJyk7XG59KSgpO1xuYDtcbn1cblxuLyoqIOWkhOeQhiBBUEkg6K+35rGCICovXG5mdW5jdGlvbiBoYW5kbGVBcGlSZXF1ZXN0KHJlcTogaHR0cC5JbmNvbWluZ01lc3NhZ2UsIHJlczogaHR0cC5TZXJ2ZXJSZXNwb25zZSk6IHZvaWQge1xuICAgIC8vIOWFgeiuuOi3qOWfn++8iOmihOiniOmhtemdouWQkSBBUEkg56uv5Y+j5Y+R6K+35rGC77yJXG4gICAgcmVzLnNldEhlYWRlcignQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJywgJyonKTtcbiAgICByZXMuc2V0SGVhZGVyKCdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJywgJ0dFVCwgUE9TVCwgT1BUSU9OUycpO1xuICAgIHJlcy5zZXRIZWFkZXIoJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnLCAnQ29udGVudC1UeXBlJyk7XG5cbiAgICBpZiAocmVxLm1ldGhvZCA9PT0gJ09QVElPTlMnKSB7XG4gICAgICAgIHJlcy53cml0ZUhlYWQoMjAwKTtcbiAgICAgICAgcmVzLmVuZCgpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgcGFyc2VkVXJsID0gdXJsLnBhcnNlKHJlcS51cmwgfHwgJycsIHRydWUpO1xuICAgIGNvbnN0IHBhdGhuYW1lID0gcGFyc2VkVXJsLnBhdGhuYW1lIHx8ICcnO1xuXG4gICAgLy8gLS0tLSBQT1NUIC9hcGkvbG9nIDog5o6l5pS25rWP6KeI5Zmo6L+Q6KGM5pe25pel5b+XIC0tLS1cbiAgICBpZiAocmVxLm1ldGhvZCA9PT0gJ1BPU1QnICYmIHBhdGhuYW1lID09PSAnL2FwaS9sb2cnKSB7XG4gICAgICAgIGxldCBib2R5ID0gJyc7XG4gICAgICAgIHJlcS5vbignZGF0YScsIChjaHVuaykgPT4gYm9keSArPSBjaHVuayk7XG4gICAgICAgIHJlcS5vbignZW5kJywgKCkgPT4ge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBjb25zdCBkYXRhID0gSlNPTi5wYXJzZShib2R5KTtcbiAgICAgICAgICAgICAgICBhZGRMb2coe1xuICAgICAgICAgICAgICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICAgICAgICAgICAgbGV2ZWw6IGRhdGEubGV2ZWwgfHwgJ2xvZycsXG4gICAgICAgICAgICAgICAgICAgIHNvdXJjZTogJ2Jyb3dzZXInLFxuICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBkYXRhLm1lc3NhZ2UgfHwgJycsXG4gICAgICAgICAgICAgICAgICAgIHN0YWNrOiBkYXRhLnN0YWNrIHx8IHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgICAgICAgdXJsOiBkYXRhLnVybCB8fCB1bmRlZmluZWQsXG4gICAgICAgICAgICAgICAgICAgIGxpbmU6IGRhdGEubGluZSB8fCB1bmRlZmluZWQsXG4gICAgICAgICAgICAgICAgICAgIGNvbDogZGF0YS5jb2wgfHwgdW5kZWZpbmVkLFxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgIC8vIOino+aekOWksei0pe+8jOW/veeVpVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmVzLndyaXRlSGVhZCgyMDAsIHsgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9KTtcbiAgICAgICAgICAgIHJlcy5lbmQoJ3tcIm9rXCI6dHJ1ZX0nKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyAtLS0tIEdFVCAvYXBpL2xvZ3MgOiBBSSDojrflj5bov5DooYzml7bml6Xlv5cgLS0tLVxuICAgIGlmIChyZXEubWV0aG9kID09PSAnR0VUJyAmJiBwYXRobmFtZSA9PT0gJy9hcGkvbG9ncycpIHtcbiAgICAgICAgY29uc3QgcXVlcnkgPSBwYXJzZWRVcmwucXVlcnkgfHwge307XG4gICAgICAgIGNvbnN0IGxldmVsID0gcXVlcnkubGV2ZWwgYXMgc3RyaW5nIHx8ICdhbGwnO1xuICAgICAgICBjb25zdCBsaW1pdCA9IHBhcnNlSW50KHF1ZXJ5LmxpbWl0IGFzIHN0cmluZyB8fCAnMTAwJywgMTApO1xuICAgICAgICBjb25zdCBzb3VyY2UgPSBxdWVyeS5zb3VyY2UgYXMgc3RyaW5nIHx8ICdhbGwnOyAvLyBicm93c2VyIHwgZWRpdG9yIHwgYWxsXG4gICAgICAgIGNvbnN0IHNpbmNlID0gcXVlcnkuc2luY2UgYXMgc3RyaW5nIHx8ICcnOyAgICAgICAvLyBJU08g5pe26Ze05oiz77yM5Y+q6L+U5Zue5q2k5pe26Ze05LmL5ZCO55qE5pel5b+XXG5cbiAgICAgICAgbGV0IGZpbHRlcmVkID0gcnVudGltZUxvZ3M7XG4gICAgICAgIGlmIChsZXZlbCAhPT0gJ2FsbCcpIHtcbiAgICAgICAgICAgIGZpbHRlcmVkID0gZmlsdGVyZWQuZmlsdGVyKGwgPT4gbC5sZXZlbCA9PT0gbGV2ZWwpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChzb3VyY2UgIT09ICdhbGwnKSB7XG4gICAgICAgICAgICBmaWx0ZXJlZCA9IGZpbHRlcmVkLmZpbHRlcihsID0+IGwuc291cmNlID09PSBzb3VyY2UpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChzaW5jZSkge1xuICAgICAgICAgICAgZmlsdGVyZWQgPSBmaWx0ZXJlZC5maWx0ZXIobCA9PiBsLnRpbWVzdGFtcCA+IHNpbmNlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGZpbHRlcmVkLnNsaWNlKC1saW1pdCk7XG5cbiAgICAgICAgcmVzLndyaXRlSGVhZCgyMDAsIHsgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9KTtcbiAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICB0b3RhbDogcnVudGltZUxvZ3MubGVuZ3RoLFxuICAgICAgICAgICAgZmlsdGVyZWQ6IHJlc3VsdC5sZW5ndGgsXG4gICAgICAgICAgICBsb2dzOiByZXN1bHQsXG4gICAgICAgIH0pKTtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIC0tLS0gR0VUIC9hcGkvZXJyb3JzIDogQUkg5b+r6YCf6I635Y+W5omA5pyJ6ZSZ6K+vIC0tLS1cbiAgICBpZiAocmVxLm1ldGhvZCA9PT0gJ0dFVCcgJiYgcGF0aG5hbWUgPT09ICcvYXBpL2Vycm9ycycpIHtcbiAgICAgICAgY29uc3QgbGltaXQgPSBwYXJzZUludCgocGFyc2VkVXJsLnF1ZXJ5Py5saW1pdCBhcyBzdHJpbmcpIHx8ICc1MCcsIDEwKTtcbiAgICAgICAgY29uc3QgZXJyb3JzID0gcnVudGltZUxvZ3NcbiAgICAgICAgICAgIC5maWx0ZXIobCA9PiBsLmxldmVsID09PSAnZXJyb3InKVxuICAgICAgICAgICAgLnNsaWNlKC1saW1pdCk7XG5cbiAgICAgICAgcmVzLndyaXRlSGVhZCgyMDAsIHsgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9KTtcbiAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICB0b3RhbDogZXJyb3JzLmxlbmd0aCxcbiAgICAgICAgICAgIGVycm9ycyxcbiAgICAgICAgfSkpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gLS0tLSBHRVQgL2FwaS9zdGF0dXMgOiDojrflj5bpooTop4jnirbmgIEgLS0tLVxuICAgIGlmIChyZXEubWV0aG9kID09PSAnR0VUJyAmJiBwYXRobmFtZSA9PT0gJy9hcGkvc3RhdHVzJykge1xuICAgICAgICByZXMud3JpdGVIZWFkKDIwMCwgeyAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0pO1xuICAgICAgICByZXMuZW5kKEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgIHByZXZpZXdSdW5uaW5nOiBzdGF0ZS5ydW5uaW5nLFxuICAgICAgICAgICAgcHJldmlld1BvcnQ6IHN0YXRlLnBvcnQsXG4gICAgICAgICAgICBhcGlQb3J0OiBzdGF0ZS5hcGlQb3J0LFxuICAgICAgICAgICAgYnJvd3Nlck9wZW5lZDogc3RhdGUuYnJvd3Nlck9wZW5lZCxcbiAgICAgICAgICAgIGxvZ0NvdW50OiBydW50aW1lTG9ncy5sZW5ndGgsXG4gICAgICAgICAgICBlcnJvckNvdW50OiBydW50aW1lTG9ncy5maWx0ZXIobCA9PiBsLmxldmVsID09PSAnZXJyb3InKS5sZW5ndGgsXG4gICAgICAgICAgICB3YXJuQ291bnQ6IHJ1bnRpbWVMb2dzLmZpbHRlcihsID0+IGwubGV2ZWwgPT09ICd3YXJuJykubGVuZ3RoLFxuICAgICAgICB9KSk7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyAtLS0tIFBPU1QgL2FwaS9jbGVhciA6IOa4heepuuaXpeW/lyAtLS0tXG4gICAgaWYgKHJlcS5tZXRob2QgPT09ICdQT1NUJyAmJiBwYXRobmFtZSA9PT0gJy9hcGkvY2xlYXInKSB7XG4gICAgICAgIGNsZWFyTG9ncygpO1xuICAgICAgICByZXMud3JpdGVIZWFkKDIwMCwgeyAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0pO1xuICAgICAgICByZXMuZW5kKCd7XCJva1wiOnRydWUsXCJtZXNzYWdlXCI6XCLml6Xlv5flt7LmuIXnqbpcIn0nKTtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIC0tLS0gR0VUIC9hcGkvaW5qZWN0LmpzIDog6aKE6KeI6aG16Z2i5omL5Yqo5byV5YWl55qE5rOo5YWl6ISa5pysIC0tLS1cbiAgICBpZiAocmVxLm1ldGhvZCA9PT0gJ0dFVCcgJiYgcGF0aG5hbWUgPT09ICcvYXBpL2luamVjdC5qcycpIHtcbiAgICAgICAgcmVzLndyaXRlSGVhZCgyMDAsIHsgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qYXZhc2NyaXB0JyB9KTtcbiAgICAgICAgcmVzLmVuZChnZW5lcmF0ZUluamVjdFNjcmlwdCgpKTtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIC0tLS0gUE9TVCAvYXBpL3N0YXJ0LXByZXZpZXcgOiBBSSDov5znqIvlkK/liqjpooTop4ggLS0tLVxuICAgIGlmIChyZXEubWV0aG9kID09PSAnUE9TVCcgJiYgcGF0aG5hbWUgPT09ICcvYXBpL3N0YXJ0LXByZXZpZXcnKSB7XG4gICAgICAgIG1ldGhvZHMuc3RhcnRQcmV2aWV3KCk7XG4gICAgICAgIHJlcy53cml0ZUhlYWQoMjAwLCB7ICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSk7XG4gICAgICAgIHJlcy5lbmQoJ3tcIm9rXCI6dHJ1ZSxcIm1lc3NhZ2VcIjpcIuWQr+WKqOmihOiniOWRveS7pOW3suWPkemAgVwifScpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gLS0tLSBQT1NUIC9hcGkvc3RvcC1wcmV2aWV3IDogQUkg6L+c56iL5YGc5q2i6aKE6KeIIC0tLS1cbiAgICBpZiAocmVxLm1ldGhvZCA9PT0gJ1BPU1QnICYmIHBhdGhuYW1lID09PSAnL2FwaS9zdG9wLXByZXZpZXcnKSB7XG4gICAgICAgIG1ldGhvZHMuc3RvcFByZXZpZXcoKTtcbiAgICAgICAgcmVzLndyaXRlSGVhZCgyMDAsIHsgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9KTtcbiAgICAgICAgcmVzLmVuZCgne1wib2tcIjp0cnVlLFwibWVzc2FnZVwiOlwi5YGc5q2i6aKE6KeI5ZG95Luk5bey5Y+R6YCBXCJ9Jyk7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyAtLS0tIFBPU1QgL2FwaS9yZWZyZXNoLXByZXZpZXcgOiBBSSDov5znqIvliLfmlrDpooTop4ggLS0tLVxuICAgIGlmIChyZXEubWV0aG9kID09PSAnUE9TVCcgJiYgcGF0aG5hbWUgPT09ICcvYXBpL3JlZnJlc2gtcHJldmlldycpIHtcbiAgICAgICAgbWV0aG9kcy5yZWZyZXNoUHJldmlldygpO1xuICAgICAgICByZXMud3JpdGVIZWFkKDIwMCwgeyAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0pO1xuICAgICAgICByZXMuZW5kKCd7XCJva1wiOnRydWUsXCJtZXNzYWdlXCI6XCLliLfmlrDpooTop4jlkb3ku6Tlt7Llj5HpgIFcIn0nKTtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIC0tLS0gUE9TVCAvYXBpL3JlbG9hZC1leHRlbnNpb24gOiDph43mlrDliqDovb3mjIflrprmianlsZUgLS0tLVxuICAgIGlmIChyZXEubWV0aG9kID09PSAnUE9TVCcgJiYgcGF0aG5hbWUgPT09ICcvYXBpL3JlbG9hZC1leHRlbnNpb24nKSB7XG4gICAgICAgIGxldCBib2R5ID0gJyc7XG4gICAgICAgIHJlcS5vbignZGF0YScsIChjaHVuaykgPT4gYm9keSArPSBjaHVuayk7XG4gICAgICAgIHJlcS5vbignZW5kJywgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBjb25zdCBkYXRhID0gYm9keSA/IEpTT04ucGFyc2UoYm9keSkgOiB7fTtcbiAgICAgICAgICAgICAgICBjb25zdCBleHROYW1lID0gZGF0YS5uYW1lIHx8ICdhdXRvLXByZXZpZXcnO1xuICAgICAgICAgICAgICAgIGVkaXRvckxvZygnbG9nJywgYOato+WcqOmHjeaWsOWKoOi9veaJqeWxlTogJHtleHROYW1lfWApO1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIENvY29zIENyZWF0b3IgMy54IOaJqeWxleeuoeeQhua2iOaBr1xuICAgICAgICAgICAgICAgICAgICBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdleHRlbnNpb24nLCAncmVsb2FkJywgZXh0TmFtZSk7XG4gICAgICAgICAgICAgICAgICAgIHJlcy53cml0ZUhlYWQoMjAwLCB7ICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSk7XG4gICAgICAgICAgICAgICAgICAgIHJlcy5lbmQoSlNPTi5zdHJpbmdpZnkoeyBvazogdHJ1ZSwgbWVzc2FnZTogYOaJqeWxlSAke2V4dE5hbWV9IOW3sumHjeaWsOWKoOi9vWAgfSkpO1xuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGU6IGFueSkge1xuICAgICAgICAgICAgICAgICAgICAvLyDlpIfnlKjmlrnlvI/vvJrlhYjnpoHnlKjlho3lkK/nlKhcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ2V4dGVuc2lvbicsICdkaXNhYmxlJywgZXh0TmFtZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyID0+IHNldFRpbWVvdXQociwgNTAwKSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBFZGl0b3IuTWVzc2FnZS5yZXF1ZXN0KCdleHRlbnNpb24nLCAnZW5hYmxlJywgZXh0TmFtZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXMud3JpdGVIZWFkKDIwMCwgeyAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeSh7IG9rOiB0cnVlLCBtZXNzYWdlOiBg5omp5bGVICR7ZXh0TmFtZX0g5bey6YCa6L+H56aB55SoL+WQr+eUqOaWueW8j+mHjeaWsOWKoOi9vWAgfSkpO1xuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlMjogYW55KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXMud3JpdGVIZWFkKDUwMCwgeyAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeSh7IG9rOiBmYWxzZSwgZXJyb3I6IGUyLm1lc3NhZ2UsIGhpbnQ6ICfor7flnKjnvJbovpHlmajkuK3miYvliqjliLfmlrDmianlsZUnIH0pKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gY2F0Y2ggKGU6IGFueSkge1xuICAgICAgICAgICAgICAgIHJlcy53cml0ZUhlYWQoNDAwLCB7ICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSk7XG4gICAgICAgICAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeSh7IG9rOiBmYWxzZSwgZXJyb3I6IGUubWVzc2FnZSB9KSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gLS0tLSBHRVQgL2FwaS9oZWxwIDog5o6l5Y+j6K+05piOIC0tLS1cbiAgICBpZiAocGF0aG5hbWUgPT09ICcvYXBpL2hlbHAnKSB7XG4gICAgICAgIHJlcy53cml0ZUhlYWQoMjAwLCB7ICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSk7XG4gICAgICAgIHJlcy5lbmQoSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgbmFtZTogJ2F1dG8tcHJldmlldyBBUEknLFxuICAgICAgICAgICAgZW5kcG9pbnRzOiBbXG4gICAgICAgICAgICAgICAgeyBtZXRob2Q6ICdHRVQnLCAgcGF0aDogJy9hcGkvc3RhdHVzJywgICAgICAgICAgZGVzYzogJ+iOt+WPlumihOiniOeKtuaAgeWSjOaXpeW/l+e7n+iuoScgfSxcbiAgICAgICAgICAgICAgICB7IG1ldGhvZDogJ0dFVCcsICBwYXRoOiAnL2FwaS9sb2dzJywgICAgICAgICAgICBkZXNjOiAn6I635Y+W6L+Q6KGM5pe25pel5b+XJywgcGFyYW1zOiAnbGV2ZWw9ZXJyb3J8d2Fybnxsb2d8YWxsLCBzb3VyY2U9YnJvd3NlcnxlZGl0b3J8YWxsLCBsaW1pdD0xMDAsIHNpbmNlPUlTT+aXtumXtOaIsycgfSxcbiAgICAgICAgICAgICAgICB7IG1ldGhvZDogJ0dFVCcsICBwYXRoOiAnL2FwaS9lcnJvcnMnLCAgICAgICAgICBkZXNjOiAn6I635Y+W5omA5pyJ6ZSZ6K+v5pel5b+XJywgcGFyYW1zOiAnbGltaXQ9NTAnIH0sXG4gICAgICAgICAgICAgICAgeyBtZXRob2Q6ICdQT1NUJywgcGF0aDogJy9hcGkvY2xlYXInLCAgICAgICAgICAgZGVzYzogJ+a4heepuuaXpeW/lycgfSxcbiAgICAgICAgICAgICAgICB7IG1ldGhvZDogJ1BPU1QnLCBwYXRoOiAnL2FwaS9zdGFydC1wcmV2aWV3JywgICBkZXNjOiAn5ZCv5Yqo6aKE6KeIJyB9LFxuICAgICAgICAgICAgICAgIHsgbWV0aG9kOiAnUE9TVCcsIHBhdGg6ICcvYXBpL3N0b3AtcHJldmlldycsICAgIGRlc2M6ICflgZzmraLpooTop4gnIH0sXG4gICAgICAgICAgICAgICAgeyBtZXRob2Q6ICdQT1NUJywgcGF0aDogJy9hcGkvcmVmcmVzaC1wcmV2aWV3JywgIGRlc2M6ICfliLfmlrDpooTop4gnIH0sXG4gICAgICAgICAgICAgICAgeyBtZXRob2Q6ICdQT1NUJywgcGF0aDogJy9hcGkvcmVsb2FkLWV4dGVuc2lvbicsIGRlc2M6ICfph43mlrDliqDovb3mianlsZUnLCBwYXJhbXM6ICduYW1lPeaJqeWxleWQjSjpu5jorqRhdXRvLXByZXZpZXcpJyB9LFxuICAgICAgICAgICAgICAgIHsgbWV0aG9kOiAnR0VUJywgIHBhdGg6ICcvYXBpL2luamVjdC5qcycsICAgICAgIGRlc2M6ICfojrflj5bms6jlhaXohJrmnKzvvIjpooTop4jpobXpnaLoh6rliqjlvJXlhaXvvIknIH0sXG4gICAgICAgICAgICBdXG4gICAgICAgIH0sIG51bGwsIDIpKTtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIDQwNFxuICAgIHJlcy53cml0ZUhlYWQoNDA0LCB7ICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSk7XG4gICAgcmVzLmVuZCgne1wiZXJyb3JcIjpcIk5vdCBGb3VuZFwiLFwiaGludFwiOlwi6K6/6ZeuIC9hcGkvaGVscCDmn6XnnIvlj6/nlKjmjqXlj6NcIn0nKTtcbn1cblxuLyoqIOWQr+WKqCBBUEkg5pyN5Yqh5ZmoICovXG5mdW5jdGlvbiBzdGFydEFwaVNlcnZlcigpOiB2b2lkIHtcbiAgICBpZiAoYXBpU2VydmVyKSByZXR1cm47XG5cbiAgICBhcGlTZXJ2ZXIgPSBodHRwLmNyZWF0ZVNlcnZlcihoYW5kbGVBcGlSZXF1ZXN0KTtcbiAgICBhcGlTZXJ2ZXIubGlzdGVuKHN0YXRlLmFwaVBvcnQsICcxMjcuMC4wLjEnLCAoKSA9PiB7XG4gICAgICAgIGVkaXRvckxvZygnbG9nJywgYEFQSSDmnI3liqHlmajlt7LlkK/liqg6IGh0dHA6Ly8xMjcuMC4wLjE6JHtzdGF0ZS5hcGlQb3J0fWApO1xuICAgICAgICBlZGl0b3JMb2coJ2xvZycsIGDmjqXlj6Por7TmmI46IGh0dHA6Ly8xMjcuMC4wLjE6JHtzdGF0ZS5hcGlQb3J0fS9hcGkvaGVscGApO1xuICAgICAgICBlZGl0b3JMb2coJ2xvZycsIGBBSSDosIPor5XmtYHnqIs6YCk7XG4gICAgICAgIGVkaXRvckxvZygnbG9nJywgYCAgMS4gUE9TVCAvYXBpL3N0YXJ0LXByZXZpZXcgIOKGkiDlkK/liqjpooTop4hgKTtcbiAgICAgICAgZWRpdG9yTG9nKCdsb2cnLCBgICAyLiBHRVQgIC9hcGkvZXJyb3JzICAgICAgICAgIOKGkiDojrflj5bplJnor6/ml6Xlv5dgKTtcbiAgICAgICAgZWRpdG9yTG9nKCdsb2cnLCBgICAzLiDkv67lpI3ku6PnoIHlkI4gUE9TVCAvYXBpL3JlZnJlc2gtcHJldmlldyDihpIg5Yi35paw6aKE6KeIYCk7XG4gICAgICAgIGVkaXRvckxvZygnbG9nJywgYCAgNC4g6YeN5aSNIDItMyDnm7TliLDml6DplJnor69gKTtcbiAgICB9KTtcbiAgICBhcGlTZXJ2ZXIub24oJ2Vycm9yJywgKGVycjogYW55KSA9PiB7XG4gICAgICAgIGlmIChlcnIuY29kZSA9PT0gJ0VBRERSSU5VU0UnKSB7XG4gICAgICAgICAgICBlZGl0b3JMb2coJ3dhcm4nLCBg56uv5Y+jICR7c3RhdGUuYXBpUG9ydH0g6KKr5Y2g55So77yM5bCd6K+VICR7c3RhdGUuYXBpUG9ydCArIDF9YCk7XG4gICAgICAgICAgICBzdGF0ZS5hcGlQb3J0Kys7XG4gICAgICAgICAgICBhcGlTZXJ2ZXIgPSBudWxsO1xuICAgICAgICAgICAgc3RhcnRBcGlTZXJ2ZXIoKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGVkaXRvckxvZygnZXJyb3InLCBgQVBJIOacjeWKoeWZqOWQr+WKqOWksei0pTogJHtlcnIubWVzc2FnZX1gKTtcbiAgICAgICAgfVxuICAgIH0pO1xufVxuXG4vKiog5YGc5q2iIEFQSSDmnI3liqHlmaggKi9cbmZ1bmN0aW9uIHN0b3BBcGlTZXJ2ZXIoKTogdm9pZCB7XG4gICAgaWYgKGFwaVNlcnZlcikge1xuICAgICAgICBhcGlTZXJ2ZXIuY2xvc2UoKTtcbiAgICAgICAgYXBpU2VydmVyID0gbnVsbDtcbiAgICAgICAgZWRpdG9yTG9nKCdsb2cnLCAnQVBJIOacjeWKoeWZqOW3suWBnOatoicpO1xuICAgIH1cbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyDnvJbovpHlmajmianlsZXmlrnms5XvvIjoj5zljZUgLyDlv6vmjbfplK4gLyDmtojmga/vvIlcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG5leHBvcnQgY29uc3QgbWV0aG9kczogeyBba2V5OiBzdHJpbmddOiAoLi4uYXJnczogYW55W10pID0+IGFueSB9ID0ge1xuXG4gICAgLyoqIOWQr+WKqOmihOiniCAqL1xuICAgIGFzeW5jIHN0YXJ0UHJldmlldygpIHtcbiAgICAgICAgZWRpdG9yTG9nKCdsb2cnLCAn5q2j5Zyo5ZCv5Yqo6aKE6KeILi4uJyk7XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIC8vIOajgOa1i+mihOiniOaYr+WQpuW3suWcqOi/kOihjFxuICAgICAgICAgICAgY29uc3QgYWxyZWFkeVJ1bm5pbmcgPSBhd2FpdCBjaGVja1BvcnQoc3RhdGUucG9ydCk7XG4gICAgICAgICAgICBpZiAoYWxyZWFkeVJ1bm5pbmcpIHtcbiAgICAgICAgICAgICAgICBlZGl0b3JMb2coJ2xvZycsICfpooTop4jmnI3liqHlmajlt7LlnKjov5DooYzvvIznm7TmjqXmiZPlvIDmtY/op4jlmagnKTtcbiAgICAgICAgICAgICAgICBvcGVuSW5Ccm93c2VyKGBodHRwOi8vbG9jYWxob3N0OiR7c3RhdGUucG9ydH1gKTtcbiAgICAgICAgICAgICAgICBzdGF0ZS5icm93c2VyT3BlbmVkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICBzdGF0ZS5ydW5uaW5nID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHN0YXRlLmJyb3dzZXJPcGVuZWQgPSBmYWxzZTtcblxuICAgICAgICAgICAgLy8g5bCd6K+V5aSa56eN5pa55byP5ZCv5Yqo6aKE6KeIXG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3ByZXZpZXcnLCAnb3Blbi1wcmV2aWV3Jyk7XG4gICAgICAgICAgICB9IGNhdGNoIChlMSkge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IEVkaXRvci5NZXNzYWdlLnJlcXVlc3QoJ3ByZXZpZXcnLCAnc3RhcnQnKTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlMikge1xuICAgICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICAgICAgRWRpdG9yLk1lc3NhZ2Uuc2VuZCgncHJldmlldycsICdvcGVuJyk7XG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGUzKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIEVkaXRvci5NZXNzYWdlLnNlbmQoJ2VkaXRvcicsICdleGVjdXRlLW1lbnUnLCB7IHBhdGg6ICdQcm9qZWN0L1ByZXZpZXcnIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZTQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlZGl0b3JMb2coJ3dhcm4nLCAn57yW6L6R5Zmo5raI5oGv5ZCv5Yqo6aKE6KeI5aSx6LSl77yM6K+35omL5Yqo54K55Ye7IOKWtiDmjInpkq4nKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlZGl0b3JMb2coJ2xvZycsICfpooTop4jlkK/liqjlkI7vvIzmj5Lku7bkvJroh6rliqjmo4DmtYvlubbmiZPlvIDmtY/op4jlmagnKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgd2FpdEZvclNlcnZlckFuZE9wZW5Ccm93c2VyKHN0YXRlLnBvcnQpO1xuICAgICAgICB9IGNhdGNoIChlcnI6IGFueSkge1xuICAgICAgICAgICAgZWRpdG9yTG9nKCdlcnJvcicsIGDlkK/liqjpooTop4jlvILluLg6ICR7ZXJyLm1lc3NhZ2V9YCk7XG4gICAgICAgIH1cbiAgICB9LFxuXG4gICAgLyoqIOWBnOatoumihOiniCAqL1xuICAgIGFzeW5jIHN0b3BQcmV2aWV3KCkge1xuICAgICAgICBlZGl0b3JMb2coJ2xvZycsICfmraPlnKjlgZzmraLpooTop4guLi4nKTtcbiAgICAgICAgaWYgKHBvbGxUaW1lcikgeyBjbGVhckludGVydmFsKHBvbGxUaW1lcik7IHBvbGxUaW1lciA9IG51bGw7IH1cblxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgdHJ5IHsgYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgncHJldmlldycsICdjbG9zZS1wcmV2aWV3Jyk7IH0gY2F0Y2ggKGUxKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHsgYXdhaXQgRWRpdG9yLk1lc3NhZ2UucmVxdWVzdCgncHJldmlldycsICdzdG9wJyk7IH0gY2F0Y2ggKGUyKSB7XG4gICAgICAgICAgICAgICAgICAgIHRyeSB7IEVkaXRvci5NZXNzYWdlLnNlbmQoJ3ByZXZpZXcnLCAnY2xvc2UnKTsgfSBjYXRjaCAoZTMpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGVkaXRvckxvZygnd2FybicsICfml6Dms5XpgJrov4fmtojmga/lgZzmraLpooTop4jvvIzor7fmiYvliqjlgZzmraInKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcbiAgICAgICAgICAgIGVkaXRvckxvZygnZXJyb3InLCBg5YGc5q2i6aKE6KeI5byC5bi4OiAke2Vyci5tZXNzYWdlfWApO1xuICAgICAgICB9XG5cbiAgICAgICAgc3RhdGUucnVubmluZyA9IGZhbHNlO1xuICAgICAgICBzdGF0ZS5icm93c2VyT3BlbmVkID0gZmFsc2U7XG4gICAgICAgIGVkaXRvckxvZygnbG9nJywgJ+mihOiniOW3suWBnOatoicpO1xuICAgIH0sXG5cbiAgICAvKiog5Yi35paw6aKE6KeIICovXG4gICAgYXN5bmMgcmVmcmVzaFByZXZpZXcoKSB7XG4gICAgICAgIGVkaXRvckxvZygnbG9nJywgJ+ato+WcqOWIt+aWsOmihOiniC4uLicpO1xuXG4gICAgICAgIGNvbnN0IGlzUnVubmluZyA9IGF3YWl0IGNoZWNrUG9ydChzdGF0ZS5wb3J0KTtcbiAgICAgICAgaWYgKCFpc1J1bm5pbmcpIHtcbiAgICAgICAgICAgIGVkaXRvckxvZygnd2FybicsICfpooTop4jmnKrov5DooYzvvIzlhYjlkK/liqjpooTop4gnKTtcbiAgICAgICAgICAgIG1ldGhvZHMuc3RhcnRQcmV2aWV3KCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICAvLyDmlrnmoYgx77ya6YCa6L+HIEFwcGxlU2NyaXB0IOaOp+WItua1j+iniOWZqOWIt+aWsO+8iG1hY09T77yJXG4gICAgICAgIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnZGFyd2luJykge1xuICAgICAgICAgICAgY29uc3QgcHJldmlld1VybCA9IGBsb2NhbGhvc3Q6JHtzdGF0ZS5wb3J0fWA7XG4gICAgICAgICAgICAvLyDlhYjlsJ3or5UgQ2hyb21l77yM5YaN5bCd6K+VIFNhZmFyaVxuICAgICAgICAgICAgY29uc3QgY2hyb21lU2NyaXB0ID0gYFxuICAgICAgICAgICAgICAgIHRlbGwgYXBwbGljYXRpb24gXCJHb29nbGUgQ2hyb21lXCJcbiAgICAgICAgICAgICAgICAgICAgc2V0IGZvdW5kIHRvIGZhbHNlXG4gICAgICAgICAgICAgICAgICAgIHJlcGVhdCB3aXRoIHcgaW4gd2luZG93c1xuICAgICAgICAgICAgICAgICAgICAgICAgcmVwZWF0IHdpdGggdCBpbiB0YWJzIG9mIHdcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiBVUkwgb2YgdCBjb250YWlucyBcIiR7cHJldmlld1VybH1cIiB0aGVuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRlbGwgdCB0byByZWxvYWRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2V0IGZvdW5kIHRvIHRydWVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbmQgaWZcbiAgICAgICAgICAgICAgICAgICAgICAgIGVuZCByZXBlYXRcbiAgICAgICAgICAgICAgICAgICAgZW5kIHJlcGVhdFxuICAgICAgICAgICAgICAgICAgICBpZiBub3QgZm91bmQgdGhlblxuICAgICAgICAgICAgICAgICAgICAgICAgb3BlbiBsb2NhdGlvbiBcImh0dHA6Ly9sb2NhbGhvc3Q6JHtzdGF0ZS5wb3J0fVwiXG4gICAgICAgICAgICAgICAgICAgIGVuZCBpZlxuICAgICAgICAgICAgICAgIGVuZCB0ZWxsXG4gICAgICAgICAgICBgO1xuICAgICAgICAgICAgY29uc3Qgc2FmYXJpU2NyaXB0ID0gYFxuICAgICAgICAgICAgICAgIHRlbGwgYXBwbGljYXRpb24gXCJTYWZhcmlcIlxuICAgICAgICAgICAgICAgICAgICBzZXQgZm91bmQgdG8gZmFsc2VcbiAgICAgICAgICAgICAgICAgICAgcmVwZWF0IHdpdGggdyBpbiB3aW5kb3dzXG4gICAgICAgICAgICAgICAgICAgICAgICByZXBlYXQgd2l0aCB0IGluIHRhYnMgb2Ygd1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIFVSTCBvZiB0IGNvbnRhaW5zIFwiJHtwcmV2aWV3VXJsfVwiIHRoZW5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGVsbCB0IHRvIGRvIEphdmFTY3JpcHQgXCJsb2NhdGlvbi5yZWxvYWQoKVwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNldCBmb3VuZCB0byB0cnVlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZW5kIGlmXG4gICAgICAgICAgICAgICAgICAgICAgICBlbmQgcmVwZWF0XG4gICAgICAgICAgICAgICAgICAgIGVuZCByZXBlYXRcbiAgICAgICAgICAgICAgICBlbmQgdGVsbFxuICAgICAgICAgICAgYDtcblxuICAgICAgICAgICAgZXhlYyhgb3Nhc2NyaXB0IC1lICcke2Nocm9tZVNjcmlwdH0nYCwgKGVycikgPT4ge1xuICAgICAgICAgICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gQ2hyb21lIOS4jeWPr+eUqO+8jOWwneivlSBTYWZhcmlcbiAgICAgICAgICAgICAgICAgICAgZXhlYyhgb3Nhc2NyaXB0IC1lICcke3NhZmFyaVNjcmlwdH0nYCwgKGVycjIpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChlcnIyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZWRpdG9yTG9nKCd3YXJuJywgJ+aXoOazlemAmui/hyBBcHBsZVNjcmlwdCDliLfmlrDmtY/op4jlmajvvIzlsJ3or5Xph43mlrDmiZPlvIDpobXpnaInKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBvcGVuSW5Ccm93c2VyKGBodHRwOi8vbG9jYWxob3N0OiR7c3RhdGUucG9ydH1gKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZWRpdG9yTG9nKCdsb2cnLCAn5bey6YCa6L+HIFNhZmFyaSDliLfmlrDpooTop4jpobXpnaInKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgZWRpdG9yTG9nKCdsb2cnLCAn5bey6YCa6L+HIENocm9tZSDliLfmlrDpooTop4jpobXpnaInKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIOmdniBtYWNPU++8muWbnumAgOWIsOaJk+W8gOa1j+iniOWZqFxuICAgICAgICAgICAgb3BlbkluQnJvd3NlcihgaHR0cDovL2xvY2FsaG9zdDoke3N0YXRlLnBvcnR9YCk7XG4gICAgICAgICAgICBlZGl0b3JMb2coJ2xvZycsICflt7Lph43mlrDmiZPlvIDpooTop4jpobXpnaInKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGVkaXRvckxvZygnbG9nJywgJ+WIt+aWsOWRveS7pOW3suWPkemAgScpO1xuICAgIH0sXG5cbiAgICAvKiog5omT5byA5rWP6KeI5ZmoICovXG4gICAgb3BlbkJyb3dzZXIoKSB7XG4gICAgICAgIG9wZW5JbkJyb3dzZXIoYGh0dHA6Ly9sb2NhbGhvc3Q6JHtzdGF0ZS5wb3J0fWApO1xuICAgICAgICBzdGF0ZS5icm93c2VyT3BlbmVkID0gdHJ1ZTtcbiAgICB9LFxuXG4gICAgLyoqIOWcuuaZr+S/neWtmOaXtuiHquWKqOWIt+aWsCAqL1xuICAgIGFzeW5jIG9uU2NlbmVTYXZlZCgpIHtcbiAgICAgICAgaWYgKHN0YXRlLnJ1bm5pbmcpIHtcbiAgICAgICAgICAgIGVkaXRvckxvZygnbG9nJywgJ+ajgOa1i+WIsOWcuuaZr+S/neWtmO+8jOiHquWKqOWIt+aWsOmihOiniCcpO1xuICAgICAgICAgICAgbWV0aG9kcy5yZWZyZXNoUHJldmlldygpO1xuICAgICAgICB9XG4gICAgfSxcbn07XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8g5omp5bGV55Sf5ZG95ZGo5pyfXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuZXhwb3J0IGZ1bmN0aW9uIGxvYWQoKSB7XG4gICAgZWRpdG9yTG9nKCdsb2cnLCAn5omp5bGV5bey5Yqg6L29Jyk7XG4gICAgZWRpdG9yTG9nKCdsb2cnLCAn5b+r5o236ZSuOiBDbWQrU2hpZnQrUCDlkK/liqggfCBDbWQrU2hpZnQrTyDlgZzmraIgfCBDbWQrU2hpZnQrUiDliLfmlrAnKTtcblxuICAgIC8vIOWQr+WKqCBBUEkg5pyN5Yqh5ZmoXG4gICAgc3RhcnRBcGlTZXJ2ZXIoKTtcblxuICAgIC8vIOajgOa1i+mihOiniOaYr+WQpuW3suWcqOi/kOihjFxuICAgIGNoZWNrUG9ydChzdGF0ZS5wb3J0KS50aGVuKChydW5uaW5nKSA9PiB7XG4gICAgICAgIGlmIChydW5uaW5nKSB7XG4gICAgICAgICAgICBzdGF0ZS5ydW5uaW5nID0gdHJ1ZTtcbiAgICAgICAgICAgIGVkaXRvckxvZygnbG9nJywgYOajgOa1i+WIsOmihOiniOacjeWKoeWZqOW3suWcqOerr+WPoyAke3N0YXRlLnBvcnR9IOi/kOihjGApO1xuICAgICAgICB9XG4gICAgfSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB1bmxvYWQoKSB7XG4gICAgaWYgKHBvbGxUaW1lcikgeyBjbGVhckludGVydmFsKHBvbGxUaW1lcik7IHBvbGxUaW1lciA9IG51bGw7IH1cbiAgICBzdG9wQXBpU2VydmVyKCk7XG4gICAgZWRpdG9yTG9nKCdsb2cnLCAn5omp5bGV5bey5Y246L29Jyk7XG59XG4iXX0=