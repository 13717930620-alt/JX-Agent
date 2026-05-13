// StrategyLibrary — 策略库

const fs = require('fs');
const path = require('path');

class StrategyLibrary {
    constructor(options = {}) {
        this.storageDir = options.storageDir || path.join(process.cwd(), 'experience_store');
        this.debug = options.debug || false;

        this._strategies = new Map();
        this._contextIndex = new Map();  // keyword → Set<strategyId>

        this.config = {
            minSuccessRate: options.minSuccessRate || 0.3,     // 最低成功率才保留
            minExecutions: options.minExecutions || 2,          // 最少执行次数
            maxStrategies: options.maxStrategies || 300,
            decayAfterDays: options.decayAfterDays || 60       // 未使用衰减
        };

        this.stats = {
            totalStrategies: 0,
            highConfidenceStrategies: 0,
            totalExecutions: 0,
            overallSuccessRate: 0,
            lastAccess: null
        };
    }

    // 公共接口

    /**
     * 从执行结果中学习策略
     * @param {string} context - 情境描述
     * @param {string} action - 采取的行动
     * @param {boolean} success - 是否成功
     * @param {object} [details] - 详情
     */
    learnFromExecution(context, action, success, details = {}) {
        const key = this._strategyKey(context, action);
        let strategy = this._strategies.get(key);

        if (!strategy) {
            strategy = {
                id: key,
                context,
                action,
                contextKeywords: this._extractKeywords(context),
                actionType: details.actionType || this._inferActionType(action),
                executions: 0,
                successes: 0,
                successRate: 0,
                firstLearned: new Date().toISOString(),
                lastExecuted: new Date().toISOString(),
                lastOutcome: null,
                confidence: 0.3,
                adjacentActions: new Set(),
                details: []
            };
            this._strategies.set(key, strategy);
            this._indexStrategy(key, strategy);
        }

        strategy.executions++;
        if (success) strategy.successes++;
        strategy.successRate = strategy.successes / strategy.executions;
        strategy.lastExecuted = new Date().toISOString();
        strategy.lastOutcome = success ? 'success' : 'failure';
        strategy.confidence = this._calculateConfidence(strategy);
        strategy.details.push({
            time: new Date().toISOString(),
            success,
            ...details
        });
        if (strategy.details.length > 20) strategy.details.shift();

        this.stats.totalExecutions++;
        this._updateStats();

        return strategy;
    }

    /**
     * 根据情境推荐策略
     * @param {object} situation - 当前情境
     * @param {object} [options]
     * @returns {object[]} 按评分排序的策略列表
     */
    recommend(situation, options = {}) {
        const sitStr = typeof situation === 'string' ? situation :
            JSON.stringify(situation);
        const sitLower = sitStr.toLowerCase();
        const sitKeywords = this._extractKeywords(sitStr);

        const scored = [];

        for (const [key, strategy] of this._strategies) {
            if (strategy.successRate < this.config.minSuccessRate) continue;

            let score = 0;

            // 关键词匹配
            const keywordOverlap = strategy.contextKeywords.filter(kw =>
                sitLower.includes(kw.toLowerCase())
            ).length;
            if (keywordOverlap > 0) {
                score += (keywordOverlap / Math.max(strategy.contextKeywords.length, 1)) * 0.4;
            }

            // 情境类型匹配
            if (situation.type && strategy.context.toLowerCase().includes(situation.type.toLowerCase())) {
                score += 0.2;
            }

            // 成功率加分
            score += strategy.successRate * 0.2;

            // 执行次数加分（经验丰富度）
            score += Math.min(0.1, strategy.executions * 0.01);

            // 新近度加分
            const daysSinceLastExec = (Date.now() - new Date(strategy.lastExecuted).getTime()) / 86400000;
            if (daysSinceLastExec < 7) score += 0.1;

            if (score > 0.1) {
                scored.push({
                    ...strategy,
                    score,
                    adjacentActions: Array.from(strategy.adjacentActions || [])
                });
            }
        }

        return scored
            .sort((a, b) => b.score - a.score)
            .slice(0, options.limit || 10);
    }

    recordAdjacentAction(context, action, adjacentAction) {
        const key = this._strategyKey(context, action);
        const strategy = this._strategies.get(key);
        if (strategy) {
            strategy.adjacentActions.add(adjacentAction);
        }
    }

    getBestStrategies(minSuccessRate = 0.6, limit = 10) {
        return Array.from(this._strategies.values())
            .filter(s => s.successRate >= minSuccessRate && s.executions >= this.config.minExecutions)
            .sort((a, b) => (b.successRate * b.executions) - (a.successRate * a.executions))
            .slice(0, limit);
    }

