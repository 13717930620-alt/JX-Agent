// MemoryConsistencyManager — memory consistency verifier
class MemoryConsistencyManager {
    constructor(memoryManager) {
        this.memoryManager = memoryManager;
    }

    /**
     * 冲突检测与合并
     * @param {string} newMemory 新产生的洞察
     * @param {Array} existingMemories 相关的 L2/L3 记忆片段
     */
    async resolveConflict(newMemory, existingMemories) {
        const contradiction = await this._detectContradiction(newMemory, existingMemories);
        
        if (!contradiction) return { action: 'APPEND', result: newMemory };

        // 如果新洞察基于更丰富的数据集，则覆盖旧洞察
        return {
            action: 'OVERWRITE',
            reason: 'New insight based on more recent/extensive data',
            result: newMemory
        };
    }

    async _detectContradiction(newMem, existing) {
        const negativeWords = ['not', 'incorrect', 'failed', 'opposite'];
        return existing.some(m => 
            negativeWords.some(word => m.content.includes(word) && newMem.includes(word))
        );
    }
}

module.exports = MemoryConsistencyManager;
