// PatternDetector — 模式检测器

class PatternDetector {
    constructor(options = {}) {
        this.debug = options.debug || false;

        this._patterns = {
            temporal: [],
            correlational: [],
            sequential: [],
            anomaly: [],
            custom: []
        };

        this.config = {
            minTemporalOccurrences: 3,     // 时序模式最小出现次数
            minCorrelationStrength: 0.4,   // 关联模式最小强度
            minSequenceLength: 2,          // 序列模式最小长度
            anomalyStdDevThreshold: 2.0,   // 异常标准差阈值
            maxPatterns: 200               // 最大保存模式数
        };

        this.stats = {
            totalDetected: 0,
            lastDetection: null,
            detectionRuns: 0
        };

        this._patternHitCount = new Map();
    }

    // 公共接口

    /**
     * 对一批经验执行完整模式检测
     * @param {object[]} experiences - 经验数据数组
     * @param {object} [options]
     * @returns {object} 检测到的模式分类
     */
    detectAll(experiences, options = {}) {
        this.stats.detectionRuns++;
        this.stats.lastDetection = new Date().toISOString();

        if (!experiences || experiences.length < 2) {
            return { temporal: [], correlational: [], sequential: [], anomaly: [] };
        }

        const results = {
            temporal: this.detectTemporal(experiences, options),
            correlational: this.detectCorrelation(experiences, options),
            sequential: this.detectSequential(experiences, options),
            anomaly: this.detectAnomaly(experiences, options)
        };

        for (const [type, patterns] of Object.entries(results)) {
            for (const pattern of patterns) {
                this._addPattern(type, pattern);
            }
        }

        this.stats.totalDetected += Object.values(results).reduce((sum, p) => sum + p.length, 0);

        return results;
    }

    /**
     * 检测时序模式——特定时间重复发生的事件
     * @param {object[]} experiences
     * @returns {object[]}
     */
    detectTemporal(experiences) {
        const patterns = [];

        // 按小时分组
        const hourlyCounts = new Array(24).fill(0);
        const hourlyTypes = new Array(24).fill(null).map(() => ({}));

        for (const exp of experiences) {
            const ts = exp.timestamp || exp.time || exp.iso;
            if (!ts) continue;

            const date = new Date(ts);
            const hour = date.getHours();
            hourlyCounts[hour]++;

            const type = exp.type || 'unknown';
            hourlyTypes[hour][type] = (hourlyTypes[hour][type] || 0) + 1;
        }

        // 检测活跃时段（出现频率显著高于平均的时段）
        const avgCount = hourlyCounts.reduce((a, b) => a + b, 0) / 24;
        const threshold = avgCount * 1.5;

        for (let hour = 0; hour < 24; hour++) {
            if (hourlyCounts[hour] >= this.config.minTemporalOccurrences && hourlyCounts[hour] > threshold) {
                const dominantType = Object.entries(hourlyTypes[hour])
                    .sort((a, b) => b[1] - a[1])[0];

                patterns.push({
                    type: 'temporal',
                    subtype: 'hourly_pattern',
                    description: `${hour}时活跃度${hourlyCounts[hour]}次，超出均值${((hourlyCounts[hour] / (avgCount || 1) - 1) * 100).toFixed(0)}%`,
                    hour,
                    count: hourlyCounts[hour],
                    dominantType: dominantType ? dominantType[0] : null,
                    confidence: Math.min(0.9, 0.3 + (hourlyCounts[hour] / (this.config.minTemporalOccurrences + 10)) * 0.5),
                    detectedAt: new Date().toISOString()
                });
            }
        }

        // 检测按天分布的周期模式
        const dayCounts = new Array(7).fill(0);
        for (const exp of experiences) {
            const ts = exp.timestamp || exp.time || exp.iso;
            if (!ts) continue;
            const day = new Date(ts).getDay();
            dayCounts[day]++;
        }

        const avgDay = dayCounts.reduce((a, b) => a + b, 0) / 7;
        for (let day = 0; day < 7; day++) {
            if (dayCounts[day] > avgDay * 1.5 && dayCounts[day] >= this.config.minTemporalOccurrences) {
                const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
                patterns.push({
                    type: 'temporal',
                    subtype: 'weekly_pattern',
                    description: `${dayNames[day]}活跃度高于均值`,
                    day,
                    count: dayCounts[day],
                    confidence: Math.min(0.7, 0.3 + (dayCounts[day] / (this.config.minTemporalOccurrences + 20)) * 0.3),
                    detectedAt: new Date().toISOString()
                });
            }
        }

        return patterns;
    }

