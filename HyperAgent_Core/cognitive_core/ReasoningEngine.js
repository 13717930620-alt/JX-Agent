// ReasoningEngine — 推理引擎

class ReasoningEngine {
    constructor(options = {}) {
        this.debug = options.debug || false;

        // 内置基础规则（最底层的逻辑公理）
        this._builtinRules = this._initBuiltinRules();

        // 从经验中学习的规则（动态增长）
        this._learnedRules = [];

        this._mctsPlanner = null;

        // 已知推理链缓存（避免重复推理）
        this._reasoningCache = new Map();
        this._maxCacheSize = 100;

        this._treeOfThoughts = null;

        // 推理统计
        this.stats = {
            totalInferences: 0,
            deductions: 0,
            inductions: 0,
            analogies: 0,
            causals: 0,
            cacheHits: 0,
            lastReasoning: null
        };
    }

    setTreeOfThoughts(tot) {
        this._treeOfThoughts = tot;
    }

    /**
     * 注入 MCTS 规划器
     */
    setMCTSPlanner(mcts) {
        this._mctsPlanner = mcts;
    }

    // 公共接口

    /**
     * 综合推理入口——自动选择最优推理方式
     * @param {object} situation - 当前情境
     * @param {object} context - 上下文（经验、模式、知识）
     * @returns {object} { conclusion, reasoning, confidence, method }
     */
    async reason(situation, context = {}) {
        this.stats.totalInferences++;
        this.stats.lastReasoning = new Date().toISOString();

        const situationKey = this._situationKey(situation);

        // 1. 检查缓存
        if (this._reasoningCache.has(situationKey)) {
            this.stats.cacheHits++;
            return this._reasoningCache.get(situationKey);
        }

        // 2. 尝试演绎推理（如果有匹配规则）
        if (this._learnedRules.length > 0 || this._builtinRules.length > 0) {
            const deductive = this.deduce(situation, context);
            if (deductive.confidence > 0.6) {
                this.stats.deductions++;
                return this._cacheAndReturn(situationKey, deductive);
            }
        }

        // 3. 尝试类比推理（如果有相似历史）
        if (context.similarExperiences && context.similarExperiences.length > 0) {
            const analogical = this.analogize(situation, context);
            if (analogical.confidence > 0.5) {
                this.stats.analogies++;
                return this._cacheAndReturn(situationKey, analogical);
            }
        }

        // 4. 尝试因果推理
        if (context.recentHistory && context.recentHistory.length > 2) {
            const causal = this.causeAndEffect(situation, context);
            if (causal.confidence > 0.4) {
                this.stats.causals++;
                return this._cacheAndReturn(situationKey, causal);
            }
        }

        // 5. 尝试归纳推理（默认回退）
        const inductive = this.induce(situation, context);
        this.stats.inductions++;
        return this._cacheAndReturn(situationKey, inductive);
    }

    /**
     * 演绎推理：从规则推导结论
     * @param {object} situation
     * @param {object} context
     * @returns {object} { conclusion, reasoning, confidence, method: 'deduction' }
     */
    deduce(situation, context) {
        const facts = this._extractFacts(situation, context);
        const allRules = [...this._builtinRules, ...this._learnedRules];
        const matchedRules = [];
        const appliedConclusions = [];

        for (const rule of allRules) {
            const match = this._matchRule(rule, facts);
            if (match.matched) {
                matchedRules.push({ rule, bindings: match.bindings });
                appliedConclusions.push(this._applyRule(rule, match.bindings));
            }
        }

        if (appliedConclusions.length === 0) {
            return {
                conclusion: '无可应用的规则',
                reasoning: [],
                confidence: 0,
                method: 'deduction'
            };
        }

        // 合并多个规则结论
        const merged = this._mergeConclusions(appliedConclusions);
        const confidence = this._calculateDeductionConfidence(matchedRules, facts);

        return {
            conclusion: merged,
            reasoning: matchedRules.map(m => `规则[${m.rule.name}]匹配: ${m.rule.condition} → ${m.rule.action}`),
            confidence,
            method: 'deduction',
            matchedRuleCount: matchedRules.length
        };
    }

