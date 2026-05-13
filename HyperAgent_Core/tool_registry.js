/**
 * ToolRegistry.js — 工具注册表与校验器
 *
 * 所有工具必须在注册表中注册后才能使用。LLM 幻觉出的
 * 工具名或参数会直接被校验器拦截并返回错误。
 */

class ToolRegistry {
    constructor() {
        this._tools = new Map();  // name -> ToolDef
        this._categories = new Map(); // category -> Set<toolName>
        this._defaultPerms = {
            info: ['sys_info', 'sys_time', 'file_read', 'dir_list', 'http_get'],
            control: ['*'],
            admin: ['*']
        };
        this.stats = {
            totalTools: 0,
            totalCalls: 0,
            blockedCalls: 0,
            invalidToolNames: 0
        };
    }

    /**
     * 注册一个工具
     * @param {string} name - 工具名
     * @param {object} def - 工具定义
     * @param {string} def.description - 描述
     * @param {Function} def.call - 执行函数 (params) => Promise<ToolResult>
     * @param {object} [def.inputSchema] - 参数 schema { type: 'object', properties: {...}, required: [...] }
     * @param {string} [def.category] - 分类
     * @param {boolean} [def.readOnly] - 是否只读
     * @param {boolean} [def.destructive] - 是否有破坏性
     * @param {number} [def.permissionLevel] - 所需权限级别 1-4
     * @param {Function} [def.validateInput] - 自定义参数校验 (params) => { valid: boolean, error?: string }
     */
    register(name, def) {
        if (this._tools.has(name)) {
            console.warn(`[ToolRegistry] Overwriting existing tool: ${name}`);
        }
        const tool = {
            name,
            description: def.description || '',
            call: def.call || (async () => ({ verified: true, data: null })),
            inputSchema: def.inputSchema || null,
            category: def.category || 'general',
            readOnly: def.readOnly !== false,
            destructive: def.destructive || false,
            permissionLevel: def.permissionLevel || 1,
            validateInput: def.validateInput || null,
            aliases: def.aliases || [],
            callCount: 0,
            errorCount: 0,
            registeredAt: new Date().toISOString()
        };
        this._tools.set(name, tool);

        if (!this._categories.has(tool.category)) {
            this._categories.set(tool.category, new Set());
        }
        this._categories.get(tool.category).add(name);

        this.stats.totalTools = this._tools.size;
        return this;
    }

    registerMany(tools) {
        for (const [name, def] of Object.entries(tools)) {
            this.register(name, def);
        }
        return this;
    }

    find(name) {
        // 精确匹配
        let tool = this._tools.get(name);
        if (tool) return tool;

        for (const [, t] of this._tools) {
            if (t.aliases && t.aliases.includes(name)) return t;
        }

        return null;
    }

    /**
     * 校验工具调用（三层）
     * @param {string} toolName - 工具名
     * @param {object} params - 参数
     * @param {number} currentPermissionLevel - 当前权限级别
     * @returns {{ valid: boolean, tool?: object, error?: string, errorCode?: number }}
     */
    validate(toolName, params, currentPermissionLevel = 1) {
        // Layer 1: 工具名校验
        const tool = this.find(toolName);
        if (!tool) {
            this.stats.invalidToolNames++;
            const suggestions = this._getSuggestions(toolName, 3);
            return {
                valid: false,
                error: `工具 "${toolName}" 未在注册表中找到。${suggestions}`,
                errorCode: 1 // TOOL_NOT_REGISTERED
            };
        }

        // Layer 2: 参数 schema 校验
        if (tool.inputSchema) {
            const schema = tool.inputSchema;
            const required = schema.required || [];
            for (const key of required) {
                if (params[key] === undefined || params[key] === null) {
                    return {
                        valid: false,
                        error: `工具 "${toolName}" 缺少必需参数: ${key}`,
                        errorCode: 2 // INVALID_PARAMS
                    };
                }
            }
            if (schema.properties) {
                for (const [key, value] of Object.entries(params)) {
                    const propSchema = schema.properties[key];
                    if (propSchema && propSchema.type) {
                        const actualType = typeof value;
                        const expectedType = propSchema.type === 'number' ? 'number' :
                                             propSchema.type === 'string' ? 'string' :
                                             propSchema.type === 'boolean' ? 'boolean' :
                                             propSchema.type === 'object' ? 'object' :
                                             propSchema.type === 'array' ? 'object' : null;
                        // array 的特殊处理
                        if (propSchema.type === 'array' && !Array.isArray(value)) {
                            return {
                                valid: false,
                                error: `工具 "${toolName}" 参数 "${key}" 应为数组，实际为 ${actualType}`,
                                errorCode: 2
                            };
                        }
                    }
                }
            }
        }

        // Layer 3: 自定义校验
        if (tool.validateInput) {
            const result = tool.validateInput(params);
            if (!result.valid) {
                return {
                    valid: false,
                    error: `工具 "${toolName}" 校验失败: ${result.error}`,
                    errorCode: 3 // VALIDATION_FAILED
                };
            }
        }

        // Layer 4: 权限校验
        if (currentPermissionLevel < tool.permissionLevel) {
            return {
                valid: false,
                error: `工具 "${toolName}" 需要权限级别 ${tool.permissionLevel}，当前为 ${currentPermissionLevel}`,
                errorCode: 4 // PERMISSION_DENIED
            };
        }

        return { valid: true, tool };
    }

