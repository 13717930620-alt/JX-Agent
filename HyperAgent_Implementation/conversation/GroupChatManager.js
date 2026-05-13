// GroupChatManager - multi-agent group chat manager
class GroupChatManager {
    constructor(options = {}) {
        this.llmAdapter = options.llmAdapter || null;
        this.mode = options.mode || 'round_robin'; // round_robin | selector | swarm | magentic_one
        this.messagePool = options.messagePool || null;
        this.maxTurns = options.maxTurns || 10;

        this._participants = new Map();  // agentId -> { id, name, role, systemPrompt, instance }
        this._speakerOrder = [];
        this._currentSpeakerIndex = 0;
        this._turnCount = 0;
        this._managerId = null;

        this.stats = {
            totalTurns: 0,
            messagesExchanged: 0,
            mode: this.mode
        };
    }

    /**
     * Register a participant
     */
    registerAgent(agentId, config = {}) {
        this._participants.set(agentId, {
            id: agentId,
            name: config.name || agentId,
            role: config.role || 'assistant',
            systemPrompt: config.systemPrompt || '',
            instance: config.instance || null
        });

        if (!this._speakerOrder.includes(agentId)) {
            this._speakerOrder.push(agentId);
        }

        return this;
    }

    /**
     * Set manager agent (MagenticOne mode)
     */
    setManagerAgent(agentId) {
        if (!this._participants.has(agentId)) {
            throw new Error(`Agent not registered: ${agentId}`);
        }
        this._managerId = agentId;
    }

    /**
     * Run one turn of group chat
     */
    async runTurn(context = {}) {
        if (this._turnCount >= this.maxTurns) {
            return { done: true, reason: 'max_turns' };
        }

        this._turnCount++;
        this.stats.totalTurns++;

        // 选择下一个发言者
        const speakerId = await this._selectNextSpeaker(context);
        const speaker = this._participants.get(speakerId);
        if (!speaker) return { done: true, reason: 'invalid_speaker' };

        // 构建该智能体的上下文
        const conversationHistory = this.messagePool
            ? this.messagePool.getConversationContext(speakerId, 10)
            : '';

        // 模拟智能体发言
        let response;
        if (speaker.instance && typeof speaker.instance.generateResponse === 'function') {
            response = await speaker.instance.generateResponse(context.input || '', {
                history: conversationHistory,
                systemPrompt: speaker.systemPrompt
            });
        } else if (this.llmAdapter) {
            const messages = [
                { role: 'system', content: speaker.systemPrompt || `你是 ${speaker.name}，担任 ${speaker.role} 角色。` },
                ...(conversationHistory ? [{ role: 'system', content: `对话历史:\n${conversationHistory}` }] : []),
                { role: 'user', content: context.input || '请继续讨论。' }
            ];
            const llmResponse = await this.llmAdapter.chat(messages);
            response = typeof llmResponse === 'string' ? llmResponse :
                       (llmResponse.content || llmResponse.message?.content || '');
        } else {
            response = `[${speaker.name} 发言]`;
        }

        // 发布消息到池
        if (this.messagePool) {
            this.messagePool.publish(speakerId, {
                type: 'group_chat',
                content: response,
                role: speaker.role,
                metadata: { turn: this._turnCount, mode: this.mode }
            });
        }

        this.stats.messagesExchanged++;

        return {
            done: false,
            speaker: { id: speakerId, name: speaker.name, role: speaker.role },
            response,
            turn: this._turnCount
        };
    }

    /**
     * Run a full group chat session
     */
    async runSession(initialInput, options = {}) {
        this._turnCount = 0;
        const results = [];

        let context = { input: initialInput, ...options };

        while (true) {
            const turn = await this.runTurn(context);
            results.push(turn);

            if (turn.done) break;

            // 将上一步的输出作为下一轮的输入
            context = {
                ...context,
                input: turn.response,
                lastSpeaker: turn.speaker.id
            };
        }

        return {
            turns: results,
            totalTurns: this.stats.totalTurns,
            messagesExchanged: this.stats.messagesExchanged
        };
    }

    // ===== Speaker selection strategies =====

    async _selectNextSpeaker(context) {
        switch (this.mode) {
            case 'round_robin': return this._roundRobinSelect();
            case 'selector':    return await this._selectorSelect(context);
            case 'swarm':       return await this._swarmSelect(context);
            case 'magentic_one':return await this._magenticOneSelect(context);
            default:            return this._roundRobinSelect();
        }
    }

    _roundRobinSelect() {
        const speaker = this._speakerOrder[this._currentSpeakerIndex];
        this._currentSpeakerIndex = (this._currentSpeakerIndex + 1) % this._speakerOrder.length;
        return speaker;
    }

    async _selectorSelect(context) {
        if (!this.llmAdapter || this._participants.size <= 1) {
            return this._roundRobinSelect();
        }

        const participants = [...this._participants.values()]
            .map(p => `- ${p.id}: ${p.role} - ${p.name}`).join('\n');

        const prompt = `基于当前对话上下文，选择下一个应该发言的智能体。

参与者：
${participants}

当前上下文：
${context.input ? context.input.substring(0, 300) : '对话开始'}

只返回智能体 ID。`;

        const response = await this.llmAdapter.chat([
            { role: 'system', content: '你是一个对话管理者。选择下一个发言的智能体。只返回 ID。' },
            { role: 'user', content: prompt }
        ]);

        const text = typeof response === 'string' ? response :
                     (response.content || response.message?.content || '');
        const match = [...this._participants.keys()].find(id => text.includes(id));

        return match || this._roundRobinSelect();
    }

    async _swarmSelect(context) {
        // 简单实现：当前发言者指定下一个
        const lastSpeaker = context.lastSpeaker;
        if (lastSpeaker && this._participants.has(lastSpeaker)) {
            // 如果是 swarm 模式，LLM 决定
            if (this.llmAdapter) {
                return await this._selectorSelect(context);
            }
        }
        return this._roundRobinSelect();
    }

    async _magenticOneSelect(context) {
        if (this._managerId && this._participants.has(this._managerId)) {
            // 管理智能体决定
            return this._managerId;
        }
        return this._roundRobinSelect();
    }

    /**
     * 获取参与者列表
     */
    listParticipants() {
        return [...this._participants.values()].map(p => ({
            id: p.id, name: p.name, role: p.role
        }));
    }

    getStats() {
        return { ...this.stats, participantCount: this._participants.size };
    }
}

module.exports = GroupChatManager;
