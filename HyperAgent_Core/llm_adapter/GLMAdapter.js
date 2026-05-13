const axios = require('axios');
const BaseLLM = require('./BaseLLM');

class GLMAdapter extends BaseLLM {
    constructor(config) {
        super(config);
        this.apiKey = config.apiKey;
        this.baseUrl = config.baseUrl;
        this.model = config.model;
        this.maxTokens = config.maxTokens || 4096;
        this.temperature = config.temperature || 0.7;
    }

    async chat(messages) {
        try {
            const response = await axios.post(`${this.baseUrl}/chat/completions`, {
                model: this.model,
                messages: messages,
                max_tokens: this.maxTokens,
                temperature: this.temperature
            }, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.data && response.data.choices && response.data.choices.length > 0) {
                return response.data.choices[0].message.content;
            }
            throw new Error('GLM API returned unexpected response format');
        } catch (error) {
            console.error('[GLMAdapter] API Error:', error.message);
            throw error;
        }
    }

    async streamChat(messages, onChunk, options = {}) {
        const result = await this.chat(messages, options);
        if (onChunk) onChunk(result);
    }

    async functionCall(tools, messages, options = {}) {
        return { content: await this.chat(messages, options), toolCalls: [] };
    }
}

module.exports = GLMAdapter;
