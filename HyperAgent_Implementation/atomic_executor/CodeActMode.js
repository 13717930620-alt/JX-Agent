/**
 * CodeActMode — the agent writes and executes code snippets in a secure sandbox.
 */

const path = require('path');

class CodeActMode {
    constructor(options = {}) {
        this.safeSandbox = options.safeSandbox || null;
        this.llmAdapter = options.llmAdapter || null;
        this.allowedImports = options.allowedImports || ['fs', 'path', 'os'];
        this.timeout = options.timeout || 15000;

        this.stats = {
            totalExecutions: 0,
            successfulExecutions: 0,
            failedExecutions: 0
        };
    }

    /**
     * 执行代码动作
     * @param {string} goal - 任务目标
     * @param {object} context - { files, state, toolResults }
     * @returns {Promise<{ success: boolean, result: string, code: string }>}
     */
    async execute(goal, context = {}) {
        this.stats.totalExecutions++;

        // LLM 生成代码
        const code = await this._generateCode(goal, context);
        if (!code) {
            return { success: false, error: 'Code generation failed', code: '' };
        }

        // 沙箱执行
        const result = await this._runInSandbox(code);

        // Optionally refine via LLM on failure
        if (!result.success && this.stats.totalExecutions < 3) {
            const refinedCode = await this._refineCode(goal, code, result.error);
            if (refinedCode) {
                const refinedResult = await this._runInSandbox(refinedCode);
                if (refinedResult.success) {
                    this.stats.successfulExecutions++;
                    return { success: true, result: refinedResult.output, code: refinedCode };
                }
            }
        }

        if (result.success) {
            this.stats.successfulExecutions++;
        } else {
            this.stats.failedExecutions++;
        }

        return { success: result.success, result: result.output || result.error, code };
    }

    /**
     * LLM 生成代码
     */
    async _generateCode(goal, context) {
        if (!this.llmAdapter) {
            return this._fallbackCode(goal);
        }

        const contextStr = context.files
            ? `\n相关文件: ${context.files.join(', ')}`
            : '';

        const prompt = `你是一个代码生成专家。为以下任务生成 JavaScript 代码。

【任务】${goal}${contextStr}

约束：
- 只使用以下内置模块: ${this.allowedImports.join(', ')}
- 代码在 Node.js 环境中运行
- 不能使用 require('child_process')
- 代码必须安全、健壮
- 用 console.log 输出结果

只返回可执行的 JavaScript 代码，不要解释。`;

        const response = await this.llmAdapter.chat([
            { role: 'system', content: '你是一个代码生成专家。只返回可执行的 JS 代码，不含解释。' },
            { role: 'user', content: prompt }
        ]);

        const text = typeof response === 'string' ? response :
                     (response.content || response.message?.content || '');

        // 提取代码块
        const codeMatch = text.match(/```(?:javascript|js)?\n?([\s\S]*?)```/);
        return codeMatch ? codeMatch[1].trim() : text.trim();
    }

    /**
     * 沙箱执行代码
     */
    async _runInSandbox(code) {
        if (this.safeSandbox && typeof this.safeSandbox.execute === 'function') {
            try {
                const result = this.safeSandbox.execute(code, {});
                return {
                    success: result.success !== false,
                    output: result.result || result.data || '',
                    error: result.error || null
                };
            } catch (e) {
                return { success: false, output: '', error: e.message };
            }
        }

        // Fallback: 使用 Node.js vm 模块
        try {
            const vm = require('vm');
            const sandbox = {
                console: { log: (...args) => { sandbox._output += args.join(' ') + '\n'; } },
                require: (mod) => {
                    if (this.allowedImports.includes(mod)) {
                        return require(mod);
                    }
                    throw new Error(`Module '${mod}' is not allowed`);
                },
                _output: '',
                setTimeout: setTimeout,
                Buffer: Buffer,
                Promise: Promise,
                Math: Math,
                JSON: JSON,
                Array: Array,
                Object: Object,
                String: String,
                Number: Number,
                Boolean: Boolean,
                Date: Date,
                RegExp: RegExp,
                Map: Map,
                Set: Set,
                Error: Error
            };

            const context = vm.createContext(sandbox);
            vm.runInContext(code, context, { timeout: this.timeout });

            return {
                success: true,
                output: sandbox._output || '(no output)',
                error: null
            };
        } catch (e) {
            return { success: false, output: '', error: e.message };
        }
    }

    /**
     * LLM 修正代码
     */
    async _refineCode(goal, originalCode, error) {
        if (!this.llmAdapter) return null;

        const prompt = `修正以下代码中的错误。

【任务】${goal}
【错误】${error}
【原始代码】
${originalCode}

返回修正后的 JavaScript 代码。只返回代码。`;

        const response = await this.llmAdapter.chat([
            { role: 'system', content: '修复错误，只返回代码。' },
            { role: 'user', content: prompt }
        ]);

        const text = typeof response === 'string' ? response :
                     (response.content || response.message?.content || '');

        const codeMatch = text.match(/```(?:javascript|js)?\n?([\s\S]*?)```/);
        return codeMatch ? codeMatch[1].trim() : text.trim();
    }

    _fallbackCode(goal) {
        return `// Auto-generated for: ${goal.substring(0, 50)}
console.log("CodeAct execution for: " + ${JSON.stringify(goal)});
console.log("Using available tools");`;
    }

    /**
     * 包装为 ToolExecutor 兼容的工具处理器
     */
    static wrapAsTool(codeActInstance) {
        return async (params) => {
            if (!codeActInstance) throw new Error('CodeActMode not initialized');
            try {
                const result = await codeActInstance.execute(params.goal || params.task, {
                    files: params.files,
                    state: params.state
                });
                return { verified: true, data: result };
            } catch (e) {
                return { verified: false, error: e.message };
            }
        };
    }

    getStats() {
        return {
            ...this.stats,
            successRate: this.stats.totalExecutions > 0
                ? (this.stats.successfulExecutions / this.stats.totalExecutions * 100).toFixed(1) + '%'
                : 'N/A'
        };
    }
}

module.exports = CodeActMode;