    /**
     * 归纳推理：从多个实例总结规律
     * @param {object} situation
     * @param {object} context
     * @returns {object} { conclusion, reasoning, confidence, method: 'induction' }
     */
    induce(situation, context) {
        const instances = this._collectInstances(situation, context);

        if (instances.length < 2) {
            return {
                conclusion: instances.length === 1 ? '单一实例，需要更多数据以归纳' : '无相关实例可归纳',
                reasoning: [],
                confidence: 0.1,
                method: 'induction'
            };
        }

        // 统计共同特征
        const commonTraits = this._findCommonTraits(instances);
        const trends = this._findTrends(instances);
        const outliers = this._findOutliers(instances);

        let conclusion;
        let confidence;

        if (commonTraits.length > 0) {
            conclusion = `基于${instances.length}个实例，共同特征: ${commonTraits.slice(0, 3).join(', ')}`;
            confidence = Math.min(0.8, 0.3 + instances.length * 0.05);
        } else if (trends.length > 0) {
            conclusion = `检测到趋势: ${trends[0]}`;
            confidence = 0.5;
        } else {
            conclusion = `${instances.length}个实例未发现显著共同模式`;
            confidence = 0.2;
        }

        return {
            conclusion,
            reasoning: [
                `分析实例数: ${instances.length}`,
                commonTraits.length > 0 ? `共同特征: ${commonTraits.join(', ')}` : '无共同特征',
                trends.length > 0 ? `趋势: ${trends[0]}` : '无显著趋势',
                outliers.length > 0 ? `异常点: ${outliers.length}个` : '无异常点'
            ],
            confidence,
            method: 'induction',
            instanceCount: instances.length
        };
    }

    /**
     * 类比推理：从相似情境迁移知识
     * @param {object} situation
     * @param {object} context { similarExperiences }
     * @returns {object} { conclusion, reasoning, confidence, method: 'analogy' }
     */
    analogize(situation, context) {
        const similar = context.similarExperiences || [];
        if (similar.length === 0) {
            return {
                conclusion: '无相似情境可类比',
                reasoning: [],
                confidence: 0,
                method: 'analogy'
            };
        }

        // 计算相似度
        const scored = similar.map(exp => ({
            experience: exp,
            similarity: this._computeSimilarity(situation, exp)
        })).sort((a, b) => b.similarity - a.similarity);

        const bestMatch = scored[0];

        // 从最相似经验中提取可迁移的结论
        const transferable = this._extractTransferable(bestMatch.experience);
        const adapted = this._adaptToSituation(transferable, situation, bestMatch.experience);

        // 自信度 = 相似度 * 经验重要性
        const similarityScore = bestMatch.similarity;
        const importanceScore = bestMatch.experience.importance || 0.3;
        const confidence = similarityScore * (0.5 + importanceScore * 0.5);

        return {
            conclusion: adapted || `类比"${bestMatch.experience.type || 'unknown'}"经验，相似度${(similarityScore * 100).toFixed(0)}%`,
            reasoning: [
                `最相似经验: ${bestMatch.experience.id || 'unknown'} (相似度: ${(similarityScore * 100).toFixed(0)}%)`,
                `经验类型: ${bestMatch.experience.type || 'unknown'}`,
                `可迁移结论: ${adapted || '需进一步适配'}`
            ],
            confidence: Math.min(0.9, confidence),
            method: 'analogy',
            bestSimilarity: similarityScore,
            similarCount: similar.length
        };
    }

