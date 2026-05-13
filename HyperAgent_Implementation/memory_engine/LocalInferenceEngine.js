// LocalInferenceEngine — built-in local inference engine
class LocalInferenceEngine {
    constructor(options = {}) {
        // 后端模式: 'builtin' | 'ollama'
        this.mode = options.mode || 'builtin';

        // Ollama 配置（仅 mode='ollama' 时使用）
        this.ollamaUrl = options.ollamaUrl || 'http://localhost:11434';
        this.ollamaModel = options.model || 'qwen2.5:1.5b';
        this.ollamaEmbedModel = options.embedModel || 'nomic-embed-text';

        // 内置模型配置
        this.model = options.model || 'builtin-default';
        this.embedModel = options.embedModel || 'builtin-ngram';
        this.timeout = options.timeout || 30000;

        // 内置分类器类别库（预置的知识类别）
        this._categories = {
            '编程开发': ['代码', '程序', '函数', 'API', 'bug', 'debug', '部署', 'git', 'npm', 'node', 'python', 'javascript', 'class', 'module', 'import', 'async', 'promise'],
            '文件操作': ['文件', '目录', '路径', '读写', '删除', '复制', '移动', '重命名', '搜索', '查找'],
            '系统管理': ['进程', '服务', '系统', '配置', '注册表', 'CPU', '内存', '磁盘', '网络', '防火墙'],
            '数据分析': ['数据', '分析', '统计', '报告', '图表', '可视化', '趋势', '对比', '汇总', '指标'],
            '网络通信': ['HTTP', '请求', 'API', 'URL', '服务器', '客户端', 'WebSocket', 'REST', 'JSON'],
            '用户交互': ['对话', '聊天', '问题', '回答', '帮助', '解释', '建议', '推荐'],
            '错误处理': ['错误', '失败', '异常', '崩溃', '超时', '拒绝', '无效', '无法', 'bug'],
            '系统状态': ['CPU', '内存', '磁盘', '负载', '进程', '运行', '状态', '性能', '资源']
        };

        // 实体提取模式库
        this._entityPatterns = [
            // 中文人名（2-4字）
            { type: 'person', pattern: /([一-鿿]{2,4}(?:先生|女士|老师|同学|总|经理))/g },
            { type: 'person', pattern: /([一-鿿]{2,3})(?:说|表示|提出|认为|强调|指出)/g },
            // 组织机构
            { type: 'organization', pattern: /([一-鿿]{2,}(?:公司|集团|组织|团队|部门|委员会|学院|大学|研究院|实验室))/g },
            // 技术概念（英文专业术语）
            { type: 'concept', pattern: /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g },
            { type: 'concept', pattern: /\b([a-z]{2,}(?:OS|QL|ML|AI|API|SDK|IDE|DBMS?))\b/gi },
            // 文件路径
            { type: 'file', pattern: /(?:[a-zA-Z]:\\[\w\\\.\-]+)/g },
            { type: 'file', pattern: /(?:\/[\w\/\.\-]+)/g },
            // 版本号
            { type: 'version', pattern: /\b(\d+\.\d+\.\d+[\w\-\.]*)\b/g },
            // URL
            { type: 'url', pattern: /(https?:\/\/[^\s]+)/g },
        ];

        // 意图模式库（用于 chat 方法）
        this._intentPatterns = {
            summarize: ['摘要', '总结', '概括', 'summarize', 'summary', '简述'],
            classify: ['分类', '归类', '类别', 'classify', 'categorize', '类型'],
            entity: ['实体', '提取', 'extract', 'entity', '识别', '找出'],
            compare: ['比较', '对比', '差异', '区别', 'compare', 'diff', 'different'],
            analyze: ['分析', 'analyze', '评估', '评价', '诊断'],
            greet: ['你好', '您好', 'hi', 'hello', 'hey'],
        };

        // 响应模板
        this._responseTemplates = {
            summarize: (input) => this.summarize(input),
            classify: (input) => `分析结果：${this.classify(input, Object.keys(this._categories))}`,
            entity: (input) => {
                const entities = this.extractEntities(input);
                return entities.length > 0
                    ? `识别到以下实体：${entities.map(e => `${e.name}(${e.type})`).join('、')}`
                    : '未识别到明显实体。';
            },
            analyze: (input) => this.analyze(input, 'general'),
            compare: (input) => `比较分析：${input.substring(0, 100)}...（需要两组数据做对比）`,
            greet: () => '你好！我是 HyperAgent 内置助手。',
        };

        this._ready = false;
        this._stats = {
            totalCalls: 0,
            failedCalls: 0,
            avgLatency: 0,
            mode: this.mode,
            backend: 'builtin'
        };

        // Ollama 状态（仅 ollama 模式）
        this._ollamaReady = false;
        this._capabilities = {
            chat: true,
            embed: true,
            hasModel: true,
            hasEmbed: true,
            availableModels: ['builtin']
        };
    }

