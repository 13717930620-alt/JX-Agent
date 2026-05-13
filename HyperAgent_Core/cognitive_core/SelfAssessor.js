// SelfAssessor — 自我评估器

class SelfAssessor {
    constructor(options = {}) {
        this.debug = options.debug || false;

        this._decisionHistory = [];

        this._calibrationData = [];

        this._domainCapabilities = new Map();  // domain → { score, trials, successes }

        this._uncertaintyFlags = new Map();    // topic → { encounters, confidence, lastSeen }

        this.config = {
            maxDecisionHistory: 500,
            calibrationWindowSize: 100,
            domainLearningRate: 0.1,
            uncertaintyThreshold: 0.3,      // 低于此值的自信度标记为不确定
            performanceAlertThreshold: 0.3,  // 低于此值的表现触发警告
            minSamplesForAssessment: 5
        };

        this.stats = {
            totalDecisions: 0,
            correctDecisions: 0,
            totalSelfAssessments: 0,
            lastAssessment: null,
            overallAccuracy: 0,
            calibrationError: 0
        };
    }

    // 公共接口

    /**
     * 评估一次决策的自信度
     * @param {object} decision - 决策内容
     * @param {object} context - 决策时上下文
     * @returns {object} { confidence, calibrated, factors }
     */
    assessDecision(decision, context = {}) {
        this.stats.totalDecisions++;

        const factors = [];

        // 1. 基于历史准确率的基础自信度
        const baseConfidence = this._getBaseConfidence(context.domain);

        // 2. 基于信息完整度
        const infoCompleteness = this._assessInfoCompleteness(context);
        factors.push({ name: '信息完整度', value: infoCompleteness });

        // 3. 基于经验丰富度
        const experienceRichness = this._assessExperienceRichness(context);
        factors.push({ name: '经验丰富度', value: experienceRichness });

        // 4. 基于情境相似度
        const situationFamiliarity = this._assessSituationFamiliarity(context);
        factors.push({ name: '情境熟悉度', value: situationFamiliarity });

        // 5. 基于不确定性
        const uncertainty = this._assessUncertainty(decision, context);
        factors.push({ name: '不确定性', value: 1 - uncertainty });

        // 综合自信度
        const rawConfidence = (
            baseConfidence * 0.3 +
            infoCompleteness * 0.2 +
            experienceRichness * 0.2 +
            situationFamiliarity * 0.2 +
            (1 - uncertainty) * 0.1
        );

        // 校准
        const calibrated = this._calibrateConfidence(rawConfidence, context.domain);

        return {
            confidence: Math.max(0, Math.min(1, calibrated)),
            rawConfidence: Math.round(rawConfidence * 100) / 100,
            calibrated: true,
            factors: factors.sort((a, b) => b.value - a.value),
            domain: context.domain || 'general',
            timestamp: new Date().toISOString()
        };
    }

    /**
     * 记录一次决策的实际结果
     * @param {object} decision - 原始决策
     * @param {object} outcome - 实际结果 { success, error, feedback }
     */
    recordOutcome(decision, outcome) {
        const record = {
            timestamp: new Date().toISOString(),
            decision: decision.decision || decision.action || 'unknown',
            domain: decision.domain || 'general',
            expectedConfidence: decision.confidence || 0.5,
            actualSuccess: outcome.success === true,
            error: outcome.error || null,
            feedback: outcome.feedback || null,
            elapsed: outcome.elapsed || null
        };

        this._decisionHistory.push(record);
        if (this._decisionHistory.length > this.config.maxDecisionHistory) {
            this._decisionHistory.shift();
        }

        // 更新校准数据
        this._calibrationData.push({
            confidence: record.expectedConfidence,
            correct: record.actualSuccess
        });
        if (this._calibrationData.length > this.config.calibrationWindowSize) {
            this._calibrationData.shift();
        }

        // 更新领域能力
        this._updateDomainCapability(record.domain, record.actualSuccess);

        // 更新统计
        if (record.actualSuccess) {
            this.stats.correctDecisions++;
        }
        this.stats.overallAccuracy = this.stats.correctDecisions / Math.max(1, this.stats.totalDecisions);

        // 计算校准误差
        this._computeCalibrationError();

        this.stats.lastAssessment = new Date().toISOString();
        this.stats.totalSelfAssessments++;

        return {
            recorded: true,
            updatedAccuracy: this.stats.overallAccuracy,
            domainUpdated: true
        };
    }