    /**
     * 因果推理：分析因果关系
     * @param {object} situation
     * @param {object} context { recentHistory }
     * @returns {object} { conclusion, reasoning, confidence, method: 'causal' }
     */
    causeAndEffect(situation, context) {
        const history = context.recentHistory || [];

        if (history.length < 3) {
            return {
                conclusion: '历史数据不足，无法进行因果分析',
                reasoning: [],
                confidence: 0.1,
                method: 'causal'
            };
        }

        // 提取时序事件
        const events = this._extractEventSequence(history);
        if (events.length < 2) {
            return {
                conclusion: '无法从历史中提取有效事件序列',
                reasoning: [],
                confidence: 0.1,
                method: 'causal'
            };
        }

        // 检测时序关联（一个事件总是在另一个之前发生）
        const correlations = this._findTemporalCorrelations(events);

        if (correlations.length === 0) {
            return {
                conclusion: '未检测到显著的因果关系',
                reasoning: [],
                confidence: 0.2,
                method: 'causal'
            };
        }

        // 取最可靠的因果关系
        const topCorrelation = correlations[0];
        const causalStrength = topCorrelation.support * topCorrelation.confidence;
        const confidence = Math.min(0.8, causalStrength);

        return {
            conclusion: `发现可能因果链: ${topCorrelation.cause} → ${topCorrelation.effect}`,
            reasoning: [
                `原因: ${topCorrelation.cause}`,
                `结果: ${topCorrelation.effect}`,
                `支持度: ${(topCorrelation.support * 100).toFixed(0)}%`,
                `置信度: ${(topCorrelation.confidence * 100).toFixed(0)}%`,
                `基于${events.length}个事件的时序分析`
            ],
            confidence,
            method: 'causal',
            correlations: correlations.slice(0, 3)
        };
    }

