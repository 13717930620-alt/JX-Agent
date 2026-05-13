const fs = require('fs');
const path = require('path');

// CognitiveEvolver — cognitive evolution engine
class CognitiveEvolver {
    constructor(memoryManager, llmAdapter) {
        this.memoryManager = memoryManager;
        this.llm = llmAdapter;
        this.evolutionThreshold = 3; // 某类经验出现 3 次后触发升华（调低阈值加快进化）
        
        // 进化追踪
        this.evolutionHistory = [];
        this.lastEvolutionTime = null;
        
        // 语义聚类缓存
        this._semanticCache = new Map();
    }

    /** 启动进化周期，扫描 L2 层 */
    async evolve(options = {}) {
        const { force = false, minFrequency = null } = options;
        
        const threshold = minFrequency || this.evolutionThreshold;
        const l2Memories = this.memoryManager.layers.L2;
        
        // 收集所有 L2 记忆
        const memories = Array.from(l2Memories.values());
        console.log(`[CognitiveEvolver] Scanning ${memories.length} L2 memories for patterns...`);
        
        // 检测模式
        const patterns = this._detectPatterns(memories);
        console.log(`[CognitiveEvolver] Detected ${patterns.length} unique patterns`);
        
        let evolvedCount = 0;
        let skippedCount = 0;
        
        for (const pattern of patterns) {
            if (pattern.frequency < threshold) {
                skippedCount++;
                continue;
            }
            
            // 检查是否已有相似的 L3 洞察
            if (!force && await this._hasSimilarInsight(pattern.key)) {
                console.log(`[CognitiveEvolver] Skipping "${pattern.key}" - similar L3 insight exists`);
                continue;
            }
            
            const insight = await this._synthesizeInsight(pattern);
            if (insight) {
                // 直接推入 L3 层
                await this.memoryManager.pushMemory(insight, 'L3');
                evolvedCount++;
                
                // 记录进化历史
                this.evolutionHistory.push({
                    patternKey: pattern.key,
                    frequency: pattern.frequency,
                    insight: insight.substring(0, 100),
                    timestamp: new Date().toISOString()
                });
            }
        }
        
        this.lastEvolutionTime = new Date();
        console.log(`[CognitiveEvolver] Evolution complete: ${evolvedCount} evolved, ${skippedCount} skipped`);
        
        return {
            evolved: evolvedCount,
            skipped: skippedCount,
            patterns: patterns.length,
            history: this.evolutionHistory.slice(-10)
        };
    }

    _detectPatterns(memories) {
        const patterns = new Map();
        
        for (const item of memories) {
            const content = typeof item.content === 'string' ? item.content : JSON.stringify(item.content);
            const key = this._extractPatternKey(content);
            
            if (key) {
                const current = patterns.get(key) || { 
                    key, 
                    frequency: 0, 
                    items: [],
                    keywords: new Set()
                };
                current.frequency++;
                current.items.push(item);
                
                // 提取关键词
                const words = this._extractKeywords(content);
                words.forEach(w => current.keywords.add(w));
                
                patterns.set(key, current);
            }
        }
        
        return Array.from(patterns.values());
    }

    _extractKeywords(content) {
        // 简单关键词提取：移除停用词，提取名词/动词
        const stopWords = new Set(['的', '了', '是', '在', '和', '与', '或', '一个', '我', '你', '他', '她', '它', '这', '那', '的', '了', '着', '过']);
        const words = content.split(/[\s,，。、；：""''（）()\[\]{}]+/);
        return words.filter(w => w.length > 1 && !stopWords.has(w)).slice(0, 10);
    }

