// ConceptBuilder — 概念构建器

class ConceptBuilder {
    constructor(options = {}) {
        this.debug = options.debug || false;

        this._concepts = new Map();       // conceptKey → Concept
        this._hierarchy = {
            concrete: new Map(),
            abstract: new Map(),
            meta: new Map()
        };

        this.config = {
            minInstancesForConcept: 3,       // 形成概念的最小实例数
            similarityThreshold: 0.5,        // 聚类相似度阈值
            maxConcepts: 300,                // 最大概念数
            autoAbstractInterval: 10,        // 每 N 个新概念尝试一次抽象
            decayDays: 30                    // 未使用的概念衰减天数
        };

        this._conceptCount = 0;
        this._abstractCycles = 0;
        this._lastAccessTimes = new Map();

        this.stats = {
            totalConcepts: 0,
            concreteCount: 0,
            abstractCount: 0,
            metaCount: 0,
            lastBuildTime: null,
            totalBuildCycles: 0
        };
    }

    // 公共接口

    /**
     * 从经验中构建概念
     * @param {object[]} experiences - 经验数据
     * @returns {object} 构建结果
     */
    buildFromExperiences(experiences) {
        this.stats.lastBuildTime = new Date().toISOString();
        this.stats.totalBuildCycles++;

        if (!experiences || experiences.length < 2) {
            return { concepts: [], changes: { created: 0, updated: 0, abstracted: 0 } };
        }

        const changes = { created: 0, updated: 0, abstracted: 0 };

        const typeGroups = this._groupByType(experiences);
        for (const [groupKey, group] of Object.entries(typeGroups)) {
            if (group.length >= this.config.minInstancesForConcept) {
                const result = this._buildOrUpdateConcept(groupKey, group, 'concrete');
                if (result.created) changes.created++;
                if (result.updated) changes.updated++;
            }
        }

        const featureClusters = this._clusterByFeatures(experiences);
        for (const cluster of featureClusters) {
            if (cluster.instances.length >= this.config.minInstancesForConcept) {
                const conceptKey = `cluster_${cluster.features.join('_')}`;
                const result = this._buildOrUpdateConcept(conceptKey, cluster.instances, 'concrete', {
                    features: cluster.features,
                    centroid: cluster.centroid
                });
                if (result.created) changes.created++;
                if (result.updated) changes.updated++;
            }
        }

        if (this._conceptCount >= this.config.minInstancesForConcept * 2 &&
            this._conceptCount % this.config.autoAbstractInterval === 0) {
            const abstracted = this._abstractToHigherLevel();
            changes.abstracted = abstracted;
        }

        // 更新统计
        this._updateStats();

        return {
            concepts: this.getConceptSummary(),
            changes
        };
    }

    /**
     * 分析一条新经验，找出它匹配的已知概念
     * @param {object} experience
     * @returns {object[]} 匹配的概念列表
     */
    matchExperience(experience) {
        const matches = [];

        for (const [key, concept] of this._concepts) {
            const similarity = this._computeConceptSimilarity(experience, concept);

            if (similarity >= this.config.similarityThreshold) {
                matches.push({
                    conceptKey: key,
                    conceptName: concept.name,
                    level: concept.level,
                    similarity,
                    attributes: concept.attributes
                });

                // 更新访问时间
                this._lastAccessTimes.set(key, Date.now());
            }
        }

        return matches.sort((a, b) => b.similarity - a.similarity);
    }

    getConceptHierarchy() {
        const hierarchy = { concrete: [], abstract: [], meta: [] };

        for (const [key, concept] of this._concepts) {
            if (concept.level === 'concrete') {
                hierarchy.concrete.push({
                    key,
                    name: concept.name,
                    instanceCount: concept.instanceCount,
                    attributes: concept.attributes
                });
            } else if (concept.level === 'abstract') {
                hierarchy.abstract.push({
                    key,
                    name: concept.name,
                    children: concept.children,
                    attributes: concept.attributes
                });
            } else if (concept.level === 'meta') {
                hierarchy.meta.push({
                    key,
                    name: concept.name,
                    children: concept.children
                });
            }
        }

        return hierarchy;
    }

