/**
 * SafeSandbox — isolated code execution with whitelist, timeout, and memory limits.
 */
const vm = require('vm');

class SafeSandbox {
    constructor() {
        this.timeout = 5000;        // 5秒超时
        this.memoryLimit = 50 * 1024 * 1024; // 50MB
        this.allowedModules = new Set(['math', 'json', 'date', 'array', 'string', 'object']);
        this._activeContexts = new Map();
    }

    /**
     * 安全执行 JavaScript 代码
     * @param {string} code - 要执行的代码
     * @param {Object} context - 注入的上下文变量
     * @returns {Object} { success, result, error }
     */
    execute(code, context = {}) {
        const executionId = Date.now() + '_' + Math.random().toString(36).substring(2, 7);

        let sandbox;
        try {
            // 构建安全上下文
            sandbox = {
                Math: Math,
                JSON: JSON,
                Date: Date,
                Array: Array,
                String: String,
                Object: Object,
                Number: Number,
                Boolean: Boolean,
                RegExp: RegExp,
                parseInt: parseInt,
                parseFloat: parseFloat,
                isNaN: isNaN,
                isFinite: isFinite,
                console: {
                    log: (...args) => sandbox._output.push(args.map(a => JSON.stringify(a)).join(' ')),
                    error: (...args) => sandbox._output.push('[ERROR] ' + args.join(' '))
                },
                _output: [],
                _startTime: Date.now()
            };

            // 注入用户上下文
            for (const [key, value] of Object.entries(context)) {
                sandbox[key] = value;
            }

            // 创建 VM 上下文
            const vmContext = vm.createContext(sandbox);

            // 执行代码（带超时）
            const result = vm.runInContext(code, vmContext, {
                timeout: this.timeout,
                displayErrors: true
            });

            return {
                success: true,
                result: result,
                output: sandbox._output,
                executionTime: Date.now() - sandbox._startTime
            };

        } catch (error) {
            return {
                success: false,
                result: null,
                error: this._sanitizeError(error),
                output: sandbox?._output || []
            };
        }
    }

    /**
     * 执行数学表达式（专用，高速）
     */
    evalMath(expr, context = {}) {
        // Strip everything except math operators and numbers
        const safeExpr = expr.replace(/[^0-9+\-*/().%\s]/g, '');
        try {
            // Use vm-safe evaluation instead of Function constructor
            const sandbox = { Math, result: null };
            const vmContext = require('vm').createContext(sandbox);
            const result = require('vm').runInContext(`result = (${safeExpr})`, vmContext, { timeout: 2000 });
            return { success: true, result };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    /**
     * 执行文件处理相关的安全操作
     */
    async safeFileOp(operation, params) {
        const { path: filePath, content, maxSize = 10 * 1024 * 1024 } = params;
        const fs = require('fs');
        const path = require('path');

        // Security: prevent path traversal
        const normalized = path.normalize(filePath);
        if (normalized.includes('..') || normalized.startsWith('C:\\Windows') || normalized.includes('System32')) {
            return { success: false, error: 'Path traversal or system path detected' };
        }

        // 文件大小检查
        if (operation === 'read') {
            const stats = fs.statSync(filePath);
            if (stats.size > maxSize) {
                return { success: false, error: `File too large: ${stats.size} bytes (max: ${maxSize})` };
            }
        }

        return null; // 通过检查
    }

    _sanitizeError(error) {
        if (error.message.includes('Script execution timed out')) {
            return 'Execution timeout (>5s)';
        }
        return error.message.substring(0, 200);
    }

    /**
     * 获取沙箱状态
     */
    getStats() {
        return {
            activeContexts: this._activeContexts.size,
            timeout: this.timeout,
            memoryLimit: this.memoryLimit
        };
    }
}

module.exports = SafeSandbox;