// FeedbackProcessor — 反馈处理器

class FeedbackProcessor {
    constructor(options = {}) {
        this.debug = options.debug || false;
        this.strategyLibrary = options.strategyLibrary || null;
        this.selfAssessor = options.selfAssessor || null;

        this._failurePatterns = new Map();    // patternKey → { count, examples, lesson }
        this._recentFailures = [];
        this._resolvedLessons = new Set();

        this.config = {
            maxRecentFailures: 100,
            minFailuresForPattern: 3,
            maxStoredLessons: 200,
            warningThreshold: 5
        };

        this.stats = {
            totalFailuresProcessed: 0,
            lessonsExtracted: 0,
            activeFailurePatterns: 0,
            strategyCorrections: 0,
            warningsIssued: 0,
            lastProcessTime: null
        };
    }

    // 公共接口

    /**
     * 处理一次执行反馈
     * @param {object} execution - 执行记录 { context, action, result, timestamp }
     * @returns {object} 处理结果
     */
    async process(execution) {
        if (!execution) return { processed: false };

        const isFailure = !execution.result?.success &&
            (execution.result?.error || execution.result?.success === false);

        if (!isFailure) return { processed: true, isFailure: false };

        this.stats.totalFailuresProcessed++;

        // 1. 分析失败原因
        const analysis = this._analyzeFailure(execution);

        // 2. 记录失败
        this._recordFailure(execution, analysis);

        // 3. 检查是否形成失败模式
        const pattern = this._checkFailurePattern(execution, analysis);

        // 4. 如果形成模式，提取教训
        let lesson = null;
        if (pattern) {
            lesson = this._extractLesson(pattern);
            if (lesson) {
                this.stats.lessonsExtracted++;
                this.stats.activeFailurePatterns = this._failurePatterns.size;

                // 更新策略库
                if (this.strategyLibrary && pattern.count >= this.config.minFailuresForPattern) {
                    this.strategyLibrary.learnFromExecution(
                        execution.context || 'unknown',
                        execution.action || 'unknown',
                        false,  // 标记为失败策略
                        { error: analysis.rootCause, lesson: lesson.text, isFailurePattern: true }
                    );
                    this.stats.strategyCorrections++;
                }
            }
        }

        // 5. 检查是否需要发出警告
        const warning = pattern && pattern.count >= this.config.warningThreshold ?
            this._issueWarning(pattern) : null;

        // 6. 更新 SelfAssessor
        if (this.selfAssessor) {
            this.selfAssessor.recordOutcome(
                { action: execution.action, domain: execution.domain || 'general', confidence: 0.5 },
                { success: false, error: execution.result?.error }
            );
            if (analysis.rootCause) {
                this.selfAssessor.markUncertainty(analysis.rootCause, 0.2);
            }
        }

        this.stats.lastProcessTime = new Date().toISOString();

        return {
            processed: true,
            isFailure: true,
            analysis,
            patternDetected: !!pattern,
            patternCount: pattern?.count || 0,
            lesson,
            warning,
            rootCause: analysis.rootCause
        };
    }

    /**
     * 批量处理反馈
     */
    async processBatch(executions) {
        let failures = 0, lessons = 0, warnings = 0;

        for (const exec of executions) {
            const result = await this.process(exec);
            if (result.isFailure) failures++;
            if (result.lesson) lessons++;
            if (result.warning) warnings++;
        }

        return { failures, lessons, warnings };
    }

    /**
     * 获取失败模式分析
     */
    getFailurePatterns(minCount = 2) {
        const patterns = [];
        for (const [key, data] of this._failurePatterns) {
            if (data.count >= minCount) {
                patterns.push({
                    key,
                    count: data.count,
                    lastSeen: data.lastSeen,
                    examples: data.examples.slice(0, 3),
                    lesson: data.lesson,
                    resolved: this._resolvedLessons.has(key)
                });
            }
        }
        return patterns.sort((a, b) => b.count - a.count);
    }

    getLessons() {
        const lessons = [];
        for (const [key, data] of this._failurePatterns) {
            if (data.lesson && this._resolvedLessons.has(key)) {
                lessons.push(data.lesson);
            }
        }
        return lessons;
    }

    markResolved(lessonKey) {
        this._resolvedLessons.add(lessonKey);
        return true;
    }

    /**
     * 生成反馈报告
     */
    getReport() {
        const patterns = this.getFailurePatterns(1);
        const topFailures = patterns.slice(0, 5);

        return {
            stats: this.stats,
            activePatterns: patterns.length,
            criticalPatterns: patterns.filter(p => p.count >= this.config.warningThreshold).length,
            topFailures: topFailures.map(p => ({
                pattern: p.key,
                count: p.count,
                lesson: p.lesson?.text || '待提取'
            })),
            unresolvedLessons: patterns.filter(p => !this._resolvedLessons.has(p.key)).length,
            health: patterns.length === 0 ? 'healthy' :
                patterns.some(p => p.count >= this.config.warningThreshold) ? 'needs_attention' : 'stable'
        };
    }

    getStats() {
        return {
            ...this.stats,
            failurePatternsCount: this._failurePatterns.size,
            recentFailuresCount: this._recentFailures.length,
            resolvedLessons: this._resolvedLessons.size
        };
    }

    reset() {
        this._failurePatterns.clear();
        this._recentFailures = [];
        this._resolvedLessons.clear();
        this.stats = { totalFailuresProcessed: 0, lessonsExtracted: 0, activeFailurePatterns: 0, strategyCorrections: 0, warningsIssued: 0, lastProcessTime: null };
    }