    getConceptSummary() {
        const summary = [];
        for (const [key, concept] of this._concepts) {
            summary.push({
                key,
                name: concept.name,
                level: concept.level,
                instanceCount: concept.instanceCount,
                attributeCount: Object.keys(concept.attributes).length,
                createdAt: concept.createdAt,
                lastUpdated: concept.lastUpdated
            });
        }
        return summary;
    }

    getConcept(key) {
        if (this._concepts.has(key)) {
            this._lastAccessTimes.set(key, Date.now());
            return this._concepts.get(key);
        }
        return null;
    }

    searchConcepts(query) {
        const q = query.toLowerCase();
        const results = [];

        for (const [key, concept] of this._concepts) {
            if (key.toLowerCase().includes(q) ||
                concept.name.toLowerCase().includes(q) ||
                JSON.stringify(concept.attributes).toLowerCase().includes(q)) {
                results.push({ key, ...concept });
            }
        }

        return results;
    }

    getStats() {
        return {
            ...this.stats,
            conceptsByLevel: {
                concrete: this.stats.concreteCount,
                abstract: this.stats.abstractCount,
                meta: this.stats.metaCount
            },
            config: this.config,
            activeConcepts: this._lastAccessTimes.size
        };
    }

    reset() {
        this._concepts.clear();
        this._hierarchy.concrete.clear();
        this._hierarchy.abstract.clear();
        this._hierarchy.meta.clear();
        this._conceptCount = 0;
        this._abstractCycles = 0;
        this._lastAccessTimes.clear();
        this.stats = {
            totalConcepts: 0,
            concreteCount: 0,
            abstractCount: 0,
            metaCount: 0,
            lastBuildTime: null,
            totalBuildCycles: 0
        };
    }

    // 内部方法

    _groupByType(experiences) {
        const groups = {};
        const subtypeGroups = {};

        for (const exp of experiences) {
            const type = exp.type || 'unknown';

            // 按类型分组
            if (!groups[type]) groups[type] = [];
            groups[type].push(exp);

            // 按类型+子类型分组
            const subtype = exp.subtype || exp.action || exp.tool || exp.category || null;
            if (subtype) {
                const stKey = `${type}:${subtype}`;
                if (!subtypeGroups[stKey]) subtypeGroups[stKey] = [];
                subtypeGroups[stKey].push(exp);
            }
        }

        // 合并分组，优先使用子类型
        return { ...groups, ...subtypeGroups };
    }

    _clusterByFeatures(experiences) {
        const clusters = [];
        const numericExps = [];

        // 提取有数值特征的经验
        for (const exp of experiences) {
            const features = this._extractNumericFeatures(exp);
            if (Object.keys(features).length >= 2) {
                numericExps.push({ exp, features });
            }
        }

        if (numericExps.length < 3) return clusters;

        // 简单 K-Means 聚类（K=2~3）
        for (let k = 2; k <= Math.min(3, numericExps.length - 1); k++) {
            const result = this._simpleKMeans(numericExps, k);

            for (const cluster of result.clusters) {
                if (cluster.instances.length >= this.config.minInstancesForConcept) {
                    // 计算聚类特征
                    const commonFeatures = {};
                    for (const inst of cluster.instances) {
                        for (const [key, value] of Object.entries(inst.features)) {
                            if (!commonFeatures[key]) commonFeatures[key] = [];
                            commonFeatures[key].push(value);
                        }
                    }

                    const features = Object.entries(commonFeatures)
                        .filter(([_, vals]) => vals.length === cluster.instances.length)
                        .map(([key]) => key);

                    const centroid = {};
                    for (const [key, vals] of Object.entries(commonFeatures)) {
                        centroid[key] = vals.reduce((a, b) => a + b, 0) / vals.length;
                    }

                    clusters.push({
                        instances: cluster.instances.map(i => i.exp),
                        features,
                        centroid
                    });
                }
            }
        }

        return clusters;
    }

    _extractNumericFeatures(obj, prefix = '') {
        const features = {};
        if (!obj || typeof obj !== 'object') return features;

        for (const [key, value] of Object.entries(obj)) {
            const fieldPath = prefix ? `${prefix}.${key}` : key;
            if (typeof value === 'number') {
                features[fieldPath] = value;
            } else if (typeof value === 'object' && value !== null) {
                Object.assign(features, this._extractNumericFeatures(value, fieldPath));
            }
        }

        return features;
    }