    /**
     * 评价系统在某领域的整体能力
     * @param {string} [domain]
     * @returns {object}
     */
    assessCapability(domain = null) {
        if (domain) {
            const cap = this._domainCapabilities.get(domain);
            if (!cap || cap.trials < this.config.minSamplesForAssessment) {
                return {
                    domain,
                    score: 0.3,
                    confidence: 0.2,
                    trials: cap?.trials || 0,
                    reliable: false,
                    assessment: '样本不足，尚无法可靠评估'
                };
            }

            const reliability = Math.min(1, cap.trials / 20);
            return {
                domain,
                score: cap.score,
                confidence: reliability,
                trials: cap.trials,
                successes: cap.successes,
                reliable: reliability > 0.5,
                accuracy: cap.trials > 0 ? (cap.successes / cap.trials * 100).toFixed(0) + '%' : 'N/A',
                assessment: this._generateCapabilityAssessment(cap, reliability)
            };
        }

        // 全领域评估
        const assessments = [];
        for (const [dom, cap] of this._domainCapabilities) {
            if (cap.trials >= this.config.minSamplesForAssessment) {
                assessments.push({
                    domain: dom,
                    score: cap.score,
                    trials: cap.trials,
                    accuracy: (cap.successes / cap.trials * 100).toFixed(0) + '%'
                });
            }
        }

        return {
            overall: this.stats.overallAccuracy,
            totalDecisions: this.stats.totalDecisions,
            domains: assessments.sort((a, b) => b.trials - a.trials),
            strongest: assessments.sort((a, b) => b.score - a.score).slice(0, 3),
            weakest: assessments.sort((a, b) => a.score - b.score).slice(0, 3)
        };
    }

    /**
     * 标记不确定性领域
     * @param {string} topic
     * @param {number} confidence
     */
    markUncertainty(topic, confidence = 0) {
        const existing = this._uncertaintyFlags.get(topic);
        if (existing) {
            existing.encounters++;
            existing.confidence = (existing.confidence + confidence) / 2;
            existing.lastSeen = new Date().toISOString();
        } else {
            this._uncertaintyFlags.set(topic, {
                encounters: 1,
                confidence,
                firstSeen: new Date().toISOString(),
                lastSeen: new Date().toISOString()
            });
        }
    }

    getUncertainties(minEncounters = 1) {
        const uncertainties = [];
        for (const [topic, data] of this._uncertaintyFlags) {
            if (data.encounters >= minEncounters && data.confidence < this.config.uncertaintyThreshold) {
                uncertainties.push({
                    topic,
                    encounters: data.encounters,
                    confidence: data.confidence,
                    lastSeen: data.lastSeen
                });
            }
        }
        return uncertainties.sort((a, b) => a.confidence - b.confidence);
    }

    /**
     * 给出自我评估报告
     */
    getReport() {
        const capabilities = this.assessCapability();
        const uncertainties = this.getUncertainties();

        return {
            overall: {
                totalDecisions: this.stats.totalDecisions,
                overallAccuracy: this.stats.overallAccuracy,
                calibrationError: this.stats.calibrationError,
                selfAssessments: this.stats.totalSelfAssessments
            },
            capabilities,
            uncertainties: uncertainties.slice(0, 10),
            needsImprovement: capabilities.weakest || [],
            knowledgeGaps: uncertainties.filter(u => u.encounters > 2).map(u => u.topic),
            recommendation: this._generateRecommendation(capabilities, uncertainties)
        };
    }

    getStats() {
        return {
            ...this.stats,
            decisionHistorySize: this._decisionHistory.length,
            domainsTracked: this._domainCapabilities.size,
            uncertaintyFlags: this._uncertaintyFlags.size,
            recentAccuracy: this._getRecentAccuracy(20)
        };
    }

    reset() {
        this._decisionHistory = [];
        this._calibrationData = [];
        this._domainCapabilities.clear();
        this._uncertaintyFlags.clear();
        this.stats = {
            totalDecisions: 0,
            correctDecisions: 0,
            totalSelfAssessments: 0,
            lastAssessment: null,
            overallAccuracy: 0,
            calibrationError: 0
        };
    }

    // 内部方法

    _getBaseConfidence(domain) {
        if (!domain) return 0.5;

        const cap = this._domainCapabilities.get(domain);
        if (!cap || cap.trials < this.config.minSamplesForAssessment) {
            return 0.4; // 未知领域保守估计
        }

        return cap.score;
    }

    _assessInfoCompleteness(context) {
        // 评估决策所需信息的完整度
        if (!context || Object.keys(context).length === 0) return 0.3;

        let score = 0.3;
        const hasCurrentState = context.currentState || context.state;
        const hasHistory = context.recentHistory || context.experiences;
        const hasPatterns = context.matchedPatterns;
        const hasProfile = context.carrierProfile;

        if (hasCurrentState) score += 0.2;
        if (hasHistory) score += 0.15;
        if (hasPatterns) score += 0.15;
        if (hasProfile) score += 0.2;

        return Math.min(1, score);
    }