    // 内部方法

    _analyzeFailure(execution) {
        const error = execution.result?.error || execution.result?.message || 'unknown_error';
        const action = execution.action || 'unknown';
        const context = execution.context || '';

        let category = 'unknown';
        let rootCause = error;

        // 错误分类
        const errorStr = String(error).toLowerCase();

        if (errorStr.includes('timeout') || errorStr.includes('timed out')) {
            category = 'timeout';
            rootCause = '操作超时';
        } else if (errorStr.includes('permission') || errorStr.includes('denied') || errorStr.includes('无权')) {
            category = 'permission';
            rootCause = '权限不足';
        } else if (errorStr.includes('not found') || errorStr.includes('不存在') || errorStr.includes('missing')) {
            category = 'not_found';
            rootCause = '目标不存在';
        } else if (errorStr.includes('connect') || errorStr.includes('refused') || errorStr.includes('网络')) {
            category = 'network';
            rootCause = '网络连接失败';
        } else if (errorStr.includes('memory') || errorStr.includes('内存')) {
            category = 'resource';
            rootCause = '内存不足';
        } else if (errorStr.includes('disk') || errorStr.includes('disk') || errorStr.includes('空间')) {
            category = 'resource';
            rootCause = '磁盘空间不足';
        } else if (errorStr.includes('invalid') || errorStr.includes('invalid') || errorStr.includes('参数')) {
            category = 'invalid_input';
            rootCause = '无效参数';
        }

        return {
            category,
            rootCause,
            error: error.substring(0, 200),
            action,
            recoverable: !['permission', 'not_found'].includes(category)
        };
    }

    _recordFailure(execution, analysis) {
        this._recentFailures.push({
            timestamp: execution.timestamp || new Date().toISOString(),
            context: execution.context,
            action: execution.action,
            analysis
        });

        if (this._recentFailures.length > this.config.maxRecentFailures) {
            this._recentFailures = this._recentFailures.slice(-this.config.maxRecentFailures);
        }
    }

    _checkFailurePattern(execution, analysis) {
        const patternKey = `${execution.context || 'unknown'}|${analysis.rootCause}`;

        if (!this._failurePatterns.has(patternKey)) {
            this._failurePatterns.set(patternKey, {
                count: 0,
                firstSeen: new Date().toISOString(),
                lastSeen: new Date().toISOString(),
                examples: [],
                lesson: null,
                category: analysis.category
            });
        }

        const pattern = this._failurePatterns.get(patternKey);
        pattern.count++;
        pattern.lastSeen = new Date().toISOString();
        pattern.examples.push({
            action: execution.action,
            error: analysis.error,
            time: new Date().toISOString()
        });
        if (pattern.examples.length > 5) {
            pattern.examples = pattern.examples.slice(-5);
        }

        if (pattern.count >= this.config.minFailuresForPattern) {
            return pattern;
        }

        return null;
    }

    _extractLesson(pattern) {
        if (pattern.lesson) return pattern.lesson;

        let text = '';
        let action = '';
        const category = pattern.category || 'unknown';

        switch (category) {
            case 'timeout':
                text = `${pattern.count}次超时失败，建议增加等待时间或检查系统负载`;
                action = '调整超时配置，或在低负载时重试';
                break;
            case 'permission':
                text = `${pattern.count}次权限失败，需要请求更高权限或使用替代方案`;
                action = '申请权限或寻找免权限的替代操作';
                break;
            case 'not_found':
                text = `${pattern.count}次目标不存在，建议先检查目标是否存在再操作`;
                action = '操作前增加存在性检查步骤';
                break;
            case 'network':
                text = `${pattern.count}次网络失败，建议检查网络连接或使用离线模式`;
                action = '执行前检测网络状态，失败时切离线模式';
                break;
            case 'resource':
                text = `${pattern.count}次资源不足，建议在操作前检查资源使用情况`;
                action = '增加前置资源检查，资源不足时先清理';
                break;
            case 'invalid_input':
                text = `${pattern.count}次参数错误，建议验证输入参数后再执行`;
                action = '增加参数校验步骤';
                break;
            default:
                text = `${pattern.count}次未知错误(${pattern.examples[0]?.error?.substring(0, 60)})，建议检查环境`;
                action = '检查执行环境是否正确';
        }

        pattern.lesson = {
            text,
            suggestedAction: action,
            extractedAt: new Date().toISOString(),
            key: this._lessonKey(pattern)
        };

        this._resolvedLessons.add(pattern.lesson.key);

        return pattern.lesson;
    }

    _issueWarning(pattern) {
        this.stats.warningsIssued++;

        return {
            type: 'repeated_failure_warning',
            severity: pattern.count >= this.config.warningThreshold * 2 ? 'critical' : 'warning',
            pattern: pattern.key,
            count: pattern.count,
            category: pattern.category,
            message: `重复失败警告: "${pattern.key}" 已失败${pattern.count}次`,
            suggestedAction: pattern.lesson?.suggestedAction || '检查环境配置',
            issuedAt: new Date().toISOString()
        };
    }

    _lessonKey(pattern) {
        const keyStr = pattern.key || pattern.category || 'unknown';
        return `lesson_${pattern.category || 'unknown'}_${String(keyStr).substring(0, 30).replace(/[^a-zA-Z0-9]/g, '_')}`;
    }
}

module.exports = FeedbackProcessor;
