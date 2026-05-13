// TreeOfThoughts — 思维树多分支推理

class TreeOfThoughts {
    constructor(options = {}) {
        this.llmAdapter = options.llmAdapter || null;
        this.searchMode = options.searchMode || 'bfs'; // 'bfs' | 'dfs'
        this.maxBranches = options.maxBranches || 3;
        this.maxDepth = options.maxDepth || 5;
        this.beamSize = options.beamSize || 2; // BFS 保留的分支数
        this.temperature = options.temperature || 0.7;

        this.stats = {
            totalSolves: 0,
            totalThoughtsGenerated: 0,
            totalEvaluations: 0,
            prunedBranches: 0
        };
    }

    /**
     * 求解问题
     * @param {string} problem
     * @param {object} context - { state, tools, constraints }
     * @returns {Promise<{ solution: string, tree: object, confidence: number }>}
     */
    async solve(problem, context = {}) {
        this.stats.totalSolves++;

        const root = {
            id: 'root',
            thought: problem,
            depth: 0,
            value: 0,
            parent: null,
            children: [],
            path: [problem.substring(0, 100)]
        };

        const result = this.searchMode === 'bfs'
            ? await this._bfsSearch(root, problem, context)
            : await this._dfsSearch(root, problem, context, 0);

        // 从最佳叶节点回溯路径
        const bestLeaf = this._findBestLeaf(result.tree);
        const solution = bestLeaf ? bestLeaf.thought : '';

        return {
            solution,
            tree: result.tree,
            confidence: bestLeaf ? bestLeaf.value : 0,
            metadata: {
                mode: this.searchMode,
                totalNodes: this._countNodes(result.tree),
                depth: bestLeaf ? bestLeaf.depth : 0,
                stats: { ...this.stats }
            }
        };
    }

    /**
     * BFS 搜索
     */
    async _bfsSearch(root, problem, context) {
        let currentLevel = [root];

        for (let depth = 1; depth <= this.maxDepth; depth++) {
            const allCandidates = [];

            for (const node of currentLevel) {
                // 生成下一轮想法
                const thoughts = await this._generateThoughts(node.thought, problem, context);
                this.stats.totalThoughtsGenerated += thoughts.length;

                for (const thought of thoughts) {
                    const child = {
                        id: `n_${depth}_${allCandidates.length}`,
                        thought,
                        depth,
                        value: 0,
                        parent: node.id,
                        children: [],
                        path: [...node.path, thought.substring(0, 100)]
                    };
                    node.children.push(child);
                    allCandidates.push(child);
                }
            }

            if (allCandidates.length === 0) break;

            // 评估所有候选
            const evaluated = [];
            for (const candidate of allCandidates) {
                const score = await this._evaluateThought(candidate.thought, problem, context);
                this.stats.totalEvaluations++;
                candidate.value = score.value;
                evaluated.push({ node: candidate, score: score.value });
            }

            // 语义剪枝（合并相似分支）
            const pruned = this._semanticPrune(evaluated);
            this.stats.prunedBranches += (evaluated.length - pruned.length);

            // 保留 top-K
            pruned.sort((a, b) => b.score - a.score);
            const topK = pruned.slice(0, this.beamSize);

            // 移除未选中的子节点
            const selectedIds = new Set(topK.map(t => t.node.id));
            for (const node of currentLevel) {
                node.children = node.children.filter(c => selectedIds.has(c.id));
            }

            currentLevel = topK.map(t => t.node);

            // 检查是否有解（value >= 0.9）
            if (topK.some(t => t.score >= 0.9)) break;
        }

        return { tree: root };
    }

    /**
     * DFS 搜索（带回溯）
     */
    async _dfsSearch(node, problem, context, depth) {
        if (depth >= this.maxDepth) return node;

        const thoughts = await this._generateThoughts(node.thought, problem, context);
        this.stats.totalThoughtsGenerated += thoughts.length;

        let bestNode = node;
        let bestValue = -1;

        for (const thought of thoughts) {
            const child = {
                id: `n_${depth}_${Math.random().toString(36).substr(2, 4)}`,
                thought,
                depth,
                value: 0,
                parent: node.id,
                children: [],
                path: [...node.path, thought.substring(0, 100)]
            };
            node.children.push(child);

            const score = await this._evaluateThought(thought, problem, context);
            this.stats.totalEvaluations++;
            child.value = score.value;

            // 剪枝：impossible 分支不继续探索
            if (score.verdict === 'impossible') {
                this.stats.prunedBranches++;
                continue;
            }

            // 递归探索
            if (score.verdict !== 'sure' || depth < this.maxDepth) {
                await this._dfsSearch(child, problem, context, depth + 1);
            }

            // 追踪最佳节点
            const leafBest = this._findBestLeaf(child);
            if (leafBest && leafBest.value > bestValue) {
                bestValue = leafBest.value;
                bestNode = leafBest;
            }
        }

        return node;
    }

