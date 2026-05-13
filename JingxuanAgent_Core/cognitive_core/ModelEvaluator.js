// ModelEvaluator — 模型评估器

class ModelEvaluator {
    constructor(options = {}) {
        this.debug = options.debug || false;

        this.engines = {
            experienceDB: null,
            carrierProfile: null,
            reasoningEngine: null,
            patternDetector: null,
            conceptBuilder: null,
            selfAssessor: null,
            knowledgeGraph: null,
            patternLibrary: null,
            strategyLibrary: null,
            selfEvolver: null,
            feedbackProcessor: null
        };

        this._evaluationHistory = [];
        this._healthHistory = [];

        this.config = {
            maxHistory: 100,
            degradationThreshold: 0.2,
            minSamplesForTrend: 5
        };

        this.stats = {
            totalEvaluations: 0,
            lastEvaluation: null,
            averageHealthScore: 0,
            healthTrend: 'stable'   // improving / stable / degrading
        };
    }

    inject(engineRefs) {
        Object.assign(this.engines, engineRefs);
    }

    /**
     * 全面评估系统
     * @param {boolean} [deep=false] - 是否深度评估
     * @returns {object} 评估报告
     */
    evaluateAll(deep = false) {
        this.stats.totalEvaluations++;
        this.stats.lastEvaluation = new Date().toISOString();

        const dimensions = {
            experience: this._evaluateExperience(),
            reasoning: this._evaluateReasoning(),
            knowledge: this._evaluateKnowledge(),
            evolution: this._evaluateEvolution(),
            health: null
        };

        // 综合健康评分
        const healthScore = this._calculateHealthScore(dimensions);
        dimensions.health = {
            score: healthScore,
            level: healthScore >= 0.8 ? 'excellent' :
                   healthScore >= 0.6 ? 'good' :
                   healthScore >= 0.4 ? 'fair' : 'poor',
            bottlenecks: this._identifyBottlenecks(dimensions)
        };

        const report = {
            timestamp: new Date().toISOString(),
            dimensions,
            healthScore,
            suggestions: this._generateSuggestions(dimensions),
            deep
        };

        // 如果深度评估，添加更多细节
        if (deep) {
            report.detailed = this._deepEvaluation();
        }

        // 记录历史
        this._evaluationHistory.push(report);
        this._healthHistory.push(healthScore);
        if (this._evaluationHistory.length > this.config.maxHistory) {
            this._evaluationHistory.shift();
            this._healthHistory.shift();
        }

        // 更新趋势
        this._updateTrend();

        return report;
    }

    getSuggestions() {
        const latest = this._evaluationHistory[this._evaluationHistory.length - 1];
        if (!latest) return ['需要先执行评估'];
        return latest.suggestions || [];
    }

    getHealthTrend() {
        if (this._healthHistory.length < 2) return 'insufficient_data';

        const recent = this._healthHistory.slice(-5);
        if (recent.length < 2) return 'stable';

        const first = recent[0];
        const last = recent[recent.length - 1];
        const change = last - first;

        if (change > this.config.degradationThreshold) return 'improving';
        if (change < -this.config.degradationThreshold) return 'degrading';
        return 'stable';
    }

    getHistorySummary() {
        return {
            totalEvaluations: this.stats.totalEvaluations,
            lastEvaluation: this.stats.lastEvaluation,
            averageHealthScore: this.stats.averageHealthScore,
            healthTrend: this.stats.healthTrend,
            healthHistory: this._healthHistory.slice(-20)
        };
    }

    getStats() {
        return {
            ...this.stats,
            healthTrend: this.stats.healthTrend,
            historyLength: this._evaluationHistory.length
        };
    }

    reset() {
        this._evaluationHistory = [];
        this._healthHistory = [];
        this.stats = { totalEvaluations: 0, lastEvaluation: null, averageHealthScore: 0, healthTrend: 'stable' };
    }

    // 各维度评估

    _evaluateExperience() {
        const db = this.engines.experienceDB;
        if (!db) return { score: 0, details: '无经验数据库' };

        const stats = db.getStats();
        const total = stats.totalExperiences || 0;
        const uniqueTypes = stats.uniqueTypes?.length || 0;

        // 数量评分
        const quantityScore = Math.min(1, total / 1000);

        // 多样性评分
        const diversityScore = Math.min(1, uniqueTypes / 8);

        // 增长率评估（从历史推断）
        const growthScore = total > 10 ? 0.8 : 0.2;

        return {
            score: (quantityScore * 0.4 + diversityScore * 0.35 + growthScore * 0.25),
            total,
            uniqueTypes,
            quantityScore,
            diversityScore,
            details: `${total}条经验, ${uniqueTypes}种类型`
        };
    }

