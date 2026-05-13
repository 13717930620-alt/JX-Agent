// DecisionEngine — 自主决策层

class DecisionEngine {
    constructor(options = {}) {
        this.debug = options.debug || false;

        this.engines = {
            cognitiveFramework: null,
            reasoningEngine: null,
            patternDetector: null,
            conceptBuilder: null,
            selfAssessor: null,
            strategyLibrary: null,
            knowledgeGraph: null,
            patternLibrary: null,
            experienceDB: null,
            carrierProfile: null,
            feedbackProcessor: null
        };

        this.thresholds = {
            autonomous: options.autonomousThreshold || 0.75,  // ≥65% → 自主决策
            advisory: options.advisoryThreshold || 0.35,      // 35-65% → 建议模式
            // <35% → 求助模式
        };

        this.safety = {
            blockedActions: options.blockedActions || [
                'shutdown', 'reboot', 'format_disk', 'delete_system_file',
                'modify_registry_critical', 'install_driver'
            ],
            requireConfirmActions: options.requireConfirmActions || [
                'delete_file', 'modify_registry', 'install_software',
                'uninstall_software', 'execute_powershell'
            ],
            maxRiskLevel: options.maxRiskLevel || 0.7
        };

        this.stats = {
            totalDecisions: 0,
            autonomousCount: 0,
            advisoryCount: 0,
            helpCount: 0,
            executedCount: 0,
            safetyBlocks: 0,
            lastDecision: null
        };
    }

    inject(engineRefs) {
        Object.assign(this.engines, engineRefs);
    }

    /**
     * 执行完整决策流程
     * @param {object} input - { situation, context, options }
     * @returns {object} 决策结果
     */
    async decide(input) {
        this.stats.totalDecisions++;

        const startTime = Date.now();
        const situation = input.situation || input;
        const context = input.context || {};
        const userIntent = context.intent || input.intent || null;

        // 1. 解析情境
        const parsed = this._parseInput(situation);

        // 2. 从认知框架获取分析
        const analysis = await this._getCognitiveAnalysis(parsed, context);

        // 3. 生成可行方案
        const options = await this._generateOptions(parsed, analysis);

        // 4. 安全评估
        const safetyCheck = this._checkSafety(options, context);

        // 5. 方案评分
        const scored = this._scoreOptions(options, analysis, safetyCheck);

        // 6. 确定决策模式
        const mode = this._determineMode(scored);

        // 7. 选择最终方案
        const selection = this._selectOption(scored, mode);

        // 8. 执行计划
        const plan = this._generatePlan(selection, parsed);

        const elapsed = Date.now() - startTime;

        // 9. 记录决策
        this._recordDecision(mode, selection, elapsed);

        const result = {
            decision: {
                action: selection.action,
                reason: selection.reason,
                confidence: selection.confidence,
                mode,
                plan
            },
            alternatives: scored.slice(0, 3).map(s => ({
                action: s.action,
                score: s.score,
                reason: s.reason
            })),
            analysis: {
                conclusion: analysis.conclusion,
                keyFactors: analysis.factors,
                matchedPatterns: analysis.patterns
            },
            safety: {
                passed: safetyCheck.passed,
                riskLevel: safetyCheck.riskLevel,
                warnings: safetyCheck.warnings
            },
            mode,
            metadata: {
                elapsed,
                totalOptions: scored.length,
                decisionNumber: this.stats.totalDecisions
            }
        };

        this.stats.lastDecision = result;

        if (this.debug) {
            console.log(`[DecisionEngine] 决策完成: ${selection.action.substring(0, 50)} (${mode}, ${(selection.confidence * 100).toFixed(0)}%)`);
        }

        return result;
    }

    /**
     * 执行决策并跟踪结果
     */
    async decideAndExecute(input, executor) {
        const decision = await this.decide(input);

        if (decision.safety.passed && decision.mode !== 'help') {
            // 执行
            try {
                const execResult = await executor(decision.decision.action, decision.decision.plan);
                decision.execution = { success: true, result: execResult };
                this.stats.executedCount++;

                // 记录到反馈处理器
                if (this.engines.feedbackProcessor) {
                    await this.engines.feedbackProcessor.process({
                        context: input.context?.domain || 'decision',
                        action: decision.decision.action,
                        result: { success: true, data: execResult },
                        domain: input.context?.domain || 'general'
                    });
                }
            } catch (e) {
                decision.execution = { success: false, error: e.message };

                if (this.engines.feedbackProcessor) {
                    await this.engines.feedbackProcessor.process({
                        context: input.context?.domain || 'decision',
                        action: decision.decision.action,
                        result: { success: false, error: e.message },
                        domain: input.context?.domain || 'general'
                    });
                }
            }
        }

        return decision;
    }