    /**
     * 检测关联模式——同时或先后出现的关联事件
     * @param {object[]} experiences
     * @returns {object[]}
     */
    detectCorrelation(experiences) {
        const patterns = [];

        // 提取所有类型标签
        const typeInstances = {};
        const tagInstances = {};

        for (const exp of experiences) {
            const type = exp.type || 'unknown';
            if (!typeInstances[type]) typeInstances[type] = 0;
            typeInstances[type]++;

            // 标签关联
            const tags = exp.tags || [];
            for (const tag of tags) {
                if (!tagInstances[tag]) tagInstances[tag] = 0;
                tagInstances[tag]++;
            }
        }

        // 类型关联（一种类型出现时，另一种也经常出现）
        const types = Object.keys(typeInstances);
        for (let i = 0; i < types.length; i++) {
            for (let j = i + 1; j < types.length; j++) {
                const countA = typeInstances[types[i]];
                const countB = typeInstances[types[j]];
                const minCount = Math.min(countA, countB);

                if (minCount < 2) continue;

                const cooccurrence = minCount; // 简化计算
                const strength = cooccurrence / (countA + countB - cooccurrence);

                if (strength >= this.config.minCorrelationStrength) {
                    patterns.push({
                        type: 'correlational',
                        subtype: 'type_association',
                        description: `"${types[i]}"与"${types[j]}"经常共同出现`,
                        items: [types[i], types[j]],
                        strength,
                        countA,
                        countB,
                        confidence: Math.min(0.85, strength),
                        detectedAt: new Date().toISOString()
                    });
                }
            }
        }

        // 标签关联（两个标签经常一起出现）
        const tags = Object.keys(tagInstances).filter(t => tagInstances[t] >= 2);
        for (let i = 0; i < Math.min(tags.length, 20); i++) {
            for (let j = i + 1; j < Math.min(tags.length, 20); j++) {
                const countBoth = experiences.filter(e => {
                    const et = e.tags || [];
                    return et.includes(tags[i]) && et.includes(tags[j]);
                }).length;

                if (countBoth < 2) continue;
                const strength = countBoth / experiences.length;

                if (strength >= this.config.minCorrelationStrength * 0.8) {
                    patterns.push({
                        type: 'correlational',
                        subtype: 'tag_association',
                        description: `标签"${tags[i]}"与"${tags[j]}"关联`,
                        items: [tags[i], tags[j]],
                        strength,
                        count: countBoth,
                        confidence: Math.min(0.8, strength),
                        detectedAt: new Date().toISOString()
                    });
                }
            }
        }

        return patterns;
    }

