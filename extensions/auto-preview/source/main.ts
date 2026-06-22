import { exec } from 'child_process';
import * as http from 'http';
import * as url from 'url';

// ============================================================
// 类型定义
// ============================================================

/** 运行时日志条目 */
interface RuntimeLog {
    timestamp: string;    // ISO 时间戳
    level: 'log' | 'warn' | 'error' | 'info' | 'debug';
    source: 'browser' | 'editor';  // 来源：浏览器运行时 / 编辑器
    message: string;
    stack?: string;       // 错误堆栈
    url?: string;         // 报错的文件 URL
    line?: number;        // 行号
    col?: number;         // 列号
}

/** 预览状态 */
interface PreviewState {
    running: boolean;
    port: number;           // Cocos 预览端口
    apiPort: number;        // 本插件 HTTP API 端口（供 AI 调用）
    browserOpened: boolean;
}

// ============================================================
// 全局状态
// ============================================================

let state: PreviewState = {
    running: false,
    port: 7456,
    apiPort: 7458,
    browserOpened: false,
};

/** 运行时日志缓冲区 */
const runtimeLogs: RuntimeLog[] = [];
const MAX_LOGS = 2000;

/** 轮询检测预览服务器的定时器 */
let pollTimer: ReturnType<typeof setInterval> | null = null;

/** 本插件的 HTTP API 服务器 */
let apiServer: http.Server | null = null;

// ============================================================
// 日志采集
// ============================================================

/** 添加一条运行时日志 */
function addLog(log: RuntimeLog): void {
    runtimeLogs.push(log);
    if (runtimeLogs.length > MAX_LOGS) {
        runtimeLogs.splice(0, runtimeLogs.length - MAX_LOGS);
    }
}

/** 添加一条编辑器来源的日志 */
function editorLog(level: RuntimeLog['level'], message: string): void {
    const msg = `[auto-preview] ${message}`;
    // 同时输出到编辑器控制台
    if (level === 'error') console.error(msg);
    else if (level === 'warn') console.warn(msg);
    else console.log(msg);

    addLog({
        timestamp: new Date().toISOString(),
        level,
        source: 'editor',
        message,
    });
}

/** 清空日志 */
function clearLogs(): void {
    runtimeLogs.length = 0;
}

// ============================================================
// 工具函数
// ============================================================

/** 检测端口是否有 HTTP 服务 */
function checkPort(port: number): Promise<boolean> {
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
function openInBrowser(urlStr: string): void {
    const platform = process.platform;
    let cmd: string;
    if (platform === 'darwin') cmd = `open "${urlStr}"`;
    else if (platform === 'win32') cmd = `start "" "${urlStr}"`;
    else cmd = `xdg-open "${urlStr}"`;

    exec(cmd, (err) => {
        if (err) editorLog('error', `打开浏览器失败: ${err.message}`);
        else editorLog('log', `已在浏览器中打开: ${urlStr}`);
    });
}

/** 等待预览服务器就绪后打开浏览器 */
function waitForServerAndOpenBrowser(port: number, maxRetries = 30): void {
    let retries = 0;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }

    editorLog('log', `等待预览服务器启动 (端口: ${port})...`);

    pollTimer = setInterval(async () => {
        retries++;
        const isReady = await checkPort(port);
        if (isReady) {
            if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
            state.running = true;
            editorLog('log', `预览服务器已就绪 (轮询 ${retries} 次)`);
            if (!state.browserOpened) {
                openInBrowser(`http://localhost:${port}`);
                state.browserOpened = true;
            }
        } else if (retries >= maxRetries) {
            if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
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
function generateInjectScript(): string {
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
function handleApiRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
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
            } catch (e) {
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
        const level = query.level as string || 'all';
        const limit = parseInt(query.limit as string || '100', 10);
        const source = query.source as string || 'all'; // browser | editor | all
        const since = query.since as string || '';       // ISO 时间戳，只返回此时间之后的日志

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
        const limit = parseInt((parsedUrl.query?.limit as string) || '50', 10);
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
        methods.startPreview();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true,"message":"启动预览命令已发送"}');
        return;
    }

    // ---- POST /api/stop-preview : AI 远程停止预览 ----
    if (req.method === 'POST' && pathname === '/api/stop-preview') {
        methods.stopPreview();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true,"message":"停止预览命令已发送"}');
        return;
    }

    // ---- POST /api/refresh-preview : AI 远程刷新预览 ----
    if (req.method === 'POST' && pathname === '/api/refresh-preview') {
        methods.refreshPreview();
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
                } catch (e: any) {
                    // 备用方式：先禁用再启用
                    try {
                        await Editor.Message.request('extension', 'disable', extName);
                        await new Promise(r => setTimeout(r, 500));
                        await Editor.Message.request('extension', 'enable', extName);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ok: true, message: `扩展 ${extName} 已通过禁用/启用方式重新加载` }));
                    } catch (e2: any) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ok: false, error: e2.message, hint: '请在编辑器中手动刷新扩展' }));
                    }
                }
            } catch (e: any) {
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
                { method: 'GET',  path: '/api/status',          desc: '获取预览状态和日志统计' },
                { method: 'GET',  path: '/api/logs',            desc: '获取运行时日志', params: 'level=error|warn|log|all, source=browser|editor|all, limit=100, since=ISO时间戳' },
                { method: 'GET',  path: '/api/errors',          desc: '获取所有错误日志', params: 'limit=50' },
                { method: 'POST', path: '/api/clear',           desc: '清空日志' },
                { method: 'POST', path: '/api/start-preview',   desc: '启动预览' },
                { method: 'POST', path: '/api/stop-preview',    desc: '停止预览' },
                { method: 'POST', path: '/api/refresh-preview',  desc: '刷新预览' },
                { method: 'POST', path: '/api/reload-extension', desc: '重新加载扩展', params: 'name=扩展名(默认auto-preview)' },
                { method: 'GET',  path: '/api/inject.js',       desc: '获取注入脚本（预览页面自动引入）' },
            ]
        }, null, 2));
        return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":"Not Found","hint":"访问 /api/help 查看可用接口"}');
}

