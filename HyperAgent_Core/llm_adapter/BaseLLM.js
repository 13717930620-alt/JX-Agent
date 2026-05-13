/**
 * BaseLLM.js - 统一大模型适配基类
 * 定义所有 LLM 必须实现的接口，确保 Hyper-Agent 的模型无关性。
 */

class BaseLLM {
    constructor(config = {}) {
        this.config = config;
    }

    /**
     * 核心对话接口
     * @param {Array} messages - 对话历史 [ {role: 'user'|'assistant'|'system', content: '...'} ]
     * @param {Object} options - 采样参数 (temperature, top_p, max_tokens 等)
     */
    async chat(messages, options = {}) {
        throw new Error('Method chat() must be implemented by subclass');
    }

    /**
     * 流式对话接口
     * @param {Array} messages 
     * @param {Function} onChunk - 收到数据块的回调函数
     */
    async streamChat(messages, onChunk, options = {}) {
        throw new Error('Method streamChat() must be implemented by subclass');
    }

    /**
     * 工具调用/函数执行接口
     * @param {Array} tools - 工具定义列表 (Schema)
     * @param {Array} messages - 对话历史
     */
    async functionCall(tools, messages, options = {}) {
        throw new Error('Method functionCall() must be implemented by subclass');
    }

    estimateTokens(text) {
        // 默认简单估算：1 token ≈ 4 chars (英文) / 1.5 chars (中文)
        return Math.ceil(text.length / 2);
    }
}

module.exports = BaseLLM;
