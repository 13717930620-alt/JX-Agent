// MetaCognitiveMonitor - metacognitive monitor
class MetaCognitiveMonitor {
    constructor(options = {}) {
        this.enabled = options.enabled !== false;
        this.checkInterval = options.checkInterval || 5; // 每 N 步检查一次
        this.biasThreshold = options.biasThreshold || 0.6;

        // 思维质量追踪
        this.thinkingQuality = [];
        this.decisionLog = [];
        this.biasesDetected = [];
        this.currentSessionStats = {
            totalSteps: 0,
            adjustments: 0,
            confidenceLevel: 1.0,
            lastQualityCheck: null
        };

        this.biasPatterns = {
            overconfidence: {
                keywords: ['肯定', '一定', '绝对', '毫无疑问', '必然', 'always', 'definitely', 'absolutely'],
                weight: 0.3
            },
            prematureConclusion: {
                keywords: ['显然', '很明显', '不用说', '当然是', 'obviously', 'clearly', 'of course'],
                weight: 0.25
            },
            ignoringAlternatives: {
                keywords: ['只能', '别无选择', '唯一的', '只有这个', 'only way', 'only option'],
                weight: 0.2
            },
            vagueReasoning: {
                keywords: ['可能吧', '大概', '也许', '或许', 'maybe', 'perhaps', 'probably', 'might'],
                weight: 0.15
            }
        };
    }

    /**
     * Analyze reasoning quality
     */
    analyzeThinking(userInput, analysis) {
        if (!this.enabled) return { quality: 1.0, issues: [] };

        const issues = [];
        let quality = 1.0;

        // 1. 检查意图识别是否合理
        if (analysis.intent && analysis.suggestedStrategy) {
            const mismatch = this._detectIntentStrategyMismatch(analysis.intent, analysis.suggestedStrategy);
            if (mismatch) {
                issues.push({ type: 'intent_strategy_mismatch', detail: mismatch });
                quality -= 0.15;
            }
        }

        // 2. 检测思维偏差
        for (const [biasType, pattern] of Object.entries(this.biasPatterns)) {
            for (const kw of pattern.keywords) {
                if (userInput.toLowerCase().includes(kw)) {
                    issues.push({ type: 'cognitive_bias', biasType, keyword: kw, weight: pattern.weight });
                    quality -= pattern.weight;
                    this.biasesDetected.push({ biasType, keyword: kw, timestamp: Date.now() });
                    break;
                }
            }
        }

        // 3. 检查分析完整度
        if (!analysis.entities || Object.keys(analysis.entities).length === 0) {
            if (userInput.length > 50) {
                issues.push({ type: 'incomplete_analysis', detail: '长输入但未提取实体' });
                quality -= 0.1;
            }
        }

        quality = Math.max(0, quality);
        this.thinkingQuality.push({ quality, issues: issues.length, timestamp: Date.now() });

        // 只保留最近 50 条记录
        if (this.thinkingQuality.length > 50) this.thinkingQuality.shift();

        return { quality, issues, needsCorrection: quality < 0.5 };
    }

    /**
     * Evaluate decision quality
     */
    evaluateDecision(decision, context) {
        this.decisionLog.push({
            decision: decision.substring(0, 100),
            context: context.substring(0, 100),
            timestamp: Date.now()
        });
        if (this.decisionLog.length > 100) this.decisionLog.shift();
    }

    /**
     * 获取当前会话统计
     */
    getSessionStats() {
        const avgQuality = this.thinkingQuality.length > 0
            ? this.thinkingQuality.reduce((s, q) => s + q.quality, 0) / this.thinkingQuality.length
            : 1.0;

        return {
            ...this.currentSessionStats,
            averageThinkingQuality: avgQuality,
            biasCount: this.biasesDetected.length,
            recentBiases: this.biasesDetected.slice(-5).map(b => b.biasType),
            totalEvaluations: this.thinkingQuality.length
        };
    }

    /**
     * 检测意图与策略之间的不匹配
     */
    _detectIntentStrategyMismatch(intent, strategy) {
        const validPairs = {
            'chat': ['directChat', 'acknowledge'],
            'ask': ['answerWithKnowledge', 'executeWithAnalysis'],
            'command': ['executeWithAnalysis', 'planAndExecute'],
            'task': ['executeWithAnalysis', 'planAndExecute'],
            'creative': ['creativeResponse', 'directChat'],
            'clarify': ['acceptAdjustment', 'clarify'],
            'feedback': ['acknowledge', 'directChat'],
            'decision': ['confirmAndAct', 'executeWithAnalysis'],
            'emotional': ['empathizeAndAct', 'directChat']
        };

        const valid = validPairs[intent];
        if (valid && !valid.includes(strategy)) {
            return `意图 "${intent}" 通常不适合策略 "${strategy}"，建议使用 ${valid.join(' or ')}`;
        }
        return null;
    }

    reset() {
        this.thinkingQuality = [];
        this.decisionLog = [];
        this.biasesDetected = [];
        this.currentSessionStats = {
            totalSteps: 0,
            adjustments: 0,
            confidenceLevel: 1.0,
            lastQualityCheck: null
        };
    }
}

module.exports = MetaCognitiveMonitor;
