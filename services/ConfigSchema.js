/**
 * ConfigSchema — configuration intent registry for carrier-related settings.
 */

function normalizeAdapter(name) {
    const map = {
        deepseek: 'deepseek', '深度求索': 'deepseek', ds: 'deepseek',
        glm: 'glm', 智谱: 'glm', '智谱ai': 'glm',
        minimax: 'minimax', minimax: 'minimax',
        qwen: 'qwen', 通义: 'qwen', 千问: 'qwen', '通义千问': 'qwen',
        mock: 'mock', 测试: 'mock',
    };
    return map[name.trim().toLowerCase()] || name.trim().toLowerCase();
}

function normalizeProvider(name) {
    const map = {
        deepseek: 'DEEPSEEK', '深度求索': 'DEEPSEEK', ds: 'DEEPSEEK',
        glm: 'GLM', 智谱: 'GLM', '智谱ai': 'GLM',
        qwen: 'QWEN', 通义: 'QWEN', 千问: 'QWEN', '通义千问': 'QWEN',
    };
    return map[name.trim().toLowerCase()] || name.trim().toUpperCase();
}

const VALID_ADAPTERS = ['deepseek', 'glm', 'minimax', 'qwen', 'mock'];
const VALID_PROVIDERS = ['DEEPSEEK', 'GLM', 'MINIMAX', 'QWEN'];
const VALID_SAFETY_LEVELS = ['low', 'medium', 'high'];

const SCHEMA = [
    {
        patterns: [/换用(.{2,20})模型/i, /切换到(.{2,20})模型/i, /switch to (.+) model/i],
        action: 'set',
        key: 'LLM_ADAPTER',
        normalize(m) { return normalizeAdapter(m[1]); },
        validate(v) { return VALID_ADAPTERS.includes(v); },
        requiresRestart: true,
        needsConfirmation: true,
        description: 'LLM模型适配器',
    },
    {
        patterns: [/设置(deepseek|GLM|智谱|通义|minimax|glm|qwen)(的)?(api|API)?[密钥键令牌]/i, /set (deepseek|glm|minimax|qwen) api key/i],
        action: 'setApiKey',
        normalize(m) { return { provider: normalizeProvider(m[1]) }; },
        requiresRestart: false,
        description: 'API密钥',
    },
    {
        patterns: [/查看配置|显示配置|当前配置|配置状态/i, /show config|config status/i],
        action: 'show',
        requiresRestart: false,
    },
    {
        patterns: [/修改端口[为到](\d+)/i, /端口设[为成](\d+)/i, /change port to (\d+)/i],
        action: 'set',
        key: 'PORT',
        normalize(m) { return parseInt(m[1], 10); },
        validate(v) { return Number.isInteger(v) && v >= 1024 && v <= 65535; },
        requiresRestart: true,
        needsConfirmation: true,
        description: 'Web服务端口',
    },
    {
        patterns: [/开启多模型(调度|路由)/i, /enable multi.?model/i, /关闭多模型(调度|路由)/i, /disable multi.?model/i],
        action: 'toggle',
        key: 'MULTI_MODEL_ENABLED',
        normalize(m) { return /关|停|disable/i.test(m[0]) ? 'false' : 'true'; },
        validate(v) { return v === 'true' || v === 'false'; },
        requiresRestart: false,
        needsConfirmation: true,
        description: '多模型调度',
    },
    {
        patterns: [/设置安全级别[为到]?(low|medium|high)/i, /set safety level to (low|medium|high)/i],
        action: 'set',
        key: 'SAFETY_LEVEL',
        normalize(m) { return m[1].toLowerCase(); },
        validate(v) { return VALID_SAFETY_LEVELS.includes(v); },
        requiresRestart: false,
        needsConfirmation: true,
        description: '安全级别',
    },
    {
        patterns: [/重置配置|恢复默认/i, /reset config/i],
        action: 'reset',
        needsConfirmation: true,
        requiresRestart: true,
        description: '所有配置',
    },
];

module.exports = {
    SCHEMA,
    normalizeAdapter,
    normalizeProvider,
    isValidAdapter: (v) => VALID_ADAPTERS.includes(v),
    isValidPort: (v) => Number.isInteger(v) && v >= 1024 && v <= 65535,
    VALID_ADAPTERS,
    VALID_PROVIDERS,
};