    /**
     * 学习新规则（从经验中提取）
     */
    learnRule(condition, action, name, confidence = 0.3) {
        this._learnedRules.push({
            id: `rule_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            name: name || `learned_rule_${this._learnedRules.length}`,
            condition,
            action,
            confidence,
            createdAt: new Date().toISOString(),
            hitCount: 0
        });
        this._reasoningCache.clear(); // 规则变化，清除缓存
        return this._learnedRules.length;
    }

    getRules() {
        return {
            builtin: this._builtinRules.map(r => ({ name: r.name, condition: r.condition })),
            learned: this._learnedRules.map(r => ({
                name: r.name,
                condition: r.condition,
                action: r.action,
                confidence: r.confidence,
                hitCount: r.hitCount
            }))
        };
    }

    resetLearnedRules() {
        this._learnedRules = [];
        this._reasoningCache.clear();
    }

    getStats() {
        return { ...this.stats, learnedRules: this._learnedRules.length, builtinRules: this._builtinRules.length };
    }

    // 内置逻辑公理

    _initBuiltinRules() {
        return [
            // 系统状态规则
            {
                name: '高CPU负载规则',
                condition: { field: 'cpu.load', predicate: 'gt', value: 80 },
                action: '系统CPU负载过高，可能需要降负或检查异常进程',
                priority: 8
            },
            {
                name: '内存不足规则',
                condition: { field: 'memory.usage', predicate: 'gt', value: 90 },
                action: '系统内存即将耗尽，建议关闭不必要的程序',
                priority: 9
            },
            {
                name: '磁盘空间规则',
                condition: { field: 'disk.freeRatio', predicate: 'lt', value: 10 },
                action: '磁盘空间不足，需要清理',
                priority: 7
            },

            // 行为规则
            {
                name: '重复失败规则',
                condition: { type: 'pattern', pattern: 'repeated_failure', predicate: 'gte', value: 3 },
                action: '同一操作连续失败，建议检查环境或换用替代方案',
                priority: 6
            },
            {
                name: '长时间空闲规则',
                condition: { field: 'idle.time', predicate: 'gt', value: 30 },
                action: '系统长时间空闲，可执行定期维护任务',
                priority: 3
            },

            // 安全规则
            {
                name: '安全边界规则',
                condition: { type: 'permission', level: 'high_risk', predicate: 'eq', value: true },
                action: '高风险操作需要用户明确授权',
                priority: 10
            }
        ];
    }

    // 内部方法

    _extractFacts(situation, context) {
        const facts = [];

        // 从情境中提取
        if (typeof situation === 'object' && situation !== null) {
            for (const [key, value] of Object.entries(situation)) {
                if (typeof value !== 'object' && typeof value !== 'function') {
                    facts.push({ field: key, value });
                }
                // 处理嵌套字段
                if (typeof value === 'object' && value !== null) {
                    for (const [subKey, subValue] of Object.entries(value)) {
                        if (typeof subValue !== 'object' && typeof subValue !== 'function') {
                            facts.push({ field: `${key}.${subKey}`, value: subValue });
                        }
                    }
                }
            }
        }

        // 从上下文中提取
        if (context.currentState) {
            const state = typeof context.currentState === 'object' ? context.currentState : {};
            for (const [key, value] of Object.entries(state)) {
                if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
                    facts.push({ field: `state.${key}`, value });
                }
            }
        }

        return facts;
    }

    _matchRule(rule, facts) {
        const cond = rule.condition;
        const bindings = {};

        // 基于字段的匹配
        if (cond.field) {
            const fact = facts.find(f => {
                const fField = f.field.toLowerCase().replace(/^state\./, '');
                const cField = cond.field.toLowerCase().replace(/^state\./, '');
                return fField === cField || fField.endsWith('.' + cField.split('.').pop());
            });

            if (!fact) return { matched: false };

            const value = fact.value;
            let matched = false;

            switch (cond.predicate) {
                case 'gt': matched = parseFloat(value) > cond.value; break;
                case 'gte': matched = parseFloat(value) >= cond.value; break;
                case 'lt': matched = parseFloat(value) < cond.value; break;
                case 'lte': matched = parseFloat(value) <= cond.value; break;
                case 'eq': matched = value === cond.value || parseFloat(value) === cond.value; break;
                case 'neq': matched = value !== cond.value; break;
                case 'contains': matched = String(value).toLowerCase().includes(String(cond.value).toLowerCase()); break;
                default: matched = false;
            }

            if (matched) {
                bindings[cond.field] = value;
                return { matched: true, bindings };
            }
            return { matched: false };
        }

        // 基于类型的匹配
        if (cond.type === 'pattern' && facts.some(f => f.field.includes('pattern'))) {
            return { matched: true, bindings: { pattern: cond.pattern } };
        }

        return { matched: false };
    }

    _applyRule(rule, bindings) {
        let action = rule.action;
        // 替换绑定变量
        for (const [key, value] of Object.entries(bindings)) {
            action = action.replace(`{${key}}`, value);
        }
        rule.hitCount = (rule.hitCount || 0) + 1;
        return { text: action, ruleName: rule.name, priority: rule.priority || 5 };
    }

    _mergeConclusions(conclusions) {
        if (conclusions.length === 1) return conclusions[0].text;

        // 按优先级排序，取最高优先级的结论
        conclusions.sort((a, b) => (b.priority || 5) - (a.priority || 5));
        const top = conclusions.slice(0, 2);

        if (top.length === 1) return top[0].text;
        return `${top[0].text}（另外: ${top[1].text}）`;
    }

    _calculateDeductionConfidence(matchedRules, facts) {
        // 基于规则置信度和事实完整度计算
        const ruleConfidence = matchedRules.reduce((sum, m) => sum + (m.rule.confidence || 0.5), 0) / matchedRules.length;
        const ruleCountBonus = Math.min(0.2, matchedRules.length * 0.05);
        return Math.min(0.95, ruleConfidence + ruleCountBonus);
    }

    _collectInstances(situation, context) {
        // 从经验和历史中收集相关实例
        const instances = [];

        if (context.recentHistory && Array.isArray(context.recentHistory)) {
            // 将历史记录处理为可分析的数值实例
            for (const h of context.recentHistory) {
                if (h && typeof h === 'object') {
                    const instance = {};
                    for (const [key, value] of Object.entries(h)) {
                        if (typeof value === 'number') {
                            instance[key] = value;
                        }
                    }
                    if (Object.keys(instance).length > 0) {
                        instances.push(instance);
                    }
                }
            }
        }

        // 从情境本身提取
        if (typeof situation === 'object' && situation !== null) {
            const selfInstance = {};
            for (const [key, value] of Object.entries(situation)) {
                if (typeof value === 'number') {
                    selfInstance[key] = value;
                }
                if (typeof value === 'object' && value !== null) {
                    for (const [subKey, subValue] of Object.entries(value)) {
                        if (typeof subValue === 'number') {
                            selfInstance[`${key}.${subKey}`] = subValue;
                        }
                    }
                }
            }
            if (Object.keys(selfInstance).length > 0) {
                instances.unshift(selfInstance);
            }
        }

        return instances;
    }

    _findCommonTraits(instances) {
        if (instances.length < 2) return [];

        const traits = [];
        const keys = Object.keys(instances[0]);

        for (const key of keys) {
            const values = instances.map(inst => inst[key]).filter(v => v !== undefined && v !== null);
            if (values.length < 2) continue;

            // 检查数值是否在相近范围内
            if (values.every(v => typeof v === 'number')) {
                const avg = values.reduce((a, b) => a + b, 0) / values.length;
                const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
                const stdDev = Math.sqrt(variance);

                if (stdDev / (avg || 1) < 0.3) {
                    traits.push(`${key}≈${avg.toFixed(1)}`);
                }
            }

            // 检查是否所有值都相同（枚举值）
            if (values.every(v => v === values[0])) {
                traits.push(`${key}=${values[0]}`);
            }
        }

        return traits;
    }

    _findTrends(instances) {
        if (instances.length < 3) return [];

        const trends = [];
        const keys = Object.keys(instances[0]).filter(k =>
            instances.every(inst => typeof inst[k] === 'number')
        );

        for (const key of keys) {
            const values = instances.map(inst => inst[key]);
            const isUpward = values.every((v, i) => i === 0 || v >= values[i - 1]);
            const isDownward = values.every((v, i) => i === 0 || v <= values[i - 1]);

            if (isUpward && values.length >= 3) {
                const change = ((values[values.length - 1] - values[0]) / (values[0] || 1) * 100).toFixed(0);
                trends.push(`${key}持续上升(${change}%)`);
            } else if (isDownward && values.length >= 3) {
                const change = ((values[0] - values[values.length - 1]) / (values[0] || 1) * 100).toFixed(0);
                trends.push(`${key}持续下降(${change}%)`);
            }
        }

        return trends;
    }

    _findOutliers(instances) {
        if (instances.length < 4) return [];

        const outliers = [];
        const keys = Object.keys(instances[0]).filter(k =>
            instances.every(inst => typeof inst[k] === 'number')
        );

        for (const key of keys) {
            const values = instances.map(inst => inst[key]);
            const avg = values.reduce((a, b) => a + b, 0) / values.length;
            const stdDev = Math.sqrt(values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length);

            if (stdDev === 0) continue;

            for (let i = 0; i < values.length; i++) {
                if (Math.abs(values[i] - avg) > 2 * stdDev) {
                    outliers.push({ index: i, key, value: values[i], reason: `偏离均值${((values[i] - avg) / stdDev).toFixed(1)}个标准差` });
                }
            }
        }

        return outliers;
    }

    _computeSimilarity(situation, experience) {
        // 简单的特征重叠相似度
        const sitStr = typeof situation === 'string' ? situation : JSON.stringify(situation);
        const expStr = experience.data ? JSON.stringify(experience.data) : (typeof experience.content === 'string' ? experience.content : JSON.stringify(experience));

        if (!sitStr || !expStr) return 0;

        // 类型匹配加分
        const sitType = typeof situation === 'object' ? situation.type : null;
        const expType = experience.type;
        let score = 0;
        if (sitType && expType && sitType === expType) score += 0.3;

        // 关键词重叠
        const sitWords = new Set(sitStr.toLowerCase().split(/\W+/).filter(w => w.length > 2));
        const expWords = new Set(expStr.toLowerCase().split(/\W+/).filter(w => w.length > 2));

        if (sitWords.size === 0 || expWords.size === 0) return score;

        let overlap = 0;
        for (const word of sitWords) {
            if (expWords.has(word)) overlap++;
        }

        const jaccard = overlap / (sitWords.size + expWords.size - overlap);
        score += jaccard * 0.7;

        return Math.min(1, score);
    }

    _extractTransferable(experience) {
        // 从经验中提取可迁移的结论
        if (!experience) return null;

        if (experience.outcome) {
            if (experience.outcome.success === true) {
                return `之前类似操作成功完成`;
            } else if (experience.outcome.success === false) {
                return `之前类似操作失败: ${experience.outcome.error || '未知原因'}`;
            }
        }

        if (experience.data) {
            if (experience.data.result) return `参考经验: ${experience.data.result}`;
            if (experience.data.conclusion) return experience.data.conclusion;
        }

        return null;
    }

    _adaptToSituation(transferable, currentSituation, sourceExperience) {
        if (!transferable) return null;

        // 简单适配：如果有失败经验，在当前情境给出警告
        if (transferable.includes('失败')) {
            const context = currentSituation.type || '当前';
            return `警告：${context}操作曾有失败记录，建议谨慎执行`;
        }

        return transferable;
    }

    _extractEventSequence(history) {
        const events = [];

        for (const h of history) {
            if (h && typeof h === 'object') {
                // 提取时间戳和事件描述
                const ts = h.timestamp || h.timestampEpoch || h.time || Date.now();
                const desc = h.type || h.event || h.action || h.description || JSON.stringify(h).substring(0, 100);
                events.push({
                    timestamp: typeof ts === 'number' ? ts : new Date(ts).getTime(),
                    description: desc,
                    type: h.type || 'unknown'
                });
            }
        }

        // 按时间排序
        events.sort((a, b) => a.timestamp - b.timestamp);
        return events;
    }

    _findTemporalCorrelations(events) {
        if (events.length < 2) return [];

        const correlations = [];

        // 检测 A→B 模式（A总是在B之前发生）
        const typeGroups = {};
        for (const event of events) {
            const type = event.type || event.description.substring(0, 20);
            if (!typeGroups[type]) typeGroups[type] = [];
            typeGroups[type].push(event.timestamp);
        }

        const types = Object.keys(typeGroups);
        for (let i = 0; i < types.length; i++) {
            for (let j = 0; j < types.length; j++) {
                if (i === j) continue;

                const causeTimes = typeGroups[types[i]];
                const effectTimes = typeGroups[types[j]];

                // 检查 cause 时间是否总是在 effect 之前
                let countFollows = 0;
                for (const ct of causeTimes) {
                    const follows = effectTimes.some(et => et > ct && et - ct < 300000); // 5分钟内
                    if (follows) countFollows++;
                }

                const support = countFollows / causeTimes.length;
                if (support > 0.5) {
                    correlations.push({
                        cause: types[i],
                        effect: types[j],
                        support,
                        confidence: support * (Math.min(causeTimes.length, effectTimes.length) / Math.max(causeTimes.length, effectTimes.length))
                    });
                }
            }
        }

        return correlations.sort((a, b) => b.support - a.support);
    }

    _situationKey(situation) {
        if (typeof situation === 'string') return situation.substring(0, 100);
        if (typeof situation === 'object') {
            const fields = Object.keys(situation).sort().map(k => `${k}=${situation[k]}`).join('|');
            return fields.substring(0, 200);
        }
        return String(situation).substring(0, 100);
    }

    _cacheAndReturn(key, result) {
        if (this._reasoningCache.size >= this._maxCacheSize) {
            const firstKey = this._reasoningCache.keys().next().value;
            this._reasoningCache.delete(firstKey);
        }
        this._reasoningCache.set(key, result);
        return result;
    }
}

module.exports = ReasoningEngine;