    async init() {
        if (this.mode === 'ollama') {
            return this._initOllama();
        }
        // builtin 模式立即就绪
        this._ready = true;
        this._capabilities = {
            chat: true,
            embed: true,
            hasModel: true,
            hasEmbed: true,
            availableModels: ['builtin-ngram-v1']
        };
        console.log(`[LocalInference] Built-in engine READY (chat + embed + classify + summarize)`);
        return true;
    }

    async _initOllama() {
        try {
            const http = require('http');
            const https = require('https');
            const url = new URL(this.ollamaUrl);

            const available = await new Promise((resolve) => {
                const opts = {
                    hostname: url.hostname,
                    port: url.port,
                    path: '/api/tags',
                    method: 'GET',
                    timeout: 5000
                };
                const client = url.protocol === 'https:' ? https : http;
                const req = client.request(opts, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        try { resolve(JSON.parse(data)); }
                        catch { resolve(null); }
                    });
                });
                req.on('error', () => resolve(null));
                req.on('timeout', () => { req.destroy(); resolve(null); });
                req.end();
            });

            if (available && available.models && available.models.length > 0) {
                const modelNames = available.models.map(m => m.name);
                this._ollamaReady = true;
                this._capabilities = {
                    chat: modelNames.some(n => n.startsWith(this.ollamaModel.split(':')[0])),
                    embed: modelNames.some(n => n.startsWith(this.ollamaEmbedModel.split(':')[0])),
                    hasModel: true,
                    hasEmbed: true,
                    availableModels: modelNames
                };
                this._ready = true;
                console.log(`[LocalInference] Ollama backend READY (${modelNames.length} models available)`);
                return true;
            }
        } catch (e) {}

        // Ollama 不可用，回退到 builtin
        console.warn('[LocalInference] Ollama not available, falling back to built-in engine');
        this.mode = 'builtin';
        this._ready = true;
        this._capabilities = {
            chat: true, embed: true, hasModel: true, hasEmbed: true,
            availableModels: ['builtin-ngram-v1']
        };
        return true;
    }

    isReady() { return this._ready; }
    getCapabilities() { return { ...this._capabilities, mode: this.mode }; }
    getStats() {
        return {
            ...this._stats,
            model: this.mode === 'ollama' ? this.ollamaModel : 'builtin-default',
            embedModel: this.mode === 'ollama' ? this.ollamaEmbedModel : 'builtin-ngram'
        };
    }

    // 公用入口：根据后端模式分发

    async generateEmbedding(text) {
        this._timedCall('embed');
        const start = Date.now();
        if (this.mode === 'ollama' && this._ollamaReady) {
            try {
                const result = await this._ollamaEmbed(text);
                this._recordLatency(start);
                return result;
            } catch (e) { /* fallthrough */ }
        }
        const result = this._builtinEmbedding(text);
        this._recordLatency(start);
        return result;
    }

    async chat(messages, options = {}) {
        this._timedCall('chat');
        const start = Date.now();
        if (this.mode === 'ollama' && this._ollamaReady && this._capabilities.chat) {
            try {
                const result = await this._ollamaChat(messages, options);
                this._recordLatency(start);
                return result;
            } catch (e) { /* fallthrough */ }
        }
        const result = this._builtinChat(messages);
        this._recordLatency(start);
        return result;
    }

    async summarize(text) {
        this._timedCall('summarize');
        const start = Date.now();
        if (this.mode === 'ollama' && this._ollamaReady && this._capabilities.chat) {
            try {
                const msgs = [
                    { role: 'system', content: 'Summarize concisely in Chinese, 3 sentences max.' },
                    { role: 'user', content: text.substring(0, 2048) }
                ];
                const result = await this._ollamaChat(msgs, { maxTokens: 256 });
                this._recordLatency(start);
                return result;
            } catch (e) {}
        }
        const result = this._builtinSummarize(text);
        this._recordLatency(start);
        return result;
    }

    async classify(text, categories) {
        this._timedCall('classify');
        const start = Date.now();
        if (this.mode === 'ollama' && this._ollamaReady && this._capabilities.chat) {
            try {
                const catList = Array.isArray(categories) ? categories.join(', ') : categories;
                const msgs = [
                    { role: 'system', content: `你是一个分类器。从以下类别中选择一个最匹配的，只输出类别名称：${catList}` },
                    { role: 'user', content: text.substring(0, 1024) }
                ];
                const result = await this._ollamaChat(msgs, { temperature: 0.1, maxTokens: 32 });
                this._recordLatency(start);
                return result;
            } catch (e) {}
        }
        const result = this._builtinClassify(text, categories);
        this._recordLatency(start);
        return result;
    }

    async extractEntities(text) {
        this._timedCall('extract');
        const start = Date.now();
        if (this.mode === 'ollama' && this._ollamaReady && this._capabilities.chat) {
            try {
                const msgs = [
                    { role: 'system', content: 'Extract named entities. Return JSON array: [{"type":"...","name":"..."}]' },
                    { role: 'user', content: text.substring(0, 1024) }
                ];
                const result = await this._ollamaChat(msgs, { temperature: 0.1, maxTokens: 256 });
                const jsonMatch = result.match(/\[[\s\S]*\]/);
                if (jsonMatch) {
                    this._recordLatency(start);
                    return JSON.parse(jsonMatch[0]);
                }
            } catch (e) {}
        }
        const result = this._builtinExtractEntities(text);
        this._recordLatency(start);
        return result;
    }

    async analyze(text, task = 'analyze') {
        this._timedCall('analyze');
        const start = Date.now();
        if (this.mode === 'ollama' && this._ollamaReady && this._capabilities.chat) {
            try {
                const msgs = [
                    { role: 'system', content: `你是数据分析引擎。Task: ${task}。输出结构化中文结论，不超过100字。` },
                    { role: 'user', content: text.substring(0, 2048) }
                ];
                const result = await this._ollamaChat(msgs, { maxTokens: 256 });
                this._recordLatency(start);
                return result;
            } catch (e) {}
        }
        const result = this._builtinAnalyze(text, task);
        this._recordLatency(start);
        return result;
    }

    async compare(current, previous) {
        this._timedCall('compare');
        const start = Date.now();
        if (this.mode === 'ollama' && this._ollamaReady && this._capabilities.chat) {
            try {
                const msgs = [
                    { role: 'system', content: '比较两组数据的变化，输出关键差异和趋势。中文，不超过100字。' },
                    { role: 'user', content: `Before:\n${JSON.stringify(previous)}\n\nAfter:\n${JSON.stringify(current)}` }
                ];
                const result = await this._ollamaChat(msgs, { maxTokens: 128 });
                this._recordLatency(start);
                return result;
            } catch (e) {}
        }
        const result = this._builtinCompare(current, previous);
        this._recordLatency(start);
        return result;
    }

    // 内置实现：文本嵌入

    _builtinEmbedding(text) {
        const dim = 384;
        const vec = new Float64Array(dim);
        const str = text.toLowerCase();
        const totalGrams = {};

        // 提取 1-3 gram 并计算 TF
        for (let n = 1; n <= 3; n++) {
            for (let i = 0; i <= str.length - n; i++) {
                const gram = str.substring(i, i + n);
                const hash = this._hashCode(gram);
                const idx = Math.abs(hash) % dim;
                // TF 加权：短 gram 权重低，长 gram 权重高
                const weight = n * (1 / (1 + Math.abs(hash % 7)));
                vec[idx] += weight;
                totalGrams[gram] = (totalGrams[gram] || 0) + 1;
            }
        }

        //  IDF 近似：罕见 gram 加权
        const uniqueGrams = Object.keys(totalGrams).length;
        for (let i = 0; i < dim; i++) {
            if (vec[i] > 0) {
                vec[i] *= Math.log1p(uniqueGrams);
            }
        }

        // L2 归一化
        const norm = Math.sqrt(Array.from(vec).reduce((s, v) => s + v * v, 0));
        if (norm > 0) {
            for (let i = 0; i < dim; i++) vec[i] /= norm;
        }

        return Array.from(vec);
    }

    // 内置实现：聊天/对话

    _builtinChat(messages) {
        const lastMsg = messages[messages.length - 1];
        const content = (lastMsg?.content || '').toLowerCase();
        const allContent = messages.map(m => (m.content || '')).join('\n');

        // 检查 system prompt 中的任务类型
        const systemMsg = messages.find(m => m.role === 'system');
        const sysContent = (systemMsg?.content || '').toLowerCase();

        // 摘要请求
        if (sysContent.includes('summar') || sysContent.includes('摘要') || sysContent.includes('概括')) {
            return this._builtinSummarize(allContent);
        }

        // 分类请求
        if (sysContent.includes('classif') || sysContent.includes('分类')) {
            const catMatch = sysContent.match(/(?:类别|categories|from):?\s*([^。\n]+)/);
            const cats = catMatch ? catMatch[1].split(/[,，、\s]+/).filter(Boolean) : Object.keys(this._categories);
            const textToClassify = messages.find(m => m.role === 'user')?.content || '';
            return this._builtinClassify(textToClassify, cats);
        }

        // 实体提取请求
        if (sysContent.includes('entity') || sysContent.includes('实体')) {
            const text = messages.find(m => m.role === 'user')?.content || '';
            const entities = this._builtinExtractEntities(text);
            return JSON.stringify(entities);
        }

        // 意图匹配
        for (const [intent, patterns] of Object.entries(this._intentPatterns)) {
            if (patterns.some(p => content.includes(p))) {
                const handler = this._responseTemplates[intent];
                if (handler) return handler(allContent);
            }
        }

        // 默认回复：基于内容的智能响应
        return this._builtinGenerateReply(messages);
    }

    _builtinGenerateReply(messages) {
        const lastMsg = messages[messages.length - 1]?.content || '';
        const text = lastMsg.toLowerCase();

        // 问题检测
        if (text.includes('?') || text.includes('？') || text.startsWith('what') || text.startsWith('how') || text.startsWith('why')) {
            // 提取关键词做简单回答
            const keywords = text.split(/\s+/).filter(w => w.length > 3).slice(0, 5);
            if (keywords.length > 0) {
                return `关于「${keywords.join('、')}」的分析：根据内置知识库，这是一个需要进一步查证的话题。建议使用网络搜索获取最新信息。`;
            }
            return `收到您的问题。作为内置助手，我可以进行文本分析、分类、摘要和实体提取。如需更深入的答复，建议连接外部 LLM。`;
        }

        // 指令型
        if (text.includes('分析') || text.includes('检查')) {
            return this._builtinAnalyze(lastMsg, 'general');
        }
        if (text.includes('总结') || text.includes('摘要')) {
            return this._builtinSummarize(lastMsg);
        }

        return `已收到您的消息。我目前以内置模式运行，支持：摘要、分类、实体提取、文本分析、嵌入生成。需要我做什么？`;
    }

    // 内置实现：自动摘要

    _builtinSummarize(text) {
        const sentences = this._splitSentences(text);
        if (sentences.length <= 2) return text.substring(0, 200);

        // 计算每个句子的分数
        const scored = sentences.map((s, i) => {
            const words = s.split(/\s+/).filter(w => w.length > 1);
            const wordFreq = {};
            for (const w of words) wordFreq[w] = (wordFreq[w] || 0) + 1;

            // TF-IDF 近似分数
            let tfidfScore = 0;
            for (const [w, freq] of Object.entries(wordFreq)) {
                const df = sentences.filter(s2 => s2.includes(w)).length;
                const idf = Math.log((sentences.length + 1) / (df + 1)) + 1;
                tfidfScore += freq * idf;
            }

            // 位置偏置（前两句权重高）
            const positionScore = i < 2 ? 1.5 : (i === sentences.length - 1 ? 1.2 : 1.0);

            // 长度惩罚（太短或太长扣分）
            const lengthScore = s.length > 20 && s.length < 200 ? 1.0 : 0.5;

            return {
                sentence: s,
                score: tfidfScore * positionScore * lengthScore,
                index: i
            };
        });

        // 选 top 3 句
        const topSentences = scored
            .sort((a, b) => b.score - a.score)
            .slice(0, 3)
            .sort((a, b) => a.index - b.index);

        return topSentences.map(s => s.sentence).join('。') || text.substring(0, 200);
    }

    // 内置实现：文本分类

    _builtinClassify(text, categories) {
        const catList = Array.isArray(categories) ? categories : [categories];
        const textLower = text.toLowerCase();

        let bestCategory = catList[0] || 'general';
        let bestScore = -1;

        for (const cat of catList) {
            const keywords = this._categories[cat];
            if (!keywords) {
                // 未知类别，用名称本身做关键词匹配
                const catWords = cat.toLowerCase().split(/\s+/);
                const matchCount = catWords.filter(w => textLower.includes(w)).length;
                const score = matchCount / Math.max(catWords.length, 1);
                if (score > bestScore) { bestScore = score; bestCategory = cat; }
                continue;
            }

            const matchCount = keywords.filter(k => textLower.includes(k)).length;
            const score = matchCount / keywords.length;
            if (score > bestScore) { bestScore = score; bestCategory = cat; }
        }

        return bestCategory;
    }

    // 内置实现：实体提取

    _builtinExtractEntities(text) {
        const entities = [];
        const seen = new Set();

        for (const { type, pattern } of this._entityPatterns) {
            const matches = text.matchAll(pattern);
            for (const m of matches) {
                const name = m[1] || m[0];
                if (name && name.length > 1 && !seen.has(name)) {
                    seen.add(name);
                    entities.push({ type, name: name.trim() });
                }
            }
        }

        // 技术术语提取（驼峰式 + 大写缩写）
        const techTerms = text.match(/\b([A-Z]{2,})\b/g);
        if (techTerms) {
            for (const t of techTerms) {
                if (!seen.has(t) && t.length >= 2) {
                    seen.add(t);
                    entities.push({ type: 'concept', name: t });
                }
            }
        }

        // 数字表达式提取（百分比、数值）
        const numbers = text.match(/\b(\d+[.%])\b/g);
        if (numbers) {
            for (const n of numbers) {
                if (!seen.has(n)) {
                    seen.add(n);
                    entities.push({ type: 'metric', name: n });
                }
            }
        }

        return entities;
    }

    // 内置实现：文本分析

    _builtinAnalyze(text, task) {
        const sentences = this._splitSentences(text);
        const words = text.split(/\s+/).filter(w => w.length > 0);
        const chars = text.length;

        // 关键词提取（高频词）
        const wordFreq = {};
        for (const w of words) {
            const clean = w.toLowerCase().replace(/[^a-zA-Z一-鿿0-9]/g, '');
            if (clean.length > 1) wordFreq[clean] = (wordFreq[clean] || 0) + 1;
        }
        const topKeywords = Object.entries(wordFreq)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([w, f]) => `${w}(${f}次)`)
            .join('、');

        // 情感倾向（简单关键词）
        const positiveWords = ['好', '优秀', '成功', '完成', '通过', '提升', '增长', '改进', '稳定', '恢复'];
        const negativeWords = ['错误', '失败', '问题', '崩溃', '异常', '下降', '风险', '警告', '停止', '无法'];
        const posCount = positiveWords.filter(w => text.includes(w)).length;
        const negCount = negativeWords.filter(w => text.includes(w)).length;
        const sentiment = posCount > negCount ? '积极' : (negCount > posCount ? '消极' : '中性');

        // 实体提取
        const entities = this._builtinExtractEntities(text);

        const result = [
            `文本分析结果：`,
            `- 长度：${chars}字符，${words.length}词，${sentences.length}句`,
            `- 情感倾向：${sentiment}`,
            `- 关键词：${topKeywords || '无显著关键词'}`,
            `- 实体：${entities.length > 0 ? entities.slice(0, 5).map(e => `${e.name}(${e.type})`).join('、') : '未识别到实体'}`,
            `- 复杂度：${chars > 500 ? '较复杂' : (chars > 100 ? '中等' : '简短')}`
        ];

        // 根据 task 调整输出
        if (task.includes('state') || task.includes('状态') || task.includes('device')) {
            return `承载体状态分析：检测到${sentiment}趋势。${topKeywords ? `关注点：${topKeywords.substring(0, 60)}` : '状态稳定'}。`;
        }

        return result.join('\n');
    }

    // 内置实现：差异比较

    _builtinCompare(current, previous) {
        const curStr = typeof current === 'string' ? current : JSON.stringify(current, null, 2);
        const prevStr = typeof previous === 'string' ? previous : JSON.stringify(previous, null, 2);

        const curLines = curStr.split('\n');
        const prevLines = prevStr.split('\n');

        let additions = 0;
        let deletions = 0;
        let changes = 0;

        // 简单行 diff
        const prevSet = new Set(prevLines.map(l => l.trim()));
        const curSet = new Set(curLines.map(l => l.trim()));

        for (const line of curLines) {
            if (!prevSet.has(line.trim())) additions++;
        }
        for (const line of prevLines) {
            if (!curSet.has(line.trim())) deletions++;
        }

        // 数值变化检测
        const numPattern = /(\d+\.?\d*)/g;
        const curNums = [...curStr.matchAll(numPattern)].map(m => parseFloat(m[1])).filter(n => !isNaN(n));
        const prevNums = [...prevStr.matchAll(numPattern)].map(m => parseFloat(m[1])).filter(n => !isNaN(n));
        const avgCur = curNums.length > 0 ? curNums.reduce((a, b) => a + b, 0) / curNums.length : 0;
        const avgPrev = prevNums.length > 0 ? prevNums.reduce((a, b) => a + b, 0) / prevNums.length : 0;
        let trend = '';
        if (avgCur > avgPrev * 1.1) trend = '（数值整体上升）';
        else if (avgCur < avgPrev * 0.9) trend = '（数值整体下降）';
        else if (curNums.length > 0 && prevNums.length > 0) trend = '（数值基本持平）';

        return `检测到${additions}处新增、${deletions}处移除${trend}。${additions + deletions > 5 ? '变化幅度较大' : '变化较小'}。`;
    }

    // Ollama 后端

    async _ollamaChat(messages, options = {}) {
        const http = require('http');
        const url = new URL(this.ollamaUrl);
        return new Promise((resolve, reject) => {
            const data = JSON.stringify({
                model: this.ollamaModel,
                messages: messages.map(m => ({
                    role: m.role || 'user',
                    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
                })),
                stream: false,
                options: { temperature: options.temperature ?? 0.3, num_predict: options.maxTokens || 512 }
            });
            const req = http.request({
                hostname: url.hostname, port: url.port,
                path: '/api/chat', method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                timeout: this.timeout
            }, (res) => {
                let body = '';
                res.on('data', c => body += c);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(body);
                        resolve(parsed.message?.content || '');
                    } catch { reject(new Error('Ollama parse error')); }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
            req.write(data);
            req.end();
        });
    }

    async _ollamaEmbed(text) {
        const http = require('http');
        const url = new URL(this.ollamaUrl);
        return new Promise((resolve, reject) => {
            const data = JSON.stringify({ model: this.ollamaEmbedModel, prompt: text.substring(0, 2048) });
            const req = http.request({
                hostname: url.hostname, port: url.port,
                path: '/api/embeddings', method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                timeout: this.timeout
            }, (res) => {
                let body = '';
                res.on('data', c => body += c);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(body);
                        resolve(parsed.embedding);
                    } catch { reject(new Error('Ollama embed parse error')); }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
            req.write(data);
            req.end();
        });
    }

    // 工具方法

    _splitSentences(text) {
        return text
            .replace(/([。！？.!?\n])\s*/g, '$1||')
            .split('||')
            .map(s => s.trim())
            .filter(s => s.length > 5);
    }

    _hashCode(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const chr = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + chr;
            hash |= 0;
        }
        return hash;
    }

    _timedCall(name) {
        this._stats.totalCalls++;
    }

    _recordLatency(start) {
        const lat = Date.now() - start;
        this._stats.avgLatency = this._stats.avgLatency * 0.9 + lat * 0.1;
    }
}

module.exports = LocalInferenceEngine;
