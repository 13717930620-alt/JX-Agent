// BitemporalGraph — bitemporal knowledge graph
class BitemporalGraph {
    constructor(options = {}) {
        this.knowledgeGraph = options.knowledgeGraph || null;
        this.debug = options.debug || false;

        // 双时态事实索引: factId -> { subject, predicate, object, tValid, tInvalid, metadata }
        this._facts = new Map();

        // 按主题索引: subject -> Set<factId>
        this._subjectIndex = new Map();

        this.stats = {
            totalFacts: 0,
            activeFacts: 0,
            invalidatedFacts: 0,
            lastModified: null
        };
    }

    /**
     * 添加一个双时态事实
     * @param {string} subject - 主体实体 ID
     * @param {string} predicate - 谓词（关系类型）
     * @param {string} object - 客体实体 ID 或字面值
     * @param {object} metadata - { validAt, source, confidence, ... }
     * @returns {string} factId
     */
    addFact(subject, predicate, object, metadata = {}) {
        const factId = `fact_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        const now = new Date().toISOString();

        const fact = {
            id: factId,
            subject,
            predicate,
            object,
            tValid: metadata.validAt || now,
            tInvalid: null,  // null = 当前仍然有效
            metadata: {
                source: metadata.source || 'inference',
                confidence: metadata.confidence || 0.5,
                createdAt: now
            }
        };

        this._facts.set(factId, fact);

        // 按主题索引
        if (!this._subjectIndex.has(subject)) {
            this._subjectIndex.set(subject, new Set());
        }
        this._subjectIndex.get(subject).add(factId);

        // 同步到 KnowledgeGraph
        this._syncToKnowledgeGraph(fact);

        this.stats.totalFacts++;
        this.stats.activeFacts++;
        this.stats.lastModified = now;

        return factId;
    }

    /** 标记事实为失效 */
    invalidateFact(factId) {
        const fact = this._facts.get(factId);
        if (!fact) throw new Error(`Fact not found: ${factId}`);
        if (fact.tInvalid !== null) return false; // 已经失效

        fact.tInvalid = new Date().toISOString();
        this.stats.activeFacts--;
        this.stats.invalidatedFacts++;

        // 同步到 KnowledgeGraph：添加失效关系
        if (this.knowledgeGraph) {
            try {
                // 创建一个 "invalidation" 边来记录
                const invRelId = `inv_${factId}`;
                this.knowledgeGraph.addRelationship(
                    invRelId,
                    fact.subject,
                    'invalidation',
                    `${fact.predicate}_invalidated`,
                    {
                        factId: fact.id,
                        invalidatedAt: fact.tInvalid,
                        originalPredicate: fact.predicate,
                        originalObject: fact.object
                    },
                    0.1
                );
            } catch (e) {
                if (this.debug) console.warn('[BitemporalGraph] KG sync error:', e.message);
            }
        }

        return true;
    }

    /** 按时间点查询 */
    queryAtTime(subject, time) {
        const queryTime = time ? new Date(time).toISOString() : new Date().toISOString();
        const factIds = this._subjectIndex.get(subject);
        if (!factIds) return [];

        const results = [];
        for (const fid of factIds) {
            const fact = this._facts.get(fid);
            if (!fact) continue;

            // 事实在 queryTime 时有效吗？
            if (fact.tValid <= queryTime) {
                if (fact.tInvalid === null || fact.tInvalid > queryTime) {
                    results.push({ ...fact });
                }
            }
        }

        return results;
    }

    queryCurrent(subject) {
        return this.queryAtTime(subject, new Date().toISOString());
    }

    getHistory(subject) {
        const factIds = this._subjectIndex.get(subject);
        if (!factIds) return [];

        return [...factIds]
            .map(fid => this._facts.get(fid))
            .filter(Boolean)
            .sort((a, b) => a.tValid.localeCompare(b.tValid));
    }

    findPath(sourceId, targetId, maxDepth = 4) {
        if (!this.knowledgeGraph || typeof this.knowledgeGraph.findPath !== 'function') {
            return null;
        }
        return this.knowledgeGraph.findPath(sourceId, targetId, maxDepth);
    }

    /**
     * 同步事实到 KnowledgeGraph 作为关系
     */
    _syncToKnowledgeGraph(fact) {
        if (!this.knowledgeGraph) return;

        try {
            // 如果 object 看起来像一个实体 ID（不是纯文本），建立关系
            if (this.knowledgeGraph._entities && this.knowledgeGraph._entities.has(fact.object)) {
                const relId = `temporal_${fact.id}`;
                this.knowledgeGraph.addRelationship(
                    relId,
                    fact.subject,
                    fact.predicate,
                    fact.object,
                    {
                        temporalFactId: fact.id,
                        tValid: fact.tValid,
                        confidence: fact.metadata.confidence,
                        source: fact.metadata.source
                    },
                    fact.metadata.confidence || 0.5
                );
            }
        } catch (e) {
            if (this.debug) console.warn('[BitemporalGraph] KG sync error:', e.message);
        }
    }

    extractFactsFromText(text, context = {}) {
        const subject = context.subject || 'user';
        const source = context.source || 'conversation';
        const facts = [];

        // 简单的模式匹配提取
        const patterns = [
            // "X 是 Y" / "X is Y"
            { regex: /(?:我|用户)?(?:喜欢|偏好|prefer|use|使用|安装|installed|have|有|创建了|created)\s+(.+?)[，。,!！;；]/, pred: 'has' },
            // "X 的 Y 是 Z"
            { regex: /(?:我|我的|用户)(?:的)?(.+?)(?:是|is)\s+(.+?)[，。,!！]/, pred: 'attribute' },
            // "X 在 Y 上"
            { regex: /(.+?)(?:运行在|runs on|在|on)\s+(.+?)[，。]/, pred: 'runs_on' },
            // "X 依赖 Y"
            { regex: /(.+?)(?:依赖|depends on|需要|requires|need)\s+(.+?)[，。]/, pred: 'depends_on' }
        ];

        for (const { regex, pred } of patterns) {
            const matches = text.matchAll(regex);
            for (const m of matches) {
                const obj = (m[2] || m[1]).trim();
                if (obj && obj.length > 1 && obj.length < 80) {
                    const factId = this.addFact(subject, pred, obj, {
                        source,
                        confidence: 0.4,
                        validAt: new Date().toISOString()
                    });
                    facts.push(factId);
                }
            }
        }

        return facts;
    }

    /**
     * 搜索事实
     */
    searchFacts(query) {
        const q = query.toLowerCase();
        const results = [];

        for (const fact of this._facts.values()) {
            if (fact.subject.toLowerCase().includes(q) ||
                fact.predicate.toLowerCase().includes(q) ||
                (typeof fact.object === 'string' && fact.object.toLowerCase().includes(q))) {
                results.push({ ...fact });
            }
        }

        return results.sort((a, b) => a.tValid.localeCompare(b.tValid));
    }

    getStats() {
        return {
            ...this.stats,
            indexedSubjects: this._subjectIndex.size,
            facts: this._facts.size
        };
    }

    /**
     * 持久化到 JSON
     */
    async persist(filePath) {
        const data = {
            stats: this.stats,
            facts: Array.from(this._facts.values())
        };
        const fp = filePath || require('path').join(
            require('path').dirname(require.resolve('./BitemporalGraph')),
            '../../experience_store/bitemporal_graph.json'
        );
        await require('fs').promises.writeFile(fp, JSON.stringify(data, null, 2));
    }

    /**
     * 从 JSON 加载
     */
    async load(filePath) {
        const fp = filePath || require('path').join(
            require('path').dirname(require.resolve('./BitemporalGraph')),
            '../../experience_store/bitemporal_graph.json'
        );
        try {
            const data = JSON.parse(await require('fs').promises.readFile(fp, 'utf8'));
            if (data.facts) {
                for (const fact of data.facts) {
                    this._facts.set(fact.id, fact);
                    if (!this._subjectIndex.has(fact.subject)) {
                        this._subjectIndex.set(fact.subject, new Set());
                    }
                    this._subjectIndex.get(fact.subject).add(fact.id);
                }
                this.stats = data.stats || this.stats;
                this.stats.totalFacts = this._facts.size;
                this.stats.activeFacts = [...this._facts.values()].filter(f => !f.tInvalid).length;
                this.stats.invalidatedFacts = this.stats.totalFacts - this.stats.activeFacts;
            }
            console.log(`[BitemporalGraph] Loaded ${this._facts.size} facts`);
        } catch (e) {
            if (this.debug) console.warn('[BitemporalGraph] No existing facts to load');
        }
    }
}

module.exports = BitemporalGraph;