    /**
     * 检测序列模式——固定顺序发生的事件链
     * @param {object[]} experiences
     * @returns {object[]}
     */
    detectSequential(experiences) {
        const patterns = [];

        // 按时间排序
        const sorted = [...experiences]
            .filter(e => e.timestamp || e.time || e.timestampEpoch)
            .sort((a, b) => {
                const ta = a.timestamp || a.time || a.timestampEpoch;
                const tb = b.timestamp || b.time || b.timestampEpoch;
                return new Date(ta).getTime() - new Date(tb).getTime();
            });

        if (sorted.length < 3) return patterns;

        // 提取类型序列
        const typeSequence = sorted.map(e => e.type || 'unknown');

        // 检测2-序列模式 (A → B)
        const bigramCounts = {};
        for (let i = 0; i < typeSequence.length - 1; i++) {
            const key = `${typeSequence[i]}→${typeSequence[i + 1]}`;
            bigramCounts[key] = (bigramCounts[key] || 0) + 1;
        }

        for (const [seq, count] of Object.entries(bigramCounts)) {
            if (count >= this.config.minSequenceLength) {
                const [a, b] = seq.split('→');
                patterns.push({
                    type: 'sequential',
                    subtype: 'bigram',
                    description: `"${a}"之后通常出现"${b}"`,
                    sequence: [a, b],
                    count,
                    confidence: Math.min(0.7, 0.3 + count * 0.05),
                    detectedAt: new Date().toISOString()
                });
            }
        }

        // 检测3-序列模式 (A → B → C)
        const trigramCounts = {};
        for (let i = 0; i < typeSequence.length - 2; i++) {
            const key = `${typeSequence[i]}→${typeSequence[i + 1]}→${typeSequence[i + 2]}`;
            trigramCounts[key] = (trigramCounts[key] || 0) + 1;
        }

        for (const [seq, count] of Object.entries(trigramCounts)) {
            if (count >= 2) {
                patterns.push({
                    type: 'sequential',
                    subtype: 'trigram',
                    description: `出现序列: ${seq}`,
                    sequence: seq.split('→'),
                    count,
                    confidence: Math.min(0.6, 0.2 + count * 0.08),
                    detectedAt: new Date().toISOString()
                });
            }
        }

        return patterns;
    }

    /**
     * 检测异常模式——偏离正常状态的离群行为
     * @param {object[]} experiences
     * @returns {object[]}
     */
    detectAnomaly(experiences) {
        const patterns = [];

        // 收集数值字段
        const numericFields = {};
        for (const exp of experiences) {
            this._collectNumericFields(exp, '', numericFields);
        }

        // 对每个数值字段计算统计并检测异常
        for (const [field, values] of Object.entries(numericFields)) {
            if (values.length < 4) continue;

            const avg = values.reduce((a, b) => a + b, 0) / values.length;
            const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
            const stdDev = Math.sqrt(variance);

            if (stdDev === 0) continue;

            // 检测异常值
            const anomalies = [];
            for (let i = 0; i < values.length; i++) {
                const zScore = Math.abs(values[i] - avg) / stdDev;
                if (zScore > this.config.anomalyStdDevThreshold) {
                    anomalies.push({ index: i, value: values[i], zScore });
                }
            }

            // 如果该字段经常出现异常，记为一个异常模式
            if (anomalies.length >= 2) {
                patterns.push({
                    type: 'anomaly',
                    subtype: 'value_anomaly',
                    description: `字段"${field}"有${anomalies.length}次异常值（正常范围: ${(avg - stdDev).toFixed(1)}~${(avg + stdDev).toFixed(1)}）`,
                    field,
                    normalRange: {
                        min: (avg - stdDev * 2).toFixed(1),
                        max: (avg + stdDev * 2).toFixed(1),
                        avg: avg.toFixed(1)
                    },
                    anomalyCount: anomalies.length,
                    totalCount: values.length,
                    ratio: (anomalies.length / values.length * 100).toFixed(0) + '%',
                    severity: anomalies.length / values.length > 0.3 ? 'high' : 'medium',
                    confidence: Math.min(0.8, 0.3 + (anomalies.length / values.length)),
                    detectedAt: new Date().toISOString()
                });
            }
        }

        // 检测类型异常（出现频率突然变化的类型）
        const typeCounts = {};
        for (const exp of experiences) {
            const type = exp.type || 'unknown';
            if (!typeCounts[type]) typeCounts[type] = 0;
            typeCounts[type]++;
        }

        // 如果有非常罕见的类型，标记为潜在异常
        const total = experiences.length;
        for (const [type, count] of Object.entries(typeCounts)) {
            if (count === 1 && total > 20) {
                patterns.push({
                    type: 'anomaly',
                    subtype: 'rare_type',
                    description: `类型"${type}"仅出现1次（总数${total}）`,
                    rareType: type,
                    count: 1,
                    total,
                    severity: 'low',
                    confidence: 0.3,
                    detectedAt: new Date().toISOString()
                });
            }
        }

        return patterns;
    }