    _assessExperienceRichness(context) {
        const experienceCount = context.experienceCount || context.experiences?.length || 0;
        if (experienceCount === 0) return 0.1;
        if (experienceCount < 5) return 0.2;
        if (experienceCount < 20) return 0.4;
        if (experienceCount < 50) return 0.6;
        if (experienceCount < 200) return 0.8;
        return 0.95;
    }

    _assessSituationFamiliarity(context) {
        // 情境熟悉度基于模式匹配和历史相似度
        const matchedPatterns = context.matchedPatterns || [];
        const similarCount = context.similarCount || 0;

        if (matchedPatterns.length > 0 && similarCount > 5) return 0.9;
        if (matchedPatterns.length > 0) return 0.6;
        if (similarCount > 3) return 0.5;
        if (similarCount > 0) return 0.3;
        return 0.1;
    }

    _assessUncertainty(decision, context) {
        // 计算不确定性
        if (!decision || !context) return 0.5;

        const decisionStr = typeof decision === 'string' ? decision :
            (decision.action || decision.decision || decision.type || JSON.stringify(decision));

        // 检查是否有标记的不确定性
        for (const [topic, data] of this._uncertaintyFlags) {
            if (decisionStr.toLowerCase().includes(topic.toLowerCase())) {
                return Math.max(0.3, 1 - data.confidence);
            }
        }

        // 信息不足时的高不确定性
        if (!context.experiences && !context.recentHistory) return 0.6;
        if (!context.currentState) return 0.4;

        return 0.2;
    }

    _calibrateConfidence(rawConfidence, domain) {
        // 用历史校准数据调整自信度
        if (this._calibrationData.length < 10) return rawConfidence;

        // 找相似自信度的历史数据
        const similar = this._calibrationData.filter(d =>
            Math.abs(d.confidence - rawConfidence) < 0.15
        );

        if (similar.length < 3) return rawConfidence;

        const actualAccuracy = similar.filter(d => d.correct).length / similar.length;

        // 如果系统高估了自己，降低自信度；反之亦然
        const bias = rawConfidence - actualAccuracy;
        const calibrated = rawConfidence - bias * 0.5;

        return Math.max(0, Math.min(1, calibrated));
    }

    _updateDomainCapability(domain, success) {
        if (!this._domainCapabilities.has(domain)) {
            this._domainCapabilities.set(domain, {
                score: 0.5,
                trials: 0,
                successes: 0
            });
        }

        const cap = this._domainCapabilities.get(domain);
        cap.trials++;
        if (success) cap.successes++;

        // 在线学习更新能力评分
        const lr = this.config.domainLearningRate;
        cap.score = cap.score * (1 - lr) + (success ? 1 : 0) * lr;
    }

    _computeCalibrationError() {
        if (this._calibrationData.length < 10) return;

        // 计算校准误差 (Expected Calibration Error)
        const bins = 5;
        const binSize = 1 / bins;
        let totalError = 0;

        for (let i = 0; i < bins; i++) {
            const low = i * binSize;
            const high = (i + 1) * binSize;

            const bin = this._calibrationData.filter(d =>
                d.confidence >= low && d.confidence < high
            );

            if (bin.length > 0) {
                const avgConfidence = bin.reduce((sum, d) => sum + d.confidence, 0) / bin.length;
                const accuracy = bin.filter(d => d.correct).length / bin.length;
                totalError += Math.abs(avgConfidence - accuracy) * (bin.length / this._calibrationData.length);
            }
        }

        this.stats.calibrationError = totalError;
    }

    _getRecentAccuracy(n) {
        if (this._decisionHistory.length === 0) return 0;
        const recent = this._decisionHistory.slice(-n);
        return recent.filter(d => d.actualSuccess).length / recent.length;
    }

    _generateCapabilityAssessment(cap, reliability) {
        if (cap.score > 0.8) return '擅长此领域';
        if (cap.score > 0.6) return '能力良好';
        if (cap.score > 0.4) return '基本胜任';
        if (cap.score > 0.2) return '需要改进';
        return '表现不佳，建议寻求帮助';
    }

    _generateRecommendation(capabilities, uncertainties) {
        const recs = [];

        if (this.stats.totalDecisions < 10) {
            recs.push('系统处于早期学习阶段，建议从简单决策开始积累经验');
        }
        if (this.stats.calibrationError > 0.2) {
            recs.push('自信度校准误差较大，系统可能高估或低估自身能力');
        }
        if (capabilities.weakest && capabilities.weakest.length > 0) {
            const weakDomains = capabilities.weakest.map(d => d.domain).join('、');
            recs.push(`在${weakDomains}领域表现较弱，建议在这些场景中谨慎决策`);
        }
        if (uncertainties.length > 3) {
            recs.push(`存在${uncertainties.length}个不确定性领域，需要更多数据来降低不确定性`);
        }

        return recs.length > 0 ? recs : ['系统运行正常，各领域能力评估持续优化中'];
    }
}

module.exports = SelfAssessor;