    /**
     * LLM 生成下一轮想法
     */
    async _generateThoughts(currentThought, problem, context) {
        if (!this.llmAdapter) {
            return [currentThought];
        }

        const prompt = `你正在解决一个问题。请从当前状态出发，生成 ${this.maxBranches} 个不同的下一步思考方向。

【问题】${problem}
【当前状态】${currentThought}
【可用工具】${context.tools ? context.tools.join(', ') : '无'}

请返回一个 JSON 数组，包含 ${this.maxBranches} 个不同的下一步想法：
["想法1", "想法2", "想法3"]

每个想法应该是具体的推理步骤或行动方案，不要重复。`;

        const response = await this.llmAdapter.chat([
            { role: 'system', content: '你是一个多分支推理系统。输出严格的 JSON 数组。' },
            { role: 'user', content: prompt }
        ]);

        const text = typeof response === 'string' ? response :
                     (response.content || response.message?.content || '');

        try {
            const match = text.match(/\[[\s\S]*\]/);
            if (match) {
                const thoughts = JSON.parse(match[0]);
                return Array.isArray(thoughts) ? thoughts.slice(0, this.maxBranches) : [currentThought];
            }
        } catch (e) {}

        return [currentThought];
    }

    /**
     * LLM 评估想法（sure/maybe/impossible + 数值评分）
     */
    async _evaluateThought(thought, problem, context) {
        if (!this.llmAdapter) {
            return { value: 0.5, verdict: 'maybe', reasoning: 'No LLM' };
        }

        const prompt = `评估以下思考方向对解决问题的价值。

【问题】${problem}
【思考方向】${thought}

请评估：
1. 这个方向对解决问题有帮助吗？
2. 可行性如何？
3. 风险和收益如何？

只返回 JSON：
{
  "value": 0.0-1.0,
  "verdict": "sure" | "maybe" | "impossible",
  "reasoning": "简短理由（一句话）"
}`;

        const response = await this.llmAdapter.chat([
            { role: 'system', content: '你是一个思维评估系统。严格返回 JSON。' },
            { role: 'user', content: prompt }
        ]);

        const text = typeof response === 'string' ? response :
                     (response.content || response.message?.content || '');

        try {
            const match = text.match(/\{[\s\S]*\}/);
            if (match) {
                return JSON.parse(match[0]);
            }
        } catch (e) {}

        return { value: 0.5, verdict: 'maybe', reasoning: 'Parse fallback' };
    }

    /**
     * 语义剪枝：合并相似分支
     */
    _semanticPrune(evaluated) {
        if (evaluated.length <= 1) return evaluated;

        const clusters = [];
        const threshold = 0.6;

        for (const item of evaluated) {
            let added = false;
            for (const cluster of clusters) {
                const sim = this._jaccardSimilarity(
                    item.node.thought,
                    cluster[0].node.thought
                );
                if (sim > threshold) {
                    cluster.push(item);
                    added = true;
                    break;
                }
            }
            if (!added) {
                clusters.push([item]);
            }
        }

        // 每个簇保留最高分
        return clusters.map(cluster =>
            cluster.reduce((best, curr) => curr.score > best.score ? curr : best)
        );
    }

    _jaccardSimilarity(a, b) {
        const setA = new Set(a.toLowerCase().split(/\s+/));
        const setB = new Set(b.toLowerCase().split(/\s+/));
        const intersection = new Set([...setA].filter(x => setB.has(x)));
        const union = new Set([...setA, ...setB]);
        return intersection.size / Math.max(union.size, 1);
    }

    _findBestLeaf(node) {
        if (node.children.length === 0) return node;

        let best = null;
        let bestValue = -1;

        for (const child of node.children) {
            const leaf = this._findBestLeaf(child);
            if (leaf && leaf.value > bestValue) {
                bestValue = leaf.value;
                best = leaf;
            }
        }

        return best;
    }

    _countNodes(node) {
        let count = 1;
        for (const child of node.children) {
            count += this._countNodes(child);
        }
        return count;
    }

    getStats() {
        return { ...this.stats };
    }
}

module.exports = TreeOfThoughts;