    /**
     * 快速决策（跳过完整分析，直接基于规则）
     */
    async quickDecide(situation) {
        const parsed = this._parseInput(situation);

        // 直接从策略库获取最佳匹配
        if (this.engines.strategyLibrary) {
            const strategies = this.engines.strategyLibrary.recommend(parsed, { limit: 3 });
            if (strategies.length > 0 && strategies[0].successRate > 0.7) {
                const best = strategies[0];
                return {
                    decision: {
                        action: best.action,
                        reason: `基于历史策略(成功率${(best.successRate * 100).toFixed(0)}%)`,
                        confidence: best.successRate * 0.85,
                        mode: best.successRate > 0.8 ? 'autonomous' : 'advisory',
                        plan: { steps: [best.action] }
                    },
                    alternatives: strategies.slice(0, 3).map(s => ({
                        action: s.action, score: s.successRate, reason: `${(s.successRate * 100).toFixed(0)}%成功率`
                    })),
                    mode: best.successRate > 0.8 ? 'autonomous' : 'advisory',
                    quick: true
                };
            }
        }

        // 无匹配时退化到完整决策
        return this.decide(situation);
    }

    // 内部决策流程

    async _getCognitiveAnalysis(parsed, context) {
        const cf = this.engines.cognitiveFramework;
        if (!cf) {
            return { conclusion: parsed.summary, factors: [], patterns: [] };
        }

        // 通过认知框架进行完整分析
        const thought = await cf.think(parsed.raw || parsed.summary, {
            domain: context.domain || 'general',
            state: context.state || {}
        });

        return {
            conclusion: thought.analysis.conclusion,
            factors: thought.analysis.keyFactors || [],
            patterns: thought.analysis.patterns || [],
            confidence: thought.confidence,
            reasoningMethod: thought.analysis.reasoningMethod
        };
    }

    async _generateOptions(parsed, analysis) {
        const options = [];
        const sitStr = typeof parsed === 'string' ? parsed : (parsed.summary || JSON.stringify(parsed));

        // 1. 从策略库获取
        if (this.engines.strategyLibrary) {
            const strategies = this.engines.strategyLibrary.recommend(parsed, { limit: 5 });
            for (const s of strategies) {
                options.push({
                    action: s.action,
                    source: 'strategy_library',
                    score: s.score,
                    confidence: s.successRate,
                    executionCount: s.executions,
                    reason: `策略库推荐(${(s.successRate * 100).toFixed(0)}%成功率)`
                });
            }
        }

        // 2. 从模式匹配获取
        if (this.engines.patternLibrary) {
            const patterns = this.engines.patternLibrary.matchSituation(parsed);
            for (const p of patterns.slice(0, 3)) {
                const action = `遵循_${p.description?.substring(0, 30) || 'pattern'}`;
                if (!options.find(o => o.action === action)) {
                    options.push({
                        action,
                        source: 'pattern_library',
                        score: p.matchScore || 0.5,
                        confidence: p.reliability || 0.4,
                        executionCount: p.hitCount || 0,
                        reason: `模式匹配: ${p.description?.substring(0, 40)}`
                    });
                }
            }
        }

        // 3. 默认观测选项
        if (options.length === 0) {
            options.push({
                action: 'respond_naturally',
                source: 'default',
                score: 0.3,
                confidence: 0.5,
                executionCount: 0,
                reason: '缺乏可靠策略，默认回复用户'
            });
        }

        return options;
    }

