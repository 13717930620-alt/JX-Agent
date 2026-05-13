const BaseLLM = require('./BaseLLM');

/**
 * QwenAdapter.js - 基于 Qwen 系列模型的适配器
 * 实现具体模型调用，将 Qwen 的 API 转换为 Hyper-Agent 的统一接口。
 */

class QwenAdapter extends BaseLLM {
    constructor(config) {
        super(config);
        this.apiKey = config.apiKey;
        this.baseUrl = config.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
        this.model = config.model || 'qwen-plus';
    }

    async chat(messages, options = {}) {
        console.log(`[LLM-Adapter] Calling Qwen model: ${this.model}`);

        try {
            const response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: this.model,
                    messages: messages,
                    temperature: options.temperature || 0.7,
                    max_tokens: options.maxTokens || 4096
                })
            });

            if (!response.ok) {
                const errorText = await response.text().catch(() => response.statusText);
                throw new Error(`Qwen API Error: ${response.status} ${errorText.substring(0, 200)}`);
            }

            const data = await response.json();
            if (!data.choices || !data.choices[0]) {
                throw new Error('Qwen API: unexpected response format');
            }
            return data.choices[0].message.content;
        } catch (error) {
            console.error('[LLM-Adapter] Qwen Call Failed:', error);
            throw error;
        }
    }

    async streamChat(messages, onChunk, options = {}) {
        console.log(`[LLM-Adapter] Streaming from Qwen...`);
        try {
            const response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: this.model,
                    messages: messages,
                    temperature: options.temperature || 0.7,
                    max_tokens: options.maxTokens || 4096,
                    stream: true
                })
            });

            if (!response.ok) throw new Error(`Qwen API Error: ${response.statusText}`);
            if (!response.body) {
                const result = await this.chat(messages, options);
                onChunk(result);
                return;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                        try {
                            const parsed = JSON.parse(line.slice(6));
                            const content = parsed.choices?.[0]?.delta?.content || '';
                            if (content) onChunk(content);
                        } catch (e) { /* skip parse errors */ }
                    }
                }
            }
        } catch (error) {
            console.error('[LLM-Adapter] Qwen Stream Failed:', error);
            throw error;
        }
    }

    async functionCall(tools, messages, options = {}) {
        console.log(`[LLM-Adapter] Qwen processing tools: ${tools.length} items`);
        const response = await this.chat([
            ...messages,
            { role: 'system', content: `Available tools: ${JSON.stringify(tools)}. Return tool calls in JSON format.` }
        ], options);

        return this._parseToolCalls(response);
    }

    _parseToolCalls(response) {
        try {
            const parsed = JSON.parse(response);
            if (parsed.tool_calls || parsed.actions) return parsed;
            return { tool_calls: Array.isArray(parsed) ? parsed : [parsed] };
        } catch (e) {
            return { error: 'Failed to parse tool calls', raw: response };
        }
    }
}

module.exports = QwenAdapter;