    _evaluateReasoning() {
        const re = this.engines.reasoningEngine;
        const sa = this.engines.selfAssessor;
        if (!re && !sa) return { score: 0, details: '无推理引擎' };

        const reStats = re?.getStats() || { totalInferences: 0 };
        const saStats = sa?.getStats() || { totalDecisions: 0, overallAccuracy: 0 };

        // 推理量评分
        const volumeScore = Math.min(1, (reStats.totalInferences || 0) / 50);

        // 准确率评分
        const accuracyScore = saStats.overallAccuracy || 0;

        // 方法多样性
        const methodCount = (reStats.deductions || 0) > 0 ? 1 : 0 +
                            (reStats.inductions || 0) > 0 ? 1 : 0 +
                            (reStats.analogies || 0) > 0 ? 1 : 0 +
                            (reStats.causals || 0) > 0 ? 1 : 0;
        const methodScore = Math.min(1, methodCount / 4);

        return {
            score: (accuracyScore * 0.5 + volumeScore * 0.25 + methodScore * 0.25),
            totalInferences: reStats.totalInferences,
            accuracy: accuracyScore,
            methodCount,
            details: `${reStats.totalInferences}次推理, ${(accuracyScore * 100).toFixed(0)}%准确率`
        };
    }

    _evaluateKnowledge() {
        const kg = this.engines.knowledgeGraph;
        const pl = this.engines.patternLibrary;
        const sl = this.engines.strategyLibrary;
        const cb = this.engines.conceptBuilder;

        const kgStats = kg?.getStats() || { totalEntities: 0, totalRelationships: 0 };
        const plStats = pl?.getStats() || { totalPatterns: 0, reliablePatterns: 0 };
        const slStats = sl?.getStats() || { totalStrategies: 0, highConfidenceStrategies: 0, overallSuccessRate: 0 };
        const cbStats = cb?.getStats() || { totalConcepts: 0 };

        // 知识丰富度
        const entityScore = Math.min(1, (kgStats.totalEntities || 0) / 50);
        const patternScore = Math.min(1, (plStats.totalPatterns || 0) / 20);
        const strategyScore = Math.min(1, (slStats.totalStrategies || 0) / 20);
        const conceptScore = Math.min(1, (cbStats.totalConcepts || 0) / 20);
        const strategyQualityScore = slStats.overallSuccessRate || 0;

        const richnessScore = (entityScore + patternScore + strategyScore + conceptScore) / 4;
        const qualityScore = strategyQualityScore;

        return {
            score: (richnessScore * 0.5 + qualityScore * 0.5),
            entities: kgStats.totalEntities,
            relationships: kgStats.totalRelationships,
            patterns: plStats.totalPatterns,
            reliablePatterns: plStats.reliablePatterns,
            strategies: slStats.totalStrategies,
            concepts: cbStats.totalConcepts,
            details: `${kgStats.totalEntities}实体, ${plStats.totalPatterns}模式, ${slStats.totalStrategies}策略, ${cbStats.totalConcepts}概念`
        };
    }

    _evaluateEvolution() {
        const se = this.engines.selfEvolver;
        const fp = this.engines.feedbackProcessor;
        const cp = this.engines.carrierProfile;

        const seStats = se?.getStats() || { totalEvolutions: 0 };
        const fpStats = fp?.getStats() || { totalFailuresProcessed: 0, lessonsExtracted: 0 };
        const stage = cp?.profile?.cognition?.evolutionStage || 'embryo';

        // 进化频率评分
        const frequencyScore = Math.min(1, seStats.totalEvolutions / 20);

        // 从失败中学习评分
        const learningScore = fpStats.totalFailuresProcessed > 0 ?
            Math.min(1, fpStats.lessonsExtracted / Math.max(1, fpStats.totalFailuresProcessed) * 2) : 0;

        // 进化阶段评分
        const stageScores = { embryo: 0.1, growing: 0.3, maturing: 0.6, mature: 1.0 };
        const stageScore = stageScores[stage] || 0.2;

        return {
            score: (frequencyScore * 0.3 + learningScore * 0.3 + stageScore * 0.4),
            totalEvolutions: seStats.totalEvolutions,
            stage,
            failuresProcessed: fpStats.totalFailuresProcessed,
            lessonsExtracted: fpStats.lessonsExtracted,
            details: `进化${seStats.totalEvolutions}次, 阶段:${stage}, ${fpStats.lessonsExtracted}条教训`
        };
    }

