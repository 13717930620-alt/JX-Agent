/**
 * tool_schema.js - 工具定义格式转换器
 *
 * 将 HyperAgent 内部工具定义转换为 LLM 函数调用格式 (OpenAI/DeepSeek 兼容)
 * 以及反向转换。
 */

/**
 * [toToolDefinition] 将 capabilityMap 条目转换为 LLM 工具定义
 * @param {Map|Array} capabilities - capabilityMap 或工具列表
 * @returns {Array} OpenAI 格式的 tools 数组
 */
function toToolDefinitions(capabilities) {
    const tools = [];
    const entries = capabilities instanceof Map
        ? Array.from(capabilities.entries())
        : Array.isArray(capabilities)
            ? capabilities.map(c => [c.name || c, c])
            : [];

    for (const [name, info] of entries) {
        const displayName = typeof info === 'string' ? info : (info.name || info.displayName || name);

        tools.push({
            type: 'function',
            function: {
                name: name,
                description: info.description || `工具: ${displayName}`,
                parameters: info.inputSchema ? convertSchema(info.inputSchema) : {
                    type: 'object',
                    properties: {},
                    description: `Parameters for ${displayName}`
                }
            }
        });
    }

    return tools;
}

/**
 * [convertSchema] 将 MCP/自定义格式的 inputSchema 转换为 JSON Schema
 */
function convertSchema(schema) {
    if (!schema) {
        return { type: 'object', properties: {} };
    }

    if (schema.type === 'object' && schema.properties) {
        return schema;
    }

    if (schema.type && !schema.properties) {
        return schema;
    }

    if (Array.isArray(schema)) {
        const properties = {};
        const required = [];
        for (const prop of schema) {
            const name = typeof prop === 'string' ? prop : prop.name;
            properties[name] = {
                type: prop.type || 'string',
                description: prop.description || `Parameter: ${name}`
            };
            if (prop.required !== false) required.push(name);
        }
        return {
            type: 'object',
            properties,
            required: required.length > 0 ? required : undefined
        };
    }

    return { type: 'object', properties: {} };
}

/**
 * [toCapabilityMap] 将 LLM 调用的 toolCalls 结果映射回 HyperAgent 动作
 * @param {Array} toolCalls - LLM 返回的 tool_calls 数组
 * @returns {Array} HyperAgent 格式的动作列表 [{ action, params }]
 */
function fromToolCalls(toolCalls) {
    if (!toolCalls || !Array.isArray(toolCalls)) return [];

    return toolCalls.map((tc, index) => {
        const fn = tc.function || tc;
        return {
            id: tc.id || `tool_${index + 1}`,
            action: fn.name,
            params: fn.arguments || {},
            expected: 'Any',
            source: 'function_call'
        };
    });
}

function formatToolsForPrompt(capabilities) {
    const entries = capabilities instanceof Map
        ? Array.from(capabilities.entries())
        : Array.isArray(capabilities)
            ? capabilities.map(c => [c.name || c, c])
            : [];

    return entries.map(([name, info]) => {
        const desc = typeof info === 'string' ? info : (info.description || '');
        const schema = info.inputSchema ? JSON.stringify(info.inputSchema) : '';
        return `- ${name}${desc ? ': ' + desc : ''}${schema ? ' ' + schema : ''}`;
    }).join('\n');
}

module.exports = {
    toToolDefinitions,
    convertSchema,
    fromToolCalls,
    formatToolsForPrompt
};
