/**
 * GuiOperator — UI-TARS GUI automation: screenshot, visual understand, decide, act, loop.
 */
const path = require('path');
const fs = require('fs');

class GuiOperator {
    constructor(options = {}) {
        this._initialized = false;
        this._agent = null;
        this._operator = null;
        this._actionParser = null;

        // UI-TARS SDK 引用（懒加载）
        this._GUIAgent = null;
        this._NutJSOperator = null;
        this._StatusEnum = null;

        // 配置
        this.config = {
            // LLM 模型配置（UI-TARS 可用任何 VL 模型）
            provider: options.provider || process.env.UI_TARS_PROVIDER || 'openai',
            model: options.model || process.env.UI_TARS_MODEL || 'deepseek-v4-flash',
            baseUrl: options.baseUrl || process.env.UI_TARS_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
            apiKey: options.apiKey || process.env.UI_TARS_API_KEY || process.env.DEEPSEEK_API_KEY || '',

            // UI-TARS 运行配置
            maxLoopCount: options.maxLoopCount || 30,
            actionDelay: options.actionDelay || 0.8,
            temperature: options.temperature || 0.3,

            // 截图保存
            screenshotDir: options.screenshotDir || path.join(process.cwd(), 'screenshots'),
            saveScreenshots: options.saveScreenshots !== false,

            // 操作范围限制
            allowMouse: options.allowMouse !== false,
            allowKeyboard: options.allowKeyboard || false, // 默认关闭键盘输入
            allowScroll: options.allowScroll !== false,
            maxClicksPerMinute: options.maxClicksPerMinute || 30,

            // 操作回调
            onAction: options.onAction || null,
            onScreenshot: options.onScreenshot || null,
            onError: options.onError || null
        };

        // 统计
        this.stats = {
            totalTasks: 0,
            successfulTasks: 0,
            totalActions: 0,
            totalScreenshots: 0,
            totalErrors: 0,
            startTime: null,
            lastTaskTime: null
        };

        // 速率控制
        this._actionTimestamps = [];
        this._currentTask = null;
    }

    // Initialization

    async init() {
        if (this._initialized) return true;

        // 创建截图目录
        if (this.config.saveScreenshots && !fs.existsSync(this.config.screenshotDir)) {
            fs.mkdirSync(this.config.screenshotDir, { recursive: true });
        }

        // 懒加载 UI-TARS SDK
        try {
            const sdk = require('@ui-tars/sdk');
            this._GUIAgent = sdk.GUIAgent;
            this._StatusEnum = sdk.StatusEnum;
        } catch (e) {
            console.warn('[GuiOperator] @ui-tars/sdk not available, UI-TARS disabled:', e.message);
            return false;
        }

        try {
            const opModule = require('@ui-tars/operator-nut-js');
            this._NutJSOperator = opModule.NutJSOperator;
        } catch (e) {
            console.warn('[GuiOperator] @ui-tars/operator-nut-js not available, using fallback');
            return false;
        }

        // 创建操作器
        this._operator = new this._NutJSOperator({});

        // 创建 UI-TARS Agent
        const modelConfig = {
            baseURL: this.config.baseUrl,
            apiKey: this.config.apiKey,
            model: this.config.model
        };

        // 过滤空配置
        if (!modelConfig.apiKey) {
            console.warn('[GuiOperator] No API key configured for UI-TARS');
            return false;
        }

        try {
            this._agent = new this._GUIAgent({
                model: modelConfig,
                operator: this._operator,
                maxLoopCount: this.config.maxLoopCount,
                onData: (data) => {
                    if (data.type === 'action') {
                        this.stats.totalActions++;
                        if (this.config.onAction) this.config.onAction(data);
                    }
                    if (data.type === 'screenshot') {
                        this.stats.totalScreenshots++;
                        if (this.config.saveScreenshots && data.screenshot) {
                            this._saveScreenshot(data);
                        }
                        if (this.config.onScreenshot) this.config.onScreenshot(data);
                    }
                },
                onError: (error) => {
                    this.stats.totalErrors++;
                    console.warn('[GuiOperator] Agent error:', error.message);
                    if (this.config.onError) this.config.onError(error);
                }
            });
        } catch (e) {
            console.warn('[GuiOperator] Failed to create GUIAgent:', e.message);
            return false;
        }

        this._initialized = true;
        console.log(`[GuiOperator] UI-TARS READY (model: ${this.config.model})`);
        return true;
    }

    // Core API