    _simpleKMeans(data, k) {
        // 随机初始化质心
        const centroids = [];
        const shuffled = [...data].sort(() => Math.random() - 0.5);
        for (let i = 0; i < k; i++) {
            centroids.push({ ...shuffled[i % shuffled.length].features });
        }

        const maxIterations = 20;
        let assignments = new Array(data.length).fill(0);

        for (let iter = 0; iter < maxIterations; iter++) {
            // 分配
            let changed = false;
            for (let i = 0; i < data.length; i++) {
                let minDist = Infinity;
                let bestCluster = 0;

                for (let c = 0; c < k; c++) {
                    const dist = this._euclideanDistance(data[i].features, centroids[c]);
                    if (dist < minDist) {
                        minDist = dist;
                        bestCluster = c;
                    }
                }

                if (assignments[i] !== bestCluster) {
                    assignments[i] = bestCluster;
                    changed = true;
                }
            }

            if (!changed) break;

            // 更新质心
            const sums = new Array(k).fill(null).map(() => ({}));
            const counts = new Array(k).fill(0);

            for (let i = 0; i < data.length; i++) {
                const c = assignments[i];
                counts[c]++;
                for (const [key, value] of Object.entries(data[i].features)) {
                    if (sums[c][key] === undefined) sums[c][key] = 0;
                    sums[c][key] += value;
                }
            }

            for (let c = 0; c < k; c++) {
                if (counts[c] > 0) {
                    for (const [key, value] of Object.entries(sums[c])) {
                        centroids[c][key] = value / counts[c];
                    }
                }
            }
        }

        // 整理结果
        const clusters = new Array(k).fill(null).map(() => ({ instances: [] }));
        for (let i = 0; i < data.length; i++) {
            clusters[assignments[i]].instances.push(data[i]);
        }

        return { clusters };
    }

    _euclideanDistance(a, b) {
        const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
        let sum = 0;
        for (const key of keys) {
            const diff = (a[key] || 0) - (b[key] || 0);
            sum += diff * diff;
        }
        return Math.sqrt(sum);
    }

    _buildOrUpdateConcept(key, instances, level, extra = {}) {
        let created = false;
        let updated = false;

        if (!this._concepts.has(key)) {
            const commonAttrs = this._extractCommonAttributes(instances);
            const name = this._generateConceptName(key, instances);

            this._concepts.set(key, {
                name,
                level,
                attributes: commonAttrs,
                instanceCount: instances.length,
                instanceIds: instances.map((e, i) => e.id || `${key}_${i}`).slice(0, 100),
                children: [],
                parent: null,
                createdAt: new Date().toISOString(),
                lastUpdated: new Date().toISOString(),
                extra
            });

            this._conceptCount++;
            created = true;

            // 注册到层级
            this._hierarchy[level].set(key, true);

            if (this.debug) {
                console.log(`[ConceptBuilder] 新概念: ${name} (${level}, ${instances.length}实例)`);
            }
        } else {
            const concept = this._concepts.get(key);
            concept.instanceCount += instances.length;
            concept.lastUpdated = new Date().toISOString();

            const newAttrs = this._extractCommonAttributes(instances);
            for (const [attr, value] of Object.entries(newAttrs)) {
                if (concept.attributes[attr] === undefined) {
                    concept.attributes[attr] = value;
                }
            }

            updated = true;
        }

        return { created, updated };
    }

    _extractCommonAttributes(instances) {
        const attributes = {};

        if (instances.length === 0) return attributes;

        // 提取所有实例共有的属性
        const first = instances[0];
        if (typeof first !== 'object') return attributes;

        const keys = Object.keys(first);
        for (const key of keys) {
            if (key === 'id' || key === 'timestamp' || key === 'timestampEpoch') continue;

            const values = instances.map(e => e[key]);

            // 检查是否所有值相同
            const allSame = values.every(v => v === values[0]);
            if (allSame) {
                attributes[key] = values[0];
                continue;
            }

            // 数值属性的范围
            if (values.every(v => typeof v === 'number')) {
                const avg = values.reduce((a, b) => a + b, 0) / values.length;
                const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
                const stdDev = Math.sqrt(variance);

                if (stdDev / (avg || 1) < 0.3) {
                    attributes[key] = `~${avg.toFixed(1)}`;
                } else {
                    attributes[`${key}_range`] = `${Math.min(...values).toFixed(1)}~${Math.max(...values).toFixed(1)}`;
                }
                continue;
            }

            // 字符串类型的频率统计
            if (values.every(v => typeof v === 'string')) {
                const freq = {};
                for (const v of values) {
                    freq[v] = (freq[v] || 0) + 1;
                }
                const top = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
                if (top && top[1] / values.length > 0.6) {
                    attributes[key] = `${top[0]}`;
                }
            }
        }

        return attributes;
    }