    // 综合评估

    _calculateHealthScore(dimensions) {
        const weights = {
            experience: 0.15,
            reasoning: 0.30,
            knowledge: 0.30,
            evolution: 0.25
        };

        let score = 0;
        for (const [key, weight] of Object.entries(weights)) {
            const dimScore = dimensions[key]?.score || 0;
            score += dimScore * weight;
        }

        return Math.round(score * 100) / 100;
    }

    _identifyBottlenecks(dimensions) {
        const bottlenecks = [];

        if ((dimensions.experience?.score || 0) < 0.3) {
            bottlenecks.push({ dimension: 'experience', severity: 'high', message: '经验数据严重不足' });
        }
        if ((dimensions.reasoning?.score || 0) < 0.3) {
            bottlenecks.push({ dimension: 'reasoning', severity: 'high', message: '推理能力不足，需要更多决策经验' });
        }
        if ((dimensions.knowledge?.score || 0) < 0.3) {
            bottlenecks.push({ dimension: 'knowledge', severity: 'medium', message: '知识体构建不足' });
        }
        if ((dimensions.evolution?.score || 0) < 0.3) {
            bottlenecks.push({ dimension: 'evolution', severity: 'low', message: '进化尚未充分启动' });
        }

        // 具体瓶颈
        const exp = dimensions.experience;
        if (exp && exp.total > 10 && (exp.uniqueTypes || 0) < 2) {
            bottlenecks.push({ dimension: 'experience', severity: 'medium', message: '经验类型单一，建议多样化' });
        }

        return bottlenecks;
    }

    _generateSuggestions(dimensions) {
        const suggestions = [];

        if ((dimensions.experience?.score || 0) < 0.4) {
            suggestions.push('继续积累经验，当前数据量不足以支撑可靠认知');
        }
        if ((dimensions.reasoning?.score || 0) < 0.4) {
            suggestions.push('增加决策场景，提升推理引擎的实践经验');
        }
        if ((dimensions.knowledge?.score || 0) < 0.5) {
            suggestions.push('执行承载体自发现，丰富知识图谱');
        }
        if (dimensions.evolution?.stage === 'embryo') {
            suggestions.push('处于初期阶段，建议持续运行加速进化');
        }
        if (dimensions.evolution?.stage === 'growing' && (dimensions.evolution?.totalEvolutions || 0) < 5) {
            suggestions.push('进化次数偏少，可手动触发 evolve() 加速成长');
        }
        if ((dimensions.knowledge?.strategies || 0) < 3) {
            suggestions.push('策略库尚浅，多执行工具操作以积累策略');
        }

        return suggestions.length > 0 ? suggestions : ['系统运行正常，继续保持'];
    }

    _deepEvaluation() {
        return {
            components: {
                reasoningEngine: this.engines.reasoningEngine?.getStats() || {},
                patternDetector: this.engines.patternDetector?.getStats() || {},
                conceptBuilder: this.engines.conceptBuilder?.getStats() || {},
                selfAssessor: this.engines.selfAssessor?.getStats() || {},
                knowledgeGraph: this.engines.knowledgeGraph?.getStats() || {},
                patternLibrary: this.engines.patternLibrary?.getStats() || {},
                strategyLibrary: this.engines.strategyLibrary?.getStats() || {},
                feedbackProcessor: this.engines.feedbackProcessor?.getStats() || {},
                selfEvolver: this.engines.selfEvolver?.getStats() || {}
            }
        };
    }

    _updateTrend() {
        if (this._healthHistory.length < this.config.minSamplesForTrend) return;

        const recent = this._healthHistory.slice(-this.config.minSamplesForTrend);
        const first = recent[0];
        const last = recent[recent.length - 1];

        this.stats.averageHealthScore = this._healthHistory.reduce((a, b) => a + b, 0) / this._healthHistory.length;

        if (last - first > this.config.degradationThreshold) {
            this.stats.healthTrend = 'improving';
        } else if (first - last > this.config.degradationThreshold) {
            this.stats.healthTrend = 'degrading';
        } else {
            this.stats.healthTrend = 'stable';
        }
    }
}

module.exports = ModelEvaluator;
