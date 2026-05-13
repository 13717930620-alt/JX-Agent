const path = require('path');

/**
 * MemoryPipeline — 记忆管线
 *
 * 管理记忆的索引、检索、上下文构建
 */
class MemoryPipeline {
    constructor(options = {}) {
        this.memoryManager = options.memoryManager || null;
        this.llmAdapter = options.llmAdapter || null;
        this.localInference = options.localInference || null;
        this.maxMemoryItems = options.maxMemoryItems || 2000;
        this.autoIndexInterval = options.autoIndexInterval || 30000;
        this.embedding = options.embedding || {};

        this._ready = false;
        this._stats = {
            totalMemories: 0,
            searches: 0,
            buildContexts: 0,
            remembers: 0,
        };

        // VectorStore 代理 — 暴露给外部组件
        this.vectorStore = {
            localInference: null,
            buildEmbeddings: async (opts = {}) => ({ indexed: 0, total: 0 }),
        };

        // 内存缓存
        this._memories = new Map();
    }

    async init() {
        this._ready = true;
        return true;
    }

    async search(query, options = {}) {
        this._stats.searches++;
        if (!this.memoryManager || typeof this.memoryManager.search !== 'function') {
            return [];
        }
        try {
            const results = await this.memoryManager.search(query, options.topK || 5);
            return results || [];
        } catch (e) {
            return [];
        }
    }

    async buildContext(userMessage, options = {}) {
        this._stats.buildContexts++;
        const topK = options.topK || 5;
        const threshold = options.threshold || 0.4;

        let memories = [];
        if (this.memoryManager && typeof this.memoryManager.search === 'function') {
            try {
                memories = await this.memoryManager.search(userMessage, topK);
            } catch (e) {
                // 记忆检索失败不阻断
            }
        }

        if (!memories || memories.length === 0) {
            return { hasContext: false, context: '', memories: [] };
        }

        const contextStr = memories
            .slice(0, topK)
            .map((m, i) => {
                const text = m.text || m.content || JSON.stringify(m);
                return `[记忆 ${i + 1}] ${text.substring(0, 300)}`;
            })
            .join('\n');

        return {
            hasContext: true,
            context: contextStr,
            memories: memories.slice(0, topK),
        };
    }

    async remember(content, tags = {}) {
        this._stats.remembers++;
        if (!content) return null;

        const id = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const entry = {
            id,
            text: typeof content === 'string' ? content : JSON.stringify(content),
            tags,
            createdAt: new Date().toISOString(),
        };
        this._memories.set(id, entry);
        this._stats.totalMemories = this._memories.size;

        if (this.memoryManager && typeof this.memoryManager.store === 'function') {
            try {
                await this.memoryManager.store(entry);
            } catch (e) {
                // 存储失败不阻断
            }
        }

        return id;
    }

    getStats() {
        return {
            ...this._stats,
            ready: this._ready,
            cacheSize: this._memories.size,
            maxItems: this.maxMemoryItems,
            hasMemoryManager: !!this.memoryManager,
        };
    }

    async autoPrune() {
        // 基础裁剪：超出上限时移除最旧的
        if (this._memories.size > this.maxMemoryItems) {
            const entries = [...this._memories.entries()];
            const toDelete = entries.slice(0, this._memories.size - this.maxMemoryItems);
            for (const [id] of toDelete) {
                this._memories.delete(id);
            }
            this._stats.totalMemories = this._memories.size;
        }
    }

    async destroy() {
        this._ready = false;
        this._memories.clear();
    }
}

module.exports = MemoryPipeline;