    _generateConceptName(key, instances) {
        // 尝试生成有意义的名称
        if (instances.length === 0) return key;

        const first = instances[0];
        if (first && first.type) {
            // 统计子类型
            const subtypes = {};
            for (const inst of instances) {
                const st = inst.subtype || inst.action || inst.tool || inst.category || 'default';
                subtypes[st] = (subtypes[st] || 0) + 1;
            }
            const topSubtype = Object.entries(subtypes).sort((a, b) => b[1] - a[1])[0];
            if (topSubtype && topSubtype[0] !== 'default') {
                return `${first.type}:${topSubtype[0]}`;
            }
            return first.type;
        }

        return key.replace(/[_:]/g, ' ').trim() || 'unknown_concept';
    }

    _abstractToHigherLevel() {
        this._abstractCycles++;
        let abstractedCount = 0;

        // 收集所有具体概念
        const concreteConcepts = [];
        for (const [key, concept] of this._concepts) {
            if (concept.level === 'concrete') {
                concreteConcepts.push({ key, concept });
            }
        }

        if (concreteConcepts.length < this.config.minInstancesForConcept) return 0;

        // 按属性相似度聚类具体概念
        const groups = [];
        const used = new Set();

        for (let i = 0; i < concreteConcepts.length; i++) {
            if (used.has(i)) continue;
            const group = [concreteConcepts[i]];
            used.add(i);

            for (let j = i + 1; j < concreteConcepts.length; j++) {
                if (used.has(j)) continue;

                const sim = this._computeConceptToConceptSimilarity(
                    concreteConcepts[i].concept,
                    concreteConcepts[j].concept
                );

                if (sim > 0.6) {
                    group.push(concreteConcepts[j]);
                    used.add(j);
                }
            }

            if (group.length >= 2) {
                groups.push(group);
            }
        }

        // 为每组创建抽象概念
        for (const group of groups) {
            const childKeys = group.map(g => g.key);
            const childNames = group.map(g => g.concept.name);
            const commonFeatures = this._findCommonFeatures(group.map(g => g.concept));

            const abstractKey = `abstract_${childNames.join('_').substring(0, 60)}`;

            if (!this._concepts.has(abstractKey)) {
                this._concepts.set(abstractKey, {
                    name: `[抽象] ${commonFeatures.join('/') || childNames.join('+')}`,
                    level: 'abstract',
                    attributes: { derivedFrom: childNames, commonality: commonFeatures },
                    instanceCount: childKeys.length,
                    children: childKeys,
                    parent: null,
                    createdAt: new Date().toISOString(),
                    lastUpdated: new Date().toISOString(),
                    extra: {}
                });

                this._conceptCount++;
                this._hierarchy.abstract.set(abstractKey, true);

                // 更新子概念的父引用
                for (const ck of childKeys) {
                    if (this._concepts.has(ck)) {
                        this._concepts.get(ck).parent = abstractKey;
                    }
                }

                abstractedCount++;

                if (this.debug) {
                    console.log(`[ConceptBuilder] 抽象概念: ${this._concepts.get(abstractKey).name} (${childKeys.length}个子概念)`);
                }
            }
        }

        // 尝试更高级的抽象（从抽象概念到元概念）
        if (this._abstractCycles % 5 === 0) {
            abstractedCount += this._metaAbstract();
        }

        return abstractedCount;
    }