    /**
     * 执行 GUI 任务（截图 → 理解 → 操作 → 循环）
     * @param {string} instruction - 自然语言指令
     * @param {object} [options]
     * @returns {Promise<{success: boolean, result: string, actions: number, screenshots: number}>}
     */
    async runTask(instruction, options = {}) {
        if (!this._initialized) {
            const inited = await this.init();
            if (!inited) {
                return { success: false, error: 'UI-TARS not available', fallback: true };
            }
        }

        this.stats.totalTasks++;
        this.stats.startTime = this.stats.startTime || Date.now();
        this._currentTask = instruction;

        const maxLoop = options.maxLoopCount || this.config.maxLoopCount;

        try {
            // UI-TARS 内部运行完整闭环: 截图→理解→决策→执行→循环
            const result = await this._agent.run(instruction, [], {});

            this.stats.successfulTasks++;
            this.stats.lastTaskTime = Date.now();

            return {
                success: result.status === this._StatusEnum.END,
                status: result.status,
                result: result.result || result.message || '任务完成',
                actions: this.stats.totalActions,
                screenshots: this.stats.totalScreenshots,
                duration: result.duration || 0
            };
        } catch (e) {
            this.stats.totalErrors++;
            return {
                success: false,
                error: e.message,
                status: 'error',
                actions: this.stats.totalActions
            };
        }
    }

    /**
     * 执行单步 GUI 操作（不需要完整闭环）
     * @param {string} action - 操作类型: click | type | scroll | screenshot
     * @param {object} params - 操作参数
     */
    async executeAction(action, params = {}) {
        if (!this._initialized) {
            const inited = await this.init();
            if (!inited) return { success: false, error: 'UI-TARS not available' };
        }

        // 速率控制
        if (!this._checkRateLimit()) {
            return { success: false, error: 'Rate limit exceeded' };
        }

        try {
            switch (action) {
                case 'screenshot':
                    return await this._takeScreenshot(params);

                case 'click':
                    if (!this.config.allowMouse) return { success: false, error: 'Mouse control disabled' };
                    await this._operator.execute('click', { x: params.x, y: params.y });
                    this.stats.totalActions++;
                    return { success: true, action: 'click', x: params.x, y: params.y };

                case 'doubleClick':
                    if (!this.config.allowMouse) return { success: false, error: 'Mouse control disabled' };
                    await this._operator.execute('doubleClick', { x: params.x, y: params.y });
                    this.stats.totalActions++;
                    return { success: true, action: 'doubleClick', x: params.x, y: params.y };

                case 'rightClick':
                    if (!this.config.allowMouse) return { success: false, error: 'Mouse control disabled' };
                    await this._operator.execute('rightClick', { x: params.x, y: params.y });
                    this.stats.totalActions++;
                    return { success: true, action: 'rightClick', x: params.x, y: params.y };

                case 'type':
                    if (!this.config.allowKeyboard) return { success: false, error: 'Keyboard input disabled' };
                    await this._operator.execute('type', { text: params.text });
                    this.stats.totalActions++;
                    return { success: true, action: 'type', textLength: params.text?.length || 0 };

                case 'scroll':
                    if (!this.config.allowScroll) return { success: false, error: 'Scroll disabled' };
                    await this._operator.execute('scroll', { x: params.x || 0, y: params.y || 0 });
                    this.stats.totalActions++;
                    return { success: true, action: 'scroll' };

                case 'moveMouse':
                    if (!this.config.allowMouse) return { success: false, error: 'Mouse control disabled' };
                    await this._operator.execute('moveMouse', { x: params.x, y: params.y });
                    this.stats.totalActions++;
                    return { success: true, action: 'moveMouse', x: params.x, y: params.y };

                case 'getCursorPosition':
                    const pos = await this._operator.execute('getCursorPosition', {});
                    return { success: true, x: pos?.x || 0, y: pos?.y || 0 };

                default:
                    return { success: false, error: `Unknown action: ${action}` };
            }
        } catch (e) {
            this.stats.totalErrors++;
            return { success: false, error: e.message };
        }
    }

