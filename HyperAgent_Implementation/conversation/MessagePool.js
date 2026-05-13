// MessagePool - global message pool with publish/subscribe
class MessagePool {
    constructor(options = {}) {
        this.maxHistory = options.maxHistory || 1000;
        this._messages = [];
        this._subscriptions = new Map();
        this._nextSubId = 1;

        this.stats = {
            totalPublished: 0,
            activeSubscriptions: 0
        };
    }

    /**
     * Publish a message
     */
    publish(agentId, message) {
        const msg = {
            id: `msg_${Date.now()}_${this.stats.totalPublished}`,
            agentId,
            type: message.type || 'general',
            content: message.content,
            cause: message.cause || null,
            role: message.role || 'assistant',
            timestamp: new Date().toISOString(),
            metadata: message.metadata || {}
        };

        this._messages.push(msg);
        this.stats.totalPublished++;

        // 限制历史
        if (this._messages.length > this.maxHistory) {
            this._messages.splice(0, this._messages.length - this.maxHistory);
        }

        // 通知订阅者
        for (const [subId, sub] of this._subscriptions) {
            if (sub.filterFn(msg)) {
                try {
                    sub.callback(msg);
                } catch (e) {
                    console.warn(`[MessagePool] Subscriber ${subId} error:`, e.message);
                }
            }
        }

        return msg;
    }

    /**
     * Subscribe to messages
     */
    subscribe(agentId, filterFn, callback) {
        const subId = this._nextSubId++;
        this._subscriptions.set(subId, {
            agentId,
            filterFn: filterFn || (() => true),
            callback,
            createdAt: Date.now()
        });
        this.stats.activeSubscriptions = this._subscriptions.size;
        return subId;
    }

    /**
     * Unsubscribe from messages
     */
    unsubscribe(subId) {
        this._subscriptions.delete(subId);
        this.stats.activeSubscriptions = this._subscriptions.size;
    }

    /**
     * Get message history with optional filters
     */
    getHistory(filter = {}) {
        let results = this._messages;

        if (filter.type) {
            results = results.filter(m => m.type === filter.type);
        }
        if (filter.agentId) {
            results = results.filter(m => m.agentId === filter.agentId);
        }
        if (filter.since) {
            const sinceTime = new Date(filter.since).getTime();
            results = results.filter(m => new Date(m.timestamp).getTime() >= sinceTime);
        }
        if (filter.cause) {
            results = results.filter(m => m.cause === filter.cause);
        }
        if (filter.limit) {
            results = results.slice(-filter.limit);
        }

        return results;
    }

    /**
     * Get full conversation thread by cause
     */
    getThread(cause) {
        const thread = [];
        const visited = new Set();
        let current = cause;

        while (current && !visited.has(current)) {
            visited.add(current);
            const message = this._messages.find(m => m.id === current);
            if (message) {
                thread.unshift(message);
                current = message.cause;
            } else {
                break;
            }
        }

        return thread;
    }

    /**
     * Get most recent messages
     */
    getRecent(count = 10) {
        return this._messages.slice(-count);
    }

    /**
     * Get inter-agent conversation context for LLM injection
     */
    getConversationContext(agentId, maxMessages = 20) {
        const relevant = this._messages.filter(
            m => m.agentId === agentId || m.metadata?.target === agentId
        );
        return relevant.slice(-maxMessages).map(m =>
            `[${m.agentId}](${m.type}): ${typeof m.content === 'string' ? m.content.substring(0, 200) : JSON.stringify(m.content)}`
        ).join('\n');
    }

    clear() {
        this._messages = [];
        this._subscriptions.clear();
        this.stats.activeSubscriptions = 0;
    }

    getStats() {
        return { ...this.stats, historySize: this._messages.length };
    }
}

module.exports = MessagePool;