    _metaAbstract() {
        let count = 0;

        const abstractConcepts = [];
        for (const [key, concept] of this._concepts) {
            if (concept.level === 'abstract' && concept.children && concept.children.length >= 2) {
                abstractConcepts.push({ key, concept });
            }
        }

        if (abstractConcepts.length < 2) return 0;

        // 找具有相似子概念模式的抽象概念
        const used = new Set();
        for (let i = 0; i < abstractConcepts.length; i++) {
            if (used.has(i)) continue;
            const group = [abstractConcepts[i]];
            used.add(i);

            for (let j = i + 1; j < abstractConcepts.length; j++) {
                if (used.has(j)) continue;

                // 检查子概念是否有重叠
                const overlap = abstractConcepts[i].concept.children.some(
                    c => abstractConcepts[j].concept.children.includes(c)
                );
                if (overlap) {
                    group.push(abstractConcepts[j]);
                    used.add(j);
                }
            }

            if (group.length >= 2) {
                const metaKey = `meta_${group.map(g => g.concept.name.substring(0, 10)).join('_')}`;

                if (!this._concepts.has(metaKey)) {
                    const childNames = group.map(g => g.concept.name);
                    this._concepts.set(metaKey, {
                        name: `[元] ${childNames.join('|')}`,
                        level: 'meta',
                        attributes: { derivedFrom: childNames, abstractionLevel: 'meta' },
                        instanceCount: group.length,
                        children: group.map(g => g.key),
                        parent: null,
                        createdAt: new Date().toISOString(),
                        lastUpdated: new Date().toISOString(),
                        extra: {}
                    });

                    this._conceptCount++;
                    this._hierarchy.meta.set(metaKey, true);
                    count++;
                }
            }
        }

        return count;
    }

    _computeConceptSimilarity(experience, concept) {
        // 计算一条经验和一个概念的相似度
        let score = 0;
        let totalWeight = 0;

        // 类型匹配
        if (experience.type && concept.attributes.type) {
            if (experience.type === concept.attributes.type) score += 0.3;
            totalWeight += 0.3;
        }

        // 属性匹配
        const expAttrs = this._extractNumericFeatures(experience);
        for (const [attr, value] of Object.entries(concept.attributes)) {
            if (typeof value === 'number' && expAttrs[attr] !== undefined) {
                const diff = Math.abs(expAttrs[attr] - value) / (Math.abs(value) || 1);
                if (diff < 0.2) {
                    score += 0.1;
                }
                totalWeight += 0.1;
            }
        }

        // 标签匹配
        const expTags = experience.tags || [];
        if (expTags.length > 0 && concept.attributes.tags) {
            const conceptTags = Array.isArray(concept.attributes.tags) ? concept.attributes.tags : [];
            const overlap = expTags.filter(t => conceptTags.includes(t));
            if (overlap.length > 0) {
                score += (overlap.length / Math.max(expTags.length, conceptTags.length)) * 0.2;
            }
            totalWeight += 0.2;
        }

        return totalWeight > 0 ? score / totalWeight : 0;
    }

    _computeConceptToConceptSimilarity(conceptA, conceptB) {
        // 计算两个概念之间的相似度
        const attrsA = conceptA.attributes || {};
        const attrsB = conceptB.attributes || {};
        const keysA = Object.keys(attrsA);
        const keysB = Object.keys(attrsB);

        if (keysA.length === 0 && keysB.length === 0) return 0;

        let matchCount = 0;
        let totalKeys = Math.max(keysA.length, keysB.length);

        for (const key of keysA) {
            if (attrsB[key] !== undefined && attrsA[key] === attrsB[key]) {
                matchCount++;
            }
        }

        return matchCount / totalKeys;
    }

    _findCommonFeatures(concepts) {
        if (concepts.length < 2) return [];

        const allAttrKeys = concepts.map(c => Object.keys(c.attributes || {}));
        const common = allAttrKeys.reduce((a, b) => a.filter(k => b.includes(k)));

        return common.slice(0, 3);
    }

    _updateStats() {
        let concrete = 0, abstract = 0, meta = 0;
        for (const concept of this._concepts.values()) {
            if (concept.level === 'concrete') concrete++;
            else if (concept.level === 'abstract') abstract++;
            else if (concept.level === 'meta') meta++;
        }

        this.stats.totalConcepts = this._concepts.size;
        this.stats.concreteCount = concrete;
        this.stats.abstractCount = abstract;
        this.stats.metaCount = meta;
    }
}

module.exports = ConceptBuilder;
