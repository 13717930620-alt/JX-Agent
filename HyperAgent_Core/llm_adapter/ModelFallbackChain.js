/**
 * ModelFallbackChain - 多模型降级链
 */
class ModelFallbackChain {
    constructor(modelRouter, options = {}) {
        this.modelRouter = modelRouter;
        this.maxRetriesPerModel = options.maxRetries || 2;
        this.fallbackHistory = [];
        this.maxHistorySize = options.maxHistory || 200;
        this.circuitBreakers = new Map(); // modelName -> { failures, lastFailure, open }
        this.circuitThreshold = options.circuitThreshold || 5; // 连续 N 次失败后熔断
        this.circuitResetTimeout = options.circuitResetTimeout || 60000; // 1分钟后尝试恢复
    }

    /**
     * 执行带降级的模型调用
     * @param {Function} callFn - 模型调用函数 (adapter) => Promise<result>
     * @param {Object} context - 任务上下文
     * @returns {Promise<{result: any, modelUsed: string, fallbackChain: string[]}>}
     */
    async executeWithFallback(taskType, callFn, context = {}) {
        const usedModels = [];
        let lastError = null;

        // 获取候选模型列表（按优先级排序）
        const candidates = this.modelRouter.getAvailableModels(taskType);

        if (candidates.length === 0) {
            // 没有可用模型，尝试默认模型
            const defaultModel = this.modelRouter.defaultModel
                ? { name: this.modelRouter.defaultModel }
                : null;
            if (!defaultModel) throw new Error('No models available for task type: ' + taskType);
            candidates.push(defaultModel);
        }

        for (const candidate of candidates) {
            const modelName = candidate.name;

            // 检查熔断器
            if (this._isCircuitOpen(modelName)) {
                console.log(`[FallbackChain] 跳过 "${modelName}" (熔断中)`);
                usedModels.push(`${modelName}(circuit_open)`);
                continue;
            }

            const modelData = this.modelRouter.models.get(modelName);
            if (!modelData) {
                usedModels.push(`${modelName}(not_found)`);
                continue;
            }

            for (let attempt = 0; attempt < this.maxRetriesPerModel; attempt++) {
                try {
                    const startTime = Date.now();
                    const result = await callFn(modelData.adapter);
                    const latency = Date.now() - startTime;

                    this.modelRouter.recordResult(modelName, true, latency);
                    this._recordFallback(modelName, true, usedModels.length > 0);
                    this._closeCircuit(modelName);

                    return {
                        result,
                        modelUsed: modelName,
                        fallbackChain: usedModels,
                        attempts: attempt + 1
                    };
                } catch (error) {
                    lastError = error;
                    const latency = 0;

                    if (attempt < this.maxRetriesPerModel - 1) {
                        console.log(`[FallbackChain] "${modelName}" 重试 #${attempt + 1}: ${error.message}`);
                        continue;
                    }

                    // 当前模型彻底失败
                    this.modelRouter.recordResult(modelName, false, latency);
                    this._recordFallback(modelName, false, true);
                    this._tripCircuit(modelName);
                    usedModels.push(`${modelName}(failed: ${error.message.substring(0, 40)})`);
                    console.log(`[FallbackChain] "${modelName}" 降级 -> 下一模型`);
                }
            }
        }

        // 所有模型都失败
        throw new Error(`All models failed for task "${taskType}". Chain: ${usedModels.join(' -> ')}. Last error: ${lastError?.message}`);
    }

    _isCircuitOpen(modelName) {
        const breaker = this.circuitBreakers.get(modelName);
        if (!breaker || !breaker.open) return false;

        // 检查是否过了熔断重置时间
        if (Date.now() - breaker.lastFailure > this.circuitResetTimeout) {
            console.log(`[FallbackChain] "${modelName}" 熔断器半开，尝试恢复`);
            breaker.open = false;
            breaker.failures = 0;
            return false;
        }

        return true;
    }

    _tripCircuit(modelName) {
        if (!this.circuitBreakers.has(modelName)) {
            this.circuitBreakers.set(modelName, { failures: 0, lastFailure: null, open: false });
        }

        const breaker = this.circuitBreakers.get(modelName);
        breaker.failures++;
        breaker.lastFailure = Date.now();

        if (breaker.failures >= this.circuitThreshold) {
            breaker.open = true;
            console.log(`[FallbackChain] "${modelName}" 熔断器打开 (${breaker.failures} 次连续失败)`);
        }
    }

    _closeCircuit(modelName) {
        const breaker = this.circuitBreakers.get(modelName);
        if (breaker) {
            breaker.failures = 0;
            breaker.open = false;
        }
    }

    _recordFallback(modelName, success, wasFallback) {
        this.fallbackHistory.push({
            model: modelName,
            success,
            wasFallback,
            timestamp: new Date().toISOString()
        });

        if (this.fallbackHistory.length > this.maxHistorySize) {
            this.fallbackHistory.shift();
        }
    }

    getStats() {
        const totalCalls = this.fallbackHistory.length;
        const fallbacks = this.fallbackHistory.filter(f => f.wasFallback);
        const failures = this.fallbackHistory.filter(f => !f.success);

        return {
            totalCalls,
            totalFallbacks: fallbacks.length,
            fallbackRate: totalCalls > 0 ? (fallbacks.length / totalCalls * 100).toFixed(1) + '%' : '0%',
            totalFailures: failures.length,
            circuitBreakers: Object.fromEntries(
                Array.from(this.circuitBreakers.entries()).map(([k, v]) => [k, { open: v.open, failures: v.failures }])
            ),
            recentFallbacks: this.fallbackHistory.slice(-5)
        };
    }
}

module.exports = ModelFallbackChain;
