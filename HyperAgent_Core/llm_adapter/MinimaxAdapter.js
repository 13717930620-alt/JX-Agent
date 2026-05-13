/**
 * MinimaxAdapter.js - Minimax API 适配器（带自动备用模型切换）
 * 用于 JingxuanAgent 与 Minimax 大模型通信
 * 当 MiniMax API 失败时，自动切换到 DeepSeek
 */
const BaseLLM = require('./BaseLLM');

class MinimaxAdapter extends BaseLLM {
    constructor(config) {
        super(config);
        this.apiKey = config.apiKey;
        this.baseUrl = config.baseUrl || 'https://api.minimax.chat/v1';
        this.model = config.model || 'MiniMax-Text-01';
        this.retryCount = 0;
        this.maxRetries = config.maxRetries || 2;
        this.fallbackConfig = config.fallback;
    }

    async chat(messages, options = {}) {
        console.log('[MinimaxAdapter] Calling Minimax API...');
        
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
                const err = await response.text();
                throw new Error(`Minimax API Error ${response.status}: ${err}`);
            }
            
            const data = await response.json();
            this.retryCount = 0;
            return data.choices[0].message.content;
        } catch (error) {
            console.error('[MinimaxAdapter] API Call Failed:', error.message);
            this.retryCount++;
            
            // 达到重试次数，尝试备用模型
            if (this.retryCount >= this.maxRetries && this.fallbackConfig) {
                console.log('[MinimaxAdapter] Max retries reached, trying DeepSeek fallback...');
                try {
                    const DeepSeekAdapter = require('./DeepSeekAdapter');
                    const fb = new DeepSeekAdapter(this.fallbackConfig);
                    const result = await fb.chat(messages, options);
                    this.retryCount = 0;
                    console.log('[MinimaxAdapter] DeepSeek fallback successful!');
                    return result;
                } catch (e) {
                    console.error('[MinimaxAdapter] DeepSeek fallback also failed:', e.message);
                    this.retryCount = 0;
                }
            }
            throw error;
        }
    }

    async streamChat(messages, onChunk, options = {}) {
        console.log('[MinimaxAdapter] Streaming mode not implemented yet');
        const result = await this.chat(messages, options);
        onChunk(result);
    }
}

module.exports = MinimaxAdapter;
