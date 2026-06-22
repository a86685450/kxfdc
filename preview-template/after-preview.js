/**
 * auto-preview 日志采集注入脚本
 * 此文件放在 preview-template 目录下，Cocos Creator 预览时会自动加载
 * 拦截浏览器 console/error 并上报到 auto-preview 插件的 API 服务器 (端口 7458)
 */
(function() {
    if (window.__autoPreviewInjected) return;
    window.__autoPreviewInjected = true;

    var API_PORT = 7458;
    var API = 'http://localhost:' + API_PORT + '/api/log';

    // 发送日志到 API 服务器
    function send(level, args, stack) {
        try {
            var msg = Array.prototype.map.call(args, function(a) {
                if (typeof a === 'object') {
                    try { return JSON.stringify(a); } catch(e) { return String(a); }
                }
                return String(a);
            }).join(' ');

            // 避免采集自身日志形成死循环
            if (msg.indexOf('[DebugLogCollector]') !== -1) return;
            if (msg.indexOf('__autoPreview') !== -1) return;

            var xhr = new XMLHttpRequest();
            xhr.open('POST', API, true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.send(JSON.stringify({ level: level, message: msg, stack: stack || '' }));
        } catch(e) {
            // 静默失败
        }
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
        if (e.target && (e.target.tagName === 'SCRIPT' || e.target.tagName === 'LINK' || e.target.tagName === 'IMG')) {
            // 资源加载失败
            send('error', ['[ResourceLoadError] ' + (e.target.src || e.target.href)]);
        } else {
            // JS 运行时错误
            send('error', [e.message], e.error ? e.error.stack : (e.filename + ':' + e.lineno + ':' + e.colno));
        }
    }, true);

    // 捕获 Promise 未处理拒绝
    window.addEventListener('unhandledrejection', function(e) {
        var msg = e.reason ? (e.reason.message || String(e.reason)) : 'Unhandled promise rejection';
        var stack = e.reason ? e.reason.stack : '';
        send('error', ['[UnhandledRejection] ' + msg], stack);
    });

    console.log('[auto-preview] 运行时日志采集已注入 (preview-template)');
})();
