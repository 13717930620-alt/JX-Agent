// RAGEngine — retrieval-augmented generation engine
class RAGEngine {
    /**
     * @param {Object} options
     * @param {Object} options.vectorStore - VectorStore 实例
     * @param {Object} options.memoryManager - MemoryManager 实例
     * @param {number} options.chunkSize - 文档分块大小（字符数）
     * @param {number} options.chunkOverlap - 分块重叠大小
     * @param {number} options.maxContextLength - 注入 LLM 的最大上下文长度
     * @param {number} options.topK - 检索返回 Top K 结果
     * @param {number} options.relevanceThreshold - 相关性阈值
     */
    constructor(options = {}) {
        this.vectorStore = options.vectorStore || null;
        this.memoryManager = options.memoryManager || null;
        this.chunkSize = options.chunkSize || 500;
        this.chunkOverlap = options.chunkOverlap || 50;
        this.maxContextLength = options.maxContextLength || 3000;
        this.topK = options.topK || 5;
        this.relevanceThreshold = options.relevanceThreshold || 0.6;
    }

    /** 将文档切分为重叠块 */
    chunkDocument(text, options = {}) {
        const chunkSize = options.chunkSize || this.chunkSize;
        const overlap = options.chunkOverlap || this.chunkOverlap;
        const metadata = options.metadata || {};
        const chunks = [];

        if (!text || text.length === 0) return chunks;

        // 按段落分块（保留段落完整性）
        const paragraphs = text.split(/\n\s*\n/);
        let currentChunk = '';
        let index = 0;

        for (const para of paragraphs) {
            const trimmed = para.trim();
            if (!trimmed) continue;

            if (currentChunk.length + trimmed.length > chunkSize && currentChunk.length > 0) {
                chunks.push({
                    text: currentChunk.trim(),
                    index: index++,
                    metadata: { ...metadata, source: metadata.source || 'document' }
                });
                // 保留重叠部分：从末尾截取 overlap 长度的内容作为新块的开始
                currentChunk = currentChunk.slice(-overlap) + '\n' + trimmed;
            } else {
                if (currentChunk.length > 0) currentChunk += '\n';
                currentChunk += trimmed;
            }
        }

        // 最后一块
        if (currentChunk.trim().length > 0) {
            chunks.push({
                text: currentChunk.trim(),
                index: index,
                metadata: { ...metadata, source: metadata.source || 'document' }
            });
        }

        return chunks;
    }

    /** 将文档分块后索引到 VectorStore */
    async indexDocument(text, metadata = {}) {
        if (!this.vectorStore) {
            throw new Error('RAGEngine: VectorStore not configured');
        }

        const chunks = this.chunkDocument(text, { metadata });
        const ids = [];

        for (const chunk of chunks) {
            const result = this.vectorStore.add(chunk.text, {
                ...chunk.metadata,
                chunkIndex: chunk.index,
                indexedAt: new Date().toISOString()
            });
            ids.push(result.id);
        }

        return ids;
    }

    /** 从多源检索相关上下文 */
    async retrieve(query, options = {}) {
        const topK = options.topK || this.topK;
        const threshold = options.threshold || this.relevanceThreshold;
        const results = [];

        // 1. 从 VectorStore 检索语义相关内容
        if (this.vectorStore) {
            try {
                const vecResults = this.vectorStore.search(query, topK);
                for (const r of vecResults) {
                    const dist = parseFloat(r.distance);
                    if (dist < threshold) {
                        results.push({
                            text: r.text,
                            source: 'vector_store',
                            score: 1 - dist,
                            metadata: r.metadata
                        });
                    }
                }
            } catch (e) {
                console.warn('[RAGEngine] VectorStore search failed:', e.message);
            }
        }

        // 2. 从 MemoryManager 检索记忆
        if (this.memoryManager) {
            try {
                const memResults = await this.memoryManager.retrieve(query);
                for (const m of memResults) {
                    const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
                    results.push({
                        text: text,
                        source: `memory_${m.level}`,
                        score: (m.score || 0) / 100,
                        metadata: { level: m.level, timestamp: m.timestamp }
                    });
                }
            } catch (e) {
                console.warn('[RAGEngine] MemoryManager retrieve failed:', e.message);
            }
        }

        // 3. 去重并按分数排序
        const seen = new Set();
        const unique = [];
        for (const r of results.sort((a, b) => b.score - a.score)) {
            const key = r.text.substring(0, 50);
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(r);
            }
        }

        return unique.slice(0, topK);
    }

    /** 将检索结果格式化为 LLM 提示上下文 */
    async buildContext(query, options = {}) {
        const maxLen = options.maxLength || this.maxContextLength;

        const results = await this.retrieve(query, options);

        if (results.length === 0) {
            return { context: '', sources: [], hasContext: false };
        }

        let contextParts = [];
        const sources = [];

        for (const r of results) {
            const header = `[来源: ${r.source}]`;
            const part = `${header}\n${r.text}`;

            if (contextParts.join('\n\n').length + part.length > maxLen) break;

            contextParts.push(part);
            sources.push({ source: r.source, score: r.score });
        }

        if (contextParts.length === 0) {
            return { context: '', sources: [], hasContext: false };
        }

        return {
            context: `\n\n[相关上下文]\n${contextParts.join('\n\n')}\n[/相关上下文]\n\n`,
            sources,
            hasContext: true
        };
    }

    /** 为 LLM 消息添加上下文 */
    async augmentMessages(messages, query) {
        const { context, hasContext } = await this.buildContext(query);

        if (!hasContext || messages.length === 0) return messages;

        // 将上下文注入到 system prompt 或第一条 user message 之前
        const augmented = [...messages];
        const firstUserIdx = augmented.findIndex(m => m.role === 'user');

        if (firstUserIdx >= 0) {
            // 在第一条 user 消息末尾追加上下文
            augmented[firstUserIdx] = {
                ...augmented[firstUserIdx],
                content: augmented[firstUserIdx].content + context
            };
        } else {
            // 没有 user 消息，添加一条
            augmented.push({ role: 'user', content: context });
        }

        return augmented;
    }

    getStats() {
        const stats = {
            configured: {
                vectorStore: !!this.vectorStore,
                memoryManager: !!this.memoryManager
            },
            config: {
                chunkSize: this.chunkSize,
                chunkOverlap: this.chunkOverlap,
                topK: this.topK,
                relevanceThreshold: this.relevanceThreshold
            }
        };

        if (this.vectorStore) {
            stats.vectorStore = this.vectorStore.getStats();
        }

        return stats;
    }
}

module.exports = RAGEngine;