    /**
     * 根据当前情境匹配已知模式
     * @param {object} situation - 当前情境
     * @param {object} [options]
     * @returns {object[]} 匹配的模式
     */
    matchSituation(situation, options = {}) {
        const matched = [];
        const sitStr = JSON.stringify(situation).toLowerCase();
        const hour = new Date().getHours();
        const day = new Date().getDay();

        // 匹配时序模式
        for (const p of this._patterns.temporal) {
            if (p.subtype === 'hourly_pattern' && p.hour === hour) {
                matched.push({ ...p, matchType: 'current_hour', relevance: 'high' });
            }
            if (p.subtype === 'weekly_pattern' && p.day === day) {
                matched.push({ ...p, matchType: 'current_day', relevance: 'medium' });
            }
        }

        // 匹配关联模式
        for (const p of this._patterns.correlational) {
            if (p.items && p.items.some(item => sitStr.includes(item.toLowerCase()))) {
                matched.push({ ...p, matchType: 'keyword_match', relevance: 'medium' });
            }
        }

        // 匹配异常模式
        for (const p of this._patterns.anomaly) {
            if (p.subtype === 'value_anomaly' && sitStr.includes(p.field.toLowerCase())) {
                matched.push({ ...p, matchType: 'field_match', relevance: 'high' });
            }
        }

        // 按相关度排序
        const relevanceOrder = { high: 3, medium: 2, low: 1 };
        matched.sort((a, b) => (relevanceOrder[b.relevance] || 0) - (relevanceOrder[a.relevance] || 0));

        return matched;
    }

    getAllPatterns() {
        return this._patterns;
    }

    getPatternsByType(type) {
        return this._patterns[type] || [];
    }

    getHighConfidencePatterns(minConfidence = 0.6) {
        const result = [];
        for (const patterns of Object.values(this._patterns)) {
            for (const p of patterns) {
                if (p.confidence >= minConfidence) {
                    result.push(p);
                }
            }
        }
        return result.sort((a, b) => b.confidence - a.confidence);
    }

    getStats() {
        return {
            ...this.stats,
            totalPatterns: Object.values(this._patterns).reduce((sum, p) => sum + p.length, 0),
            byType: Object.fromEntries(
                Object.entries(this._patterns).map(([k, v]) => [k, v.length])
            ),
            config: this.config
        };
    }

    reset() {
        this._patterns = { temporal: [], correlational: [], sequential: [], anomaly: [], custom: [] };
        this._patternHitCount.clear();
        this.stats.totalDetected = 0;
    }

    // 内部方法

    _addPattern(type, pattern) {
        const list = this._patterns[type] || this._patterns.custom;
        const key = pattern.description || JSON.stringify(pattern);

        // 去重（检查是否已有相似的）
        const duplicate = list.some(p => {
            const pk = p.description || '';
            return pk === key || (p.subtype === pattern.subtype && JSON.stringify(p.items) === JSON.stringify(pattern.items));
        });

        if (!duplicate) {
            list.push(pattern);

            // 限制数量
            if (list.length > this.config.maxPatterns) {
                // 移除最旧的 20%
                list.splice(0, Math.floor(this.config.maxPatterns * 0.2));
            }
        } else {
            // 更新已有模式的命中计数
            this._patternHitCount.set(key, (this._patternHitCount.get(key) || 0) + 1);
        }
    }

    _collectNumericFields(obj, prefix, result) {
        if (!obj || typeof obj !== 'object') return;

        for (const [key, value] of Object.entries(obj)) {
            const fieldPath = prefix ? `${prefix}.${key}` : key;
            if (typeof value === 'number') {
                if (!result[fieldPath]) result[fieldPath] = [];
                result[fieldPath].push(value);
            } else if (typeof value === 'object' && value !== null) {
                this._collectNumericFields(value, fieldPath, result);
            }
        }
    }
}

module.exports = PatternDetector;
