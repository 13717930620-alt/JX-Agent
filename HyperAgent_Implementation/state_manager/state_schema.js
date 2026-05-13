// StateSchema — state schema validator

// 字段定义
const FieldDefinition = {
    current_step_id: {
        type: 'string',
        required: true,
        description: '当前执行的步骤ID',
        default: 'step_0'
    },
    session_id: {
        type: 'string',
        required: true,
        description: '会话唯一标识',
        default: () => `session_${Date.now()}`
    },
    context_snapshot: {
        type: 'object',
        required: true,
        description: '上下文快照',
        default: () => ({})
    },
    task_id: {
        type: 'string',
        required: false,
        description: '当前任务ID',
        default: null
    },
    goal: {
        type: 'string',
        required: false,
        description: '当前目标描述',
        default: ''
    },
    status: {
        type: 'string',
        required: false,
        description: '当前状态',
        default: 'IDLE',
        allowedValues: ['IDLE', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED']
    },
    memory_layers: {
        type: 'object',
        required: false,
        description: '记忆层状态',
        default: () => ({ L0: 0, L1: 0, L2: 0, L3: 0 })
    },
    orchestrator_state: {
        type: 'object',
        required: false,
        description: '编排器状态',
        default: () => ({ retries: 0, reflectCount: 0 })
    },
    last_error: {
        type: 'string',
        required: false,
        description: '最后错误信息',
        default: null
    },
    created_at: {
        type: 'string',
        required: true,
        description: '创建时间',
        default: () => new Date().toISOString()
    },
    updated_at: {
        type: 'string',
        required: true,
        description: '更新时间',
        default: () => new Date().toISOString()
    }
};

class StateSchema {
    constructor(version = '1.0') {
        this.version = version;
        this.fields = FieldDefinition;
    }

    getRequiredFields() {
        return Object.entries(this.fields)
            .filter(([_, def]) => def.required)
            .map(([name]) => name);
    }

    getAllFields() {
        return { ...this.fields };
    }

    /**
     * 验证状态对象
     * @param {Object} state - 要验证的状态对象
     * @returns {Object} { valid: boolean, errors: string[], warnings: string[] }
     */
    validate(state) {
        const errors = [];
        const warnings = [];

        // 检查必需字段
        for (const [name, def] of Object.entries(this.fields)) {
            if (def.required && !(name in state)) {
                errors.push(`Missing required field: ${name} (${def.description})`);
            }
        }

        // 类型校验
        for (const [name, value] of Object.entries(state)) {
            const def = this.fields[name];
            if (def && !this._validateType(value, def.type)) {
                errors.push(`Field "${name}" has invalid type. Expected: ${def.type}, Got: ${typeof value}`);
            }
        }

        // 枚举值校验
        for (const [name, value] of Object.entries(state)) {
            const def = this.fields[name];
            if (def && def.allowedValues && !def.allowedValues.includes(value)) {
                warnings.push(`Field "${name}" has non-standard value: ${value}. Allowed: ${def.allowedValues.join(', ')}`);
            }
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * 类型校验辅助
     */
    _validateType(value, expectedType) {
        if (value === null || value === undefined) return true; // null 值由默认值处理
        switch (expectedType) {
            case 'string': return typeof value === 'string';
            case 'number': return typeof value === 'number';
            case 'boolean': return typeof value === 'boolean';
            case 'object': return typeof value === 'object' && !Array.isArray(value);
            case 'array': return Array.isArray(value);
            default: return true;
        }
    }

    /**
     * 创建默认状态
     */
    createDefault() {
        const defaultState = {};
        for (const [name, def] of Object.entries(this.fields)) {
            defaultState[name] = typeof def.default === 'function' ? def.default() : def.default;
        }
        defaultState.created_at = new Date().toISOString();
        defaultState.updated_at = new Date().toISOString();
        return defaultState;
    }

    /**
     * 填充缺失字段（使用默认值）
     */
    fillDefaults(state) {
        const filled = { ...state };
        for (const [name, def] of Object.entries(this.fields)) {
            if (!(name in filled) || filled[name] === undefined) {
                filled[name] = typeof def.default === 'function' ? def.default() : def.default;
            }
        }
        filled.updated_at = new Date().toISOString();
        return filled;
    }

    /**
     * 清理状态（移除未知字段）
     */
    sanitize(state) {
        const sanitized = {};
        for (const name of Object.keys(this.fields)) {
            if (name in state) {
                sanitized[name] = state[name];
            }
        }
        return sanitized;
    }

    /**
     * 更新状态（带时间戳）
     */
    update(state, updates) {
        const updated = { ...state, ...updates };
        updated.updated_at = new Date().toISOString();
        return this.fillDefaults(updated);
    }

    /**
     * 导出模式为 JSON Schema 兼容格式
     */
    toJSONSchema() {
        const properties = {};
        const required = [];

        for (const [name, def] of Object.entries(this.fields)) {
            properties[name] = {
                type: def.type,
                description: def.description
            };
            if (def.required) required.push(name);
        }

        return {
            $schema: 'http://json-schema.org/draft-07/schema#',
            title: `HyperAgent State Schema v${this.version}`,
            type: 'object',
            properties,
            required
        };
    }
}

// 导出工厂函数（兼容现有用法）
function createSchema(version) {
    return new StateSchema(version || '1.0');
}

// 兼容旧接口
const legacySchema = {
    version: '1.0',
    requiredFields: ['current_step_id', 'session_id', 'context_snapshot'],
    validation: (state) => {
        const schema = new StateSchema();
        return schema.validate(state);
    }
};

module.exports = {
    StateSchema,
    createSchema,
    FieldDefinition,
    legacySchema
};