    _checkSafety(options, context) {
        const warnings = [];
        let riskLevel = 0;
        let passed = true;

        for (const opt of options) {
            const action = opt.action.toLowerCase();

            // 检查被阻止的操作
            for (const blocked of this.safety.blockedActions) {
                if (action.includes(blocked.toLowerCase())) {
                    warnings.push(`操作"${opt.action}"被安全策略阻止`);
                    opt.blocked = true;
                    riskLevel = 1.0;
                    passed = false;
                    this.stats.safetyBlocks++;
                }
            }

            // 检查需要确认的操作
            for (const confirm of this.safety.requireConfirmActions) {
                if (action.includes(confirm.toLowerCase())) {
                    warnings.push(`操作"${opt.action}"需要用户确认`);
                    opt.requiresConfirm = true;
                    riskLevel = Math.max(riskLevel, 0.5);
                }
            }
        }

        // 总体风险 = 操作风险 + 上下文风险
        if (context.urgency === 'high') riskLevel = Math.min(1, riskLevel + 0.1);
        if (context.impact === 'high') riskLevel = Math.min(1, riskLevel + 0.2);

        // 检查承载体状态
        const cp = this.engines.carrierProfile?.profile?.stateProfile;
        if (cp) {
            if (cp.cpuTypical?.avg > 85) {
                warnings.push('CPU负载过高，建议推迟非关键操作');
                riskLevel = Math.min(1, riskLevel + 0.15);
            }
            if (cp.memoryTypical?.avg > 90) {
                warnings.push('内存即将耗尽，不建议执行新操作');
                riskLevel = Math.min(1, riskLevel + 0.2);
            }
        }

        return { passed, riskLevel: Math.round(riskLevel * 100) / 100, warnings };
    }

    _scoreOptions(options, analysis, safety) {
        return options
            .filter(o => !o.blocked)
            .map(opt => {
                let score = 0;

                // 策略库推荐分
                if (opt.source === 'strategy_library') {
                    score += opt.confidence * 0.4;
                    score += Math.min(0.15, (opt.executionCount || 0) * 0.03);
                }

                // 模式匹配分
                if (opt.source === 'pattern_library') {
                    score += opt.confidence * 0.3;
                }

                // 默认保底分
                if (opt.source === 'default') {
                    score += 0.1;
                }

                // 安全扣分
                if (opt.requiresConfirm) score -= 0.1;
                if (safety.riskLevel > 0.5) score -= safety.riskLevel * 0.2;

                // 分析修正
                if (analysis.confidence && analysis.confidence > 0.6) score += 0.1;

                return {
                    ...opt,
                    score: Math.max(0, Math.min(1, score)),
                    confidence: opt.confidence || 0.3
                };
            })
            .sort((a, b) => b.score - a.score);
    }

    _determineMode(scored) {
        if (scored.length === 0) return 'help';

        const topScore = scored[0].score;

        if (topScore >= this.thresholds.autonomous) return 'autonomous';
        if (topScore >= this.thresholds.advisory) return 'advisory';
        return 'help';
    }

    _selectOption(scored, mode) {
        if (scored.length === 0) {
            return {
                action: 'request_help',
                reason: '无可行的决策方案',
                confidence: 0,
                score: 0
            };
        }

        const selected = scored[0];

        if (mode === 'help') {
            return {
                ...selected,
                action: selected.requiresConfirm ? selected.action : 'request_help',
                reason: `自信度不足(${(selected.score * 100).toFixed(0)}%)，${selected.requiresConfirm ? '需要用户确认' : '建议请求外部帮助'}`,
                confidence: selected.confidence * 0.5
            };
        }

        return {
            ...selected,
            reason: selected.reason || `基于${selected.source}决策(评分:${(selected.score * 100).toFixed(0)}%)`,
            confidence: mode === 'autonomous' ? selected.confidence : selected.confidence * 0.8
        };
    }

    _generatePlan(selection, parsed) {
        return {
            action: selection.action,
            steps: [selection.action],
            prerequisites: [],
            estimatedRisk: 1 - selection.confidence,
            requiresConfirm: selection.requiresConfirm || false,
            context: typeof parsed === 'string' ? parsed : parsed.summary
        };
    }

    _parseInput(input) {
        if (typeof input === 'string') {
            return { raw: input, summary: input.substring(0, 200) };
        }
        if (typeof input === 'object') {
            const str = input.situation || input.query || input.description || JSON.stringify(input);
            return {
                raw: input,
                summary: str.substring(0, 200),
                type: input.type || input.intent || 'unknown',
                domain: input.domain || 'general'
            };
        }
        return { raw: input, summary: String(input).substring(0, 200) };
    }

    _recordDecision(mode, selection, elapsed) {
        if (mode === 'autonomous') this.stats.autonomousCount++;
        else if (mode === 'advisory') this.stats.advisoryCount++;
        else this.stats.helpCount++;
    }

    getStats() {
        return this.stats;
    }

    getSafetyConfig() {
        return this.safety;
    }

    setSafetyConfig(config) {
        if (config.blockedActions) this.safety.blockedActions = config.blockedActions;
        if (config.requireConfirmActions) this.safety.requireConfirmActions = config.requireConfirmActions;
        if (config.maxRiskLevel) this.safety.maxRiskLevel = config.maxRiskLevel;
    }
}

module.exports = DecisionEngine;
