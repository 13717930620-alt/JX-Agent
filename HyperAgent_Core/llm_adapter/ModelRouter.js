/**
 * ModelRouter - 多模型智能路由器
 */
class ModelRouter {
    constructor(options = {}) {
        this.models = new Map(); // name -> { adapter, profile }
        this.defaultModel = options.defaultModel || null;
        this.costOptimization = options.costOptimization !== false;
        this.performanceHistory = new Map(); // modelName -> { calls, successes, totalLatency, cost }
        this.routingTable = {
            'chat_simple': { model: null, reason: '本地交流' },
            'chat': { model: null, reason: '默认对话' },
            'ask_simple': { model: null, reason: '简单问答' },
            'ask_complex': { model: null, reason: '复杂问答' },
            'task_simple': { model: null, reason: '简单任务' },
            'task_medium': { model: null, reason: '中等任务' },
            'task_complex': { model: null, reason: '复杂任务' },
            'creative': { model: null, reason: '创意生成' },
            'analysis': { model: null, reason: '深度分析' },
            'reflection': { model: null, reason: '反思评估' },
            'memory': { model: null, reason: '记忆处理' }
        };
    }

    registerModel(name, adapter, profile = {}) {
        const defaultProfile = {
            priority: 10,
            costPer1K: 0.5,  // 每千 token 成本（相对值）
            capabilities: ['chat', 'analysis'],
            maxTokens: 8192,
            strengths: [],
            weaknesses: []
        };

        const mergedProfile = { ...defaultProfile, ...profile };
        this.models.set(name, { adapter, profile: mergedProfile });

        if (!this.defaultModel) this.defaultModel = name;

        this._updateRoutingForModel(name, mergedProfile);

        console.log(`[ModelRouter] Registered "${name}" (priority=${mergedProfile.priority}, cost=${mergedProfile.costPer1K})`);
        return this;
    }

    /**
     * 根据任务选择最合适的模型
     */
    selectModel(taskType, context = {}) {
        const route = this.routingTable[taskType];
        if (!route) {
            return this.models.get(this.defaultModel);
        }

        // 如果路由表已有指定模型
        if (route.model && this.models.has(route.model)) {
            return this.models.get(route.model);
        }

        // 动态选择：根据能力匹配 + 成本优化
        const candidates = [];
        const requiredCaps = this._getCapabilitiesForTask(taskType);

        for (const [name, data] of this.models) {
            const profile = data.profile;
            const capMatch = requiredCaps.every(c => profile.capabilities.includes(c));

            if (!capMatch) continue;

            let score = profile.priority;
            if (this.costOptimization && context.costSensitive) {
                score = score - profile.costPer1K * 0.5;
            }

            const perf = this.performanceHistory.get(name);
            if (perf && perf.calls > 5) {
                const successRate = perf.successes / perf.calls;
                score += successRate * 5;
            }

            candidates.push({ name, adapter: data.adapter, score });
        }

        if (candidates.length === 0) {
            return this.models.get(this.defaultModel);
        }

        candidates.sort((a, b) => b.score - a.score);
        const selected = candidates[0];
        route.model = selected.name;
        return selected;
    }

    getAvailableModels(taskType) {
        const requiredCaps = this._getCapabilitiesForTask(taskType);
        const result = [];

        for (const [name, data] of this.models) {
            const capMatch = requiredCaps.every(c => data.profile.capabilities.includes(c));
            if (capMatch) {
                const perf = this.performanceHistory.get(name);
                result.push({
                    name,
                    priority: data.profile.priority,
                    costPer1K: data.profile.costPer1K,
                    maxTokens: data.profile.maxTokens,
                    successRate: perf ? (perf.successes / perf.calls) : null
                });
            }
        }

        return result.sort((a, b) => b.priority - a.priority);
    }

    recordResult(modelName, success, latency, cost = 0) {
        if (!this.performanceHistory.has(modelName)) {
            this.performanceHistory.set(modelName, { calls: 0, successes: 0, totalLatency: 0, cost: 0 });
        }

        const history = this.performanceHistory.get(modelName);
        history.calls++;
        if (success) history.successes++;
        history.totalLatency += latency;
        history.cost += cost;

        // 如果路由表中有使用此模型的路由项，且成功率过低
        if (history.calls >= 5 && history.successes / history.calls < 0.5) {
            console.log(`[ModelRouter] "${modelName}" 成功率过低 (${history.successes}/${history.calls})，重新评估路由`);
            this._reRoute(modelName);
        }
    }

    getStats() {
        const routes = {};
        for (const [taskType, route] of Object.entries(this.routingTable)) {
            routes[taskType] = { assignedModel: route.model || 'auto' };
        }

        const perf = {};
        for (const [name, data] of this.performanceHistory) {
            perf[name] = {
                calls: data.calls,
                successRate: data.calls > 0 ? (data.successes / data.calls * 100).toFixed(1) + '%' : 'N/A',
                avgLatency: data.calls > 0 ? (data.totalLatency / data.calls).toFixed(0) + 'ms' : 'N/A'
            };
        }

        return { registeredModels: this.models.size, routes, performance: perf };
    }

    _getCapabilitiesForTask(taskType) {
        const map = {
            'chat_simple': ['chat'],
            'chat': ['chat'],
            'ask_simple': ['chat'],
            'ask_complex': ['analysis'],
            'task_simple': ['chat'],
            'task_medium': ['analysis'],
            'task_complex': ['analysis'],
            'creative': ['chat'],
            'analysis': ['analysis'],
            'reflection': ['analysis'],
            'memory': ['chat']
        };
        return map[taskType] || ['chat'];
    }

    _updateRoutingForModel(name, profile) {
        // 高性能模型优先分配复杂任务
        if (profile.capabilities.includes('analysis') && profile.priority >= 8) {
            if (!this.routingTable['task_complex'].model) this.routingTable['task_complex'].model = name;
            if (!this.routingTable['analysis'].model) this.routingTable['analysis'].model = name;
            if (!this.routingTable['reflection'].model) this.routingTable['reflection'].model = name;
            if (!this.routingTable['ask_complex'].model) this.routingTable['ask_complex'].model = name;
        }

        // 低成本模型优先分配简单任务
        if (profile.costPer1K <= 0.3 && profile.priority >= 5) {
            if (!this.routingTable['chat_simple'].model) this.routingTable['chat_simple'].model = name;
            if (!this.routingTable['task_simple'].model) this.routingTable['task_simple'].model = name;
        }

        if (!this.routingTable['chat'].model) this.routingTable['chat'].model = name;
    }

    _reRoute(failingModel) {
        for (const [taskType, route] of Object.entries(this.routingTable)) {
            if (route.model === failingModel) {
                route.model = null;
                console.log(`[ModelRouter] 清除 "${taskType}" -> "${failingModel}" 的路由`);
            }
        }
    }
}

module.exports = ModelRouter;