    /**
     * 执行工具调用（仅在 validate 通过后调用）
     */
    async execute(toolName, params) {
        const tool = this.find(toolName);
        if (!tool) {
            return { verified: false, error: `未知工具: ${toolName}` };
        }

        try {
            tool.callCount++;
            const startTime = Date.now();
            const result = await tool.call(params);
            const elapsed = Date.now() - startTime;
            if (!result.verified) tool.errorCount++;
            return {
                ...result,
                _toolName: toolName,
                _duration: elapsed,
                _timestamp: new Date().toISOString()
            };
        } catch (e) {
            tool.errorCount++;
            return { verified: false, error: e.message, _toolName: toolName };
        }
    }

    getToolDefinitions(permissionLevel = 1) {
        const defs = [];
        for (const [, tool] of this._tools) {
            if (tool.permissionLevel > permissionLevel) continue;
            if (tool.inputSchema) {
                defs.push({
                    type: 'function',
                    function: {
                        name: tool.name,
                        description: tool.description,
                        parameters: tool.inputSchema
                    }
                });
            }
        }
        return defs;
    }

    listTools(category = null) {
        const tools = [];
        for (const [, tool] of this._tools) {
            if (category && tool.category !== category) continue;
            tools.push({
                name: tool.name,
                description: tool.description.substring(0, 80),
                category: tool.category,
                readOnly: tool.readOnly,
                destructive: tool.destructive,
                permissionLevel: tool.permissionLevel,
                callCount: tool.callCount,
                errorCount: tool.errorCount
            });
        }
        return tools;
    }

    getStats() {
        return { ...this.stats, registeredTools: this._tools.size };
    }

    /**
     * Levenshtein 距离建议
     */
    _getSuggestions(unknownName, topN = 3) {
        const allNames = [...this._tools.keys()];
        const scored = allNames.map(name => ({
            name,
            distance: this._levenshtein(unknownName.toLowerCase(), name.toLowerCase())
        }));
        scored.sort((a, b) => a.distance - b.distance);
        const top = scored.slice(0, topN).filter(s => s.distance <= Math.max(3, unknownName.length * 0.4));
        if (top.length === 0) return '';
        return `你是否想调用: ${top.map(s => `"${s.name}"`).join('、')}？`;
    }

    _levenshtein(a, b) {
        const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
        for (let j = 1; j <= b.length; j++) {
            let prev = dp[0];
            dp[0] = j;
            for (let i = 1; i <= a.length; i++) {
                const temp = dp[i];
                dp[i] = Math.min(
                    dp[i] + 1,
                    dp[i - 1] + 1,
                    prev + (a[i - 1] === b[j - 1] ? 0 : 1)
                );
                prev = temp;
            }
        }
        return dp[a.length];
    }
}

module.exports = ToolRegistry;
