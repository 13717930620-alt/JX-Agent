/**
 * generic_memory_engine.js
 * 功能：通用分层记忆管理，支持任何领域知识的自动沉淀
 */
const fs = require('fs');
const path = require('path');

class GenericMemoryEngine {
    constructor(agent) {
        this.agent = agent;
        this.layers = {
            L0: 'session_logs',      // 原始对话记录
            L1: 'extracted_facts',   // 事实要点
            L2: 'structured_kb',     // 结构化知识库
            L3: 'core_insights'      // 长期行为模式与核心洞察
        };
        this.storageDir = path.join(process.cwd(), 'mem_store', 'distilled');
        if (!fs.existsSync(this.storageDir)) {
            fs.mkdirSync(this.storageDir, { recursive: true });
        }
    }

    async runAutoDream() {
        console.log("[GenericMemoryEngine] 🌙 autoDream 启动：开始记忆蒸馏...");
        try {
            // 1. 扫描 L0 (从 agent 的 storage 或 logs 中读取)
            const rawData = await this._getLatestLogs();
            if (!rawData) return;

            // 2. 提炼 L1 (关键事实)
            const keyPoints = await this._distill(rawData, "请分析上述记录，提取出用户偏好、关键事实及可复用的知识点。");
            await this._saveToLayer('L1', keyPoints);

            // 3. 升级 L2 (结构化知识)
            const kb = await this._distill(keyPoints, "将上述关键点组织成结构化的知识库，去除冗余，建立逻辑关联。");
            await this._saveToLayer('L2', kb);

            // 4. 沉淀 L3 (核心洞察)
            const insights = await this._distill(kb, "基于结构化知识，分析用户的长期行为模式、决策逻辑及核心需求，形成最高层级的洞察。");
            await this._saveToLayer('L3', insights);

            console.log("[GenericMemoryEngine] ✨ 认知模型已进化完成。");
        } catch (e) {
            console.error("[GenericMemoryEngine] autoDream failed:", e);
        }
    }

    async _distill(content, prompt) {
        if (!this.agent.components.llmAdapter) return content;
        const res = await this.agent.components.llmAdapter.chat([
            { role: 'system', content: '你是一个高级知识蒸馏专家。请将输入信息进行高压缩、高价值的提炼。' },
            { role: 'user', content: `${prompt}\n\nContent:\n${content}` }
        ]);
        return res;
    }

    async _getLatestLogs() {
        // 简单实现：从最近的会话记录中获取
        if (!this.agent.storage) return null;
        const logs = await this.agent.storage.getRecentMessages(100); // 假设 storage 有此方法
        return JSON.stringify(logs);
    }

    async _saveToLayer(layer, data) {
        const filePath = path.join(this.storageDir, `${layer}.md`);
        fs.writeFileSync(filePath, data, 'utf8');
    }
}

module.exports = GenericMemoryEngine;