    search(query) {
        const q = query.toLowerCase();
        return Array.from(this._strategies.values()).filter(s =>
            s.context.toLowerCase().includes(q) ||
            s.action.toLowerCase().includes(q)
        ).sort((a, b) => b.successRate - a.successRate);
    }

    getStats() {
        return {
            ...this.stats,
            strategiesByActionType: this._countByActionType(),
            topStrategies: this.getBestStrategies(0.5, 5).map(s => ({
                context: s.context.substring(0, 50),
                action: s.action.substring(0, 50),
                successRate: s.successRate,
                executions: s.executions
            }))
        };
    }

    persist() {
        try {
            if (!fs.existsSync(this.storageDir)) {
                fs.mkdirSync(this.storageDir, { recursive: true });
            }
            const data = {
                exportedAt: new Date().toISOString(),
                strategies: Array.from(this._strategies.values()).map(s => ({
                    ...s,
                    adjacentActions: Array.from(s.adjacentActions || [])
                })),
                stats: this.stats
            };
            const filePath = path.join(this.storageDir, 'strategy_library.json');
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
            return true;
        } catch (e) {
            console.error('[StrategyLibrary] Persist error:', e.message);
            return false;
        }
    }

    load() {
        try {
            const filePath = path.join(this.storageDir, 'strategy_library.json');
            if (fs.existsSync(filePath)) {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                if (data.strategies) {
                    for (const s of data.strategies) {
                        s.adjacentActions = new Set(s.adjacentActions || []);
                        this._strategies.set(s.id, s);
                        this._indexStrategy(s.id, s);
                    }
                }
                this.stats = { ...this.stats, ...(data.stats || {}) };
                this._updateStats();
                console.log(`[StrategyLibrary] Loaded: ${this._strategies.size} strategies`);
                return true;
            }
        } catch (e) {
            console.warn('[StrategyLibrary] Load error:', e.message);
        }
        return false;
    }

    reset() {
        this._strategies.clear();
        this._contextIndex.clear();
        this.stats = { totalStrategies: 0, highConfidenceStrategies: 0, totalExecutions: 0, overallSuccessRate: 0, lastAccess: null };
    }

    // 内部方法

    _strategyKey(context, action) {
        const c = context.substring(0, 80).toLowerCase().replace(/\s+/g, '_');
        const a = action.substring(0, 40).toLowerCase().replace(/\s+/g, '_');
        return `str_${c}_${a}`;
    }

    _extractKeywords(text) {
        if (!text) return [];
        const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 2);
        const stopWords = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all',
            'can', 'had', 'her', 'was', 'one', 'our', 'out', 'has', 'had',
            'this', 'that', 'with', 'from', 'have', 'been']);
        return [...new Set(words.filter(w => !stopWords.has(w)))].slice(0, 10);
    }

    _inferActionType(action) {
        const a = action.toLowerCase();
        if (a.includes('check') || a.includes('query') || a.includes('status')) return 'query';
        if (a.includes('create') || a.includes('write') || a.includes('add')) return 'create';
        if (a.includes('delete') || a.includes('remove') || a.includes('kill')) return 'delete';
        if (a.includes('update') || a.includes('modify') || a.includes('change')) return 'update';
        if (a.includes('exec') || a.includes('run') || a.includes('start')) return 'execute';
        if (a.includes('stop') || a.includes('pause')) return 'stop';
        return 'unknown';
    }

    _calculateConfidence(strategy) {
        if (strategy.executions === 0) return 0.2;
        const baseRate = strategy.successRate;
        const executionBonus = Math.min(0.2, strategy.executions * 0.02);
        return Math.min(0.95, baseRate * 0.7 + executionBonus * 0.3);
    }

    _indexStrategy(id, strategy) {
        for (const kw of strategy.contextKeywords) {
            if (!this._contextIndex.has(kw)) {
                this._contextIndex.set(kw, new Set());
            }
            this._contextIndex.get(kw).add(id);
        }
    }

    _updateStats() {
        this.stats.totalStrategies = this._strategies.size;
        this.stats.highConfidenceStrategies = Array.from(this._strategies.values())
            .filter(s => s.confidence > 0.7).length;
        this.stats.overallSuccessRate = this.stats.totalExecutions > 0 ?
            Array.from(this._strategies.values())
                .reduce((sum, s) => sum + s.successes, 0) / this.stats.totalExecutions : 0;
        this.stats.lastAccess = new Date().toISOString();
    }

    _countByActionType() {
        const counts = {};
        for (const s of this._strategies.values()) {
            counts[s.actionType] = (counts[s.actionType] || 0) + 1;
        }
        return counts;
    }
}

module.exports = StrategyLibrary;