    _extractPatternKey(content) {
        const c = content.toLowerCase();
        
        // 基于关键词的模式识别
        if (c.includes('sop') || c.includes('规划') || c.includes('步骤')) return 'SOP_Optimization';
        if (c.includes('error') || c.includes('失败') || c.includes('错误')) return 'Error_Handling';
        if (c.includes('file') || c.includes('文件') || c.includes('读取')) return 'File_Operation';
        if (c.includes('memory') || c.includes('记忆') || c.includes('存储')) return 'Memory_Management';
        if (c.includes('task') || c.includes('任务') || c.includes('执行')) return 'Task_Execution';
        if (c.includes('plugin') || c.includes('插件') || c.includes('扩展')) return 'Plugin_System';
        if (c.includes('llm') || c.includes('模型') || c.includes('ai')) return 'LLM_Integration';
        if (c.includes('web') || c.includes('网络') || c.includes('http')) return 'Web_Network';
        if (c.includes('process') || c.includes('进程') || c.includes('系统')) return 'System_Resource';
        
        // 默认：通用经验
        return 'General_Experience';
    }

    async _synthesizeInsight(pattern) {
        if (!this.llm || typeof this.llm.chat !== 'function') {
            console.log('[CognitiveEvolver] No LLM adapter, using fallback synthesis');
            return this._fallbackSynthesis(pattern);
        }
        
        const experiences = pattern.items.map(i => {
            const content = typeof i.content === 'string' ? i.content : JSON.stringify(i.content);
            return `- ${content.substring(0, 200)}`;
        }).join('\n');
        
        const prompt = `You are a cognitive systems architect. Synthesize multiple experiences into one universal principle.

Pattern: ${pattern.key}
Frequency: ${pattern.frequency} times
Keywords: ${Array.from(pattern.keywords).join(', ')}

Experiences:
${experiences}

Task: Synthesize these into ONE concise, actionable universal principle (1-2 sentences max).
The principle must be generalizable to future similar situations.

Output ONLY the synthesized principle, no explanation.`;

        try {
            const insight = await this.llm.chat([
                { role: 'system', content: 'You are a cognitive philosopher and systems architect.' },
                { role: 'user', content: prompt }
            ]);
            
            const cleaned = insight.replace(/^[^a-zA-Z\u4e00-\u9fa5]+/, '').trim();
            return `[Cognitive Insight: ${pattern.key}] ${cleaned}`;
        } catch (e) {
            console.error('[CognitiveEvolver] LLM synthesis failed:', e.message);
            return this._fallbackSynthesis(pattern);
        }
    }

    _fallbackSynthesis(pattern) {
        const keywords = Array.from(pattern.keywords).slice(0, 3);
        const count = pattern.frequency;
        return `[Cognitive Insight: ${pattern.key}] When dealing with ${keywords.join('/')} situations (seen ${count} times), prefer established patterns over improvisation.`;
    }

    async _hasSimilarInsight(patternKey) {
        const l3Memories = this.memoryManager.layers.L3;
        
        for (const [id, item] of l3Memories) {
            const content = (item.content || '').toLowerCase();
            // 简单相似性检测：共享关键词
            if (content.includes(patternKey.toLowerCase().replace('_', ' '))) {
                return true;
            }
        }
        return false;
    }

    async evolveMultiple(patterns) {
        const results = [];
        for (const pattern of patterns) {
            const insight = await this._synthesizeInsight(pattern);
            if (insight) {
                await this.memoryManager.pushMemory(insight, 'L3');
                results.push({ pattern: pattern.key, insight });
            }
        }
        return results;
    }

    getEvolutionStats() {
        return {
            totalEvolutions: this.evolutionHistory.length,
            lastEvolution: this.lastEvolutionTime,
            threshold: this.evolutionThreshold,
            recentEvolutions: this.evolutionHistory.slice(-5)
        };
    }

    async shouldEvolve() {
        const l2Count = this.memoryManager.layers.L2.size;
        if (l2Count < this.evolutionThreshold) {
            return { should: false, reason: 'Not enough L2 memories' };
        }
        
        if (this.lastEvolutionTime) {
            const hoursSince = (Date.now() - this.lastEvolutionTime) / (1000 * 3600);
            if (hoursSince < 1) {
                return { should: false, reason: 'Recent evolution performed' };
            }
        }
        
        return { should: true, l2Count };
    }
}

module.exports = CognitiveEvolver;