    /**
     * 分析屏幕截图并返回视觉理解结果
     */
    async analyzeScreen(instruction = '描述当前屏幕内容') {
        if (!this._initialized) {
            await this.init();
        }

        const screenshot = await this._takeScreenshot({ returnBase64: true });
        if (!screenshot.success) return screenshot;

        // 用 LLM 分析截图
        try {
            const llm = this._getLLM();
            if (!llm) return { success: false, error: 'No LLM available for analysis' };

            const response = await llm.chat([
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: instruction },
                        { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshot.base64}` } }
                    ]
                }
            ]);

            return { success: true, analysis: response, screenshot: screenshot.path };
        } catch (e) {
            return { success: false, error: e.message, screenshot: screenshot.path };
        }
    }

    // Internal

    async _takeScreenshot(params = {}) {
        try {
            const result = await this._operator.screenshot();
            const timestamp = Date.now();
            const filename = `screenshot_${timestamp}.png`;
            const filepath = path.join(this.config.screenshotDir, filename);

            let base64 = null;

            if (result && result.data) {
                // result.data 是 Buffer 或 base64
                if (Buffer.isBuffer(result.data)) {
                    if (this.config.saveScreenshots) {
                        fs.writeFileSync(filepath, result.data);
                    }
                    base64 = result.data.toString('base64');
                } else if (typeof result.data === 'string') {
                    base64 = result.data;
                    if (this.config.saveScreenshots) {
                        fs.writeFileSync(filepath, Buffer.from(base64, 'base64'));
                    }
                }
            }

            this.stats.totalScreenshots++;

            return {
                success: true,
                path: filepath,
                base64: params.returnBase64 ? base64 : undefined,
                timestamp
            };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    _saveScreenshot(data) {
        try {
            if (data.screenshot && data.screenshot.data) {
                const filename = `ui_tars_${Date.now()}.png`;
                const filepath = path.join(this.config.screenshotDir, filename);
                fs.writeFileSync(filepath, data.screenshot.data);
            }
        } catch (e) {
            // 保存失败不阻塞
        }
    }

    _checkRateLimit() {
        const now = Date.now();
        const oneMinuteAgo = now - 60000;

        // 清理旧记录
        this._actionTimestamps = this._actionTimestamps.filter(t => t > oneMinuteAgo);

        if (this._actionTimestamps.length >= this.config.maxClicksPerMinute) {
            return false;
        }

        this._actionTimestamps.push(now);
        return true;
    }

    _getLLM() {
        // 复用 JingxuanAgent 的 LLM 适配器
        try {
            const JingxuanAgent = require('../../JingxuanAgent_Main');
            return null;
        } catch (e) {
            return null;
        }
    }

    // Status

    isReady() { return this._initialized; }

    getStats() {
        return {
            ...this.stats,
            initialized: this._initialized,
            config: {
                provider: this.config.provider,
                model: this.config.model,
                maxLoopCount: this.config.maxLoopCount,
                allowMouse: this.config.allowMouse,
                allowKeyboard: this.config.allowKeyboard
            }
        };
    }

    getToolDefinitions() {
        return [
            {
                name: 'gui_screenshot',
                description: '截取当前屏幕截图并返回(base64格式)，用于了解当前屏幕状态',
                parameters: {
                    type: 'object',
                    properties: {
                        instruction: { type: 'string', description: '可选：对屏幕内容的分析指令，如"找到Chrome浏览器"' }
                    }
                }
            },
            {
                name: 'gui_click',
                description: '在屏幕指定坐标(x,y)处点击鼠标左键',
                parameters: {
                    type: 'object',
                    properties: {
                        x: { type: 'number', description: '屏幕X坐标' },
                        y: { type: 'number', description: '屏幕Y坐标' }
                    },
                    required: ['x', 'y']
                }
            },
            {
                name: 'gui_double_click',
                description: '在屏幕指定坐标处双击鼠标左键',
                parameters: {
                    type: 'object',
                    properties: {
                        x: { type: 'number' },
                        y: { type: 'number' }
                    },
                    required: ['x', 'y']
                }
            },
            {
                name: 'gui_right_click',
                description: '在屏幕指定坐标处点击鼠标右键',
                parameters: {
                    type: 'object',
                    properties: {
                        x: { type: 'number' },
                        y: { type: 'number' }
                    },
                    required: ['x', 'y']
                }
            },
            {
                name: 'gui_type_text',
                description: '在当前焦点处输入文本',
                parameters: {
                    type: 'object',
                    properties: {
                        text: { type: 'string', description: '要输入的文本' }
                    },
                    required: ['text']
                }
            },
            {
                name: 'gui_scroll',
                description: '滚动屏幕（正数=向下，负数=向上）',
                parameters: {
                    type: 'object',
                    properties: {
                        x: { type: 'number', description: '水平滚动量' },
                        y: { type: 'number', description: '垂直滚动量' }
                    }
                }
            },
            {
                name: 'gui_move_mouse',
                description: '移动鼠标到指定坐标',
                parameters: {
                    type: 'object',
                    properties: {
                        x: { type: 'number' },
                        y: { type: 'number' }
                    },
                    required: ['x', 'y']
                }
            },
            {
                name: 'gui_get_cursor',
                description: '获取当前鼠标位置坐标',
                parameters: { type: 'object', properties: {} }
            },
            {
                name: 'gui_analyze_screen',
                description: '截取并分析当前屏幕内容，用自然语言描述你看到的内容',
                parameters: {
                    type: 'object',
                    properties: {
                        instruction: { type: 'string', description: '分析指令，如"找到Chrome窗口""桌面有哪些文件"' }
                    },
                    required: ['instruction']
                }
            },
            {
                name: 'gui_run_task',
                description: '执行一个完整的 GUI 任务（自动截图→理解→操作→验证），如"打开计算器并计算 123+456"',
                parameters: {
                    type: 'object',
                    properties: {
                        instruction: { type: 'string', description: '要完成的 GUI 操作任务描述' },
                        maxSteps: { type: 'number', description: '最大步数（默认30）' }
                    },
                    required: ['instruction']
                }
            }
        ];
    }
}

module.exports = GuiOperator;