/** 启动 API 服务器 */
function startApiServer(): void {
    if (apiServer) return;

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
    apiServer.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
            editorLog('warn', `端口 ${state.apiPort} 被占用，尝试 ${state.apiPort + 1}`);
            state.apiPort++;
            apiServer = null;
            startApiServer();
        } else {
            editorLog('error', `API 服务器启动失败: ${err.message}`);
        }
    });
}

/** 停止 API 服务器 */
function stopApiServer(): void {
    if (apiServer) {
        apiServer.close();
        apiServer = null;
        editorLog('log', 'API 服务器已停止');
    }
}

// ============================================================
// 编辑器扩展方法（菜单 / 快捷键 / 消息）
// ============================================================

export const methods: { [key: string]: (...args: any[]) => any } = {

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
            } catch (e1) {
                try {
                    await Editor.Message.request('preview', 'start');
                } catch (e2) {
                    try {
                        Editor.Message.send('preview', 'open');
                    } catch (e3) {
                        try {
                            Editor.Message.send('editor', 'execute-menu', { path: 'Project/Preview' });
                        } catch (e4) {
                            editorLog('warn', '编辑器消息启动预览失败，请手动点击 ▶ 按钮');
                            editorLog('log', '预览启动后，插件会自动检测并打开浏览器');
                        }
                    }
                }
            }

            waitForServerAndOpenBrowser(state.port);
        } catch (err: any) {
            editorLog('error', `启动预览异常: ${err.message}`);
        }
    },

    /** 停止预览 */
    async stopPreview() {
        editorLog('log', '正在停止预览...');
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }

        try {
            try { await Editor.Message.request('preview', 'close-preview'); } catch (e1) {
                try { await Editor.Message.request('preview', 'stop'); } catch (e2) {
                    try { Editor.Message.send('preview', 'close'); } catch (e3) {
                        editorLog('warn', '无法通过消息停止预览，请手动停止');
                    }
                }
            }
        } catch (err: any) {
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
            methods.startPreview();
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

            exec(`osascript -e '${chromeScript}'`, (err) => {
                if (err) {
                    // Chrome 不可用，尝试 Safari
                    exec(`osascript -e '${safariScript}'`, (err2) => {
                        if (err2) {
                            editorLog('warn', '无法通过 AppleScript 刷新浏览器，尝试重新打开页面');
                            openInBrowser(`http://localhost:${state.port}`);
                        } else {
                            editorLog('log', '已通过 Safari 刷新预览页面');
                        }
                    });
                } else {
                    editorLog('log', '已通过 Chrome 刷新预览页面');
                }
            });
        } else {
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
            methods.refreshPreview();
        }
    },
};

// ============================================================
// 扩展生命周期
// ============================================================

export function load() {
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

export function unload() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    stopApiServer();
    editorLog('log', '扩展已卸载');
}
