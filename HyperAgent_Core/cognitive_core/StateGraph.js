// StateGraph — 状态图编排引擎

class StateGraph {
    /**
     * @param {object} options
     * @param {object} options.stateSchema - { key: { default: any, reducer: 'replace'|'append'|Function } }
     */
    constructor(options = {}) {
        this.stateSchema = options.stateSchema || {};
        this._nodes = new Map();   // name -> { processor, metadata }
        this._edges = [];          // { from, to }
        this._conditionalEdges = []; // { from, conditionFn, mapping: { result -> target } }
        this._entryPoint = null;
        this._checkpointInterval = options.checkpointInterval || 3;
        this._history = [];
        this._compiled = false;
    }

    /**
     * 添加节点
     * @param {string} name
     * @param {Function} processor - (state) => partialState 或 async (state) => partialState
     * @param {object} metadata - { description, timeout }
     */
    addNode(name, processor, metadata = {}) {
        if (this._compiled) throw new Error('Graph already compiled');
        this._nodes.set(name, { processor, metadata });
        if (!this._entryPoint) this._entryPoint = name;
        return this;
    }

    setEntryPoint(name) {
        if (!this._nodes.has(name)) throw new Error(`Node not found: ${name}`);
        this._entryPoint = name;
        return this;
    }

    addEdge(from, to) {
        if (!this._nodes.has(from)) throw new Error(`Source node not found: ${from}`);
        if (!this._nodes.has(to)) throw new Error(`Target node not found: ${to}`);
        this._edges.push({ from, to });
        return this;
    }

    /**
     * 添加条件边
     * @param {string} from - 源节点
     * @param {Function} conditionFn - (state) => string，返回目标键名
     * @param {object} mapping - { resultKey -> targetNodeName }
     */
    addConditionalEdges(from, conditionFn, mapping) {
        if (!this._nodes.has(from)) throw new Error(`Source node not found: ${from}`);
        for (const target of Object.values(mapping)) {
            if (!this._nodes.has(target)) throw new Error(`Target node not found: ${target}`);
        }
        this._conditionalEdges.push({ from, conditionFn, mapping });
        return this;
    }

    /**
     * 编译图（验证连通性）
     */
    compile() {
        if (this._nodes.size === 0) throw new Error('Graph has no nodes');
        if (!this._entryPoint) throw new Error('Graph has no entry point');

        // 验证所有边引用的节点存在
        for (const edge of this._edges) {
            if (!this._nodes.has(edge.from)) throw new Error(`Edge from unknown node: ${edge.from}`);
            if (!this._nodes.has(edge.to)) throw new Error(`Edge to unknown node: ${edge.to}`);
        }

        // 计算拓扑排序
        this._topoOrder = this._topologicalSort();
        this._compiled = true;
        return this;
    }

    /**
     * 运行图
     * @param {object} initialState
     * @returns {Promise<{ state: object, history: Array }>}
     */
    async run(initialState = {}) {
        if (!this._compiled) this.compile();

        let state = this._initState(initialState);
        let currentNode = this._entryPoint;
        let stepCount = 0;
        this._history = [];

        while (currentNode) {
            stepCount++;
            const node = this._nodes.get(currentNode);
            if (!node) break;

            // 记录进入节点时的状态快照
            const snapshot = { node: currentNode, step: stepCount, stateBefore: JSON.parse(JSON.stringify(state)) };

            try {
                // 执行节点处理器
                const partial = await node.processor(state);
                if (partial !== undefined && partial !== null) {
                    state = this._applyReducers(state, partial);
                }
            } catch (e) {
                snapshot.error = e.message;
                this._history.push(snapshot);
                throw e;
            }

            // 记录完成状态
            snapshot.stateAfter = JSON.parse(JSON.stringify(state));
            snapshot.timestamp = new Date().toISOString();
            this._history.push(snapshot);

            // 检查点（每 N 步）
            if (stepCount % this._checkpointInterval === 0) {
                snapshot._checkpoint = true;
            }

            // 确定下一个节点
            currentNode = this._resolveNextNode(currentNode, state);

            // 防止无限循环
            if (stepCount > 100) {
                console.warn('[StateGraph] Max steps (100) reached, stopping');
                break;
            }
        }

        return { state, history: this._history, steps: stepCount };
    }

    /**
     * 从历史中恢复某个检查点
     */
    restore(checkpointIndex) {
        const checkpoint = this._history[checkpointIndex];
        if (!checkpoint || !checkpoint._checkpoint) {
            throw new Error(`Invalid checkpoint: ${checkpointIndex}`);
        }
        return checkpoint.stateAfter || checkpoint.stateBefore;
    }

    getHistory() {
        return this._history;
    }

    checkpoint(state) {
        return {
            timestamp: new Date().toISOString(),
            state: JSON.parse(JSON.stringify(state)),
            step: this._history.length
        };
    }

    // ===== 内部方法 =====

    _initState(input) {
        const state = {};
        for (const [key, schema] of Object.entries(this.stateSchema)) {
            state[key] = input[key] !== undefined ? input[key] : (schema.default !== undefined ? schema.default : null);
        }
        return { ...state, ...input };
    }

    _applyReducers(state, partial) {
        const newState = { ...state };

        for (const [key, value] of Object.entries(partial)) {
            const schema = this.stateSchema[key];

            if (!schema || !schema.reducer || schema.reducer === 'replace') {
                newState[key] = value;
            } else if (schema.reducer === 'append') {
                newState[key] = Array.isArray(newState[key]) ? [...newState[key], ...(Array.isArray(value) ? value : [value])] : value;
            } else if (typeof schema.reducer === 'function') {
                newState[key] = schema.reducer(newState[key], value);
            } else {
                newState[key] = value;
            }
        }

        return newState;
    }

    _resolveNextNode(currentNode, state) {
        // 检查条件边
        for (const ce of this._conditionalEdges) {
            if (ce.from === currentNode) {
                try {
                    const result = ce.conditionFn(state);
                    const target = ce.mapping[result];
                    if (target) return target;
                } catch (e) {
                    // 条件判断失败，继续检查普通边
                    break;
                }
            }
        }

        // 检查普通边
        const outgoing = this._edges.filter(e => e.from === currentNode);
        if (outgoing.length === 1) return outgoing[0].to;
        if (outgoing.length > 1) {
            // 多条边：取拓扑序中第一个
            const topoIndex = new Map(this._topoOrder.map((n, i) => [n, i]));
            outgoing.sort((a, b) => (topoIndex.get(a.to) || 0) - (topoIndex.get(b.to) || 0));
            return outgoing[0].to;
        }

        return null; // 无出边 = 终止
    }

    _topologicalSort() {
        const inDegree = new Map();
        const adjacency = new Map();

        for (const [name] of this._nodes) {
            inDegree.set(name, 0);
            adjacency.set(name, []);
        }

        for (const edge of this._edges) {
            adjacency.get(edge.from).push(edge.to);
            inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
        }

        const queue = [];
        for (const [name, deg] of inDegree) {
            if (deg === 0) queue.push(name);
        }

        const sorted = [];
        while (queue.length > 0) {
            const node = queue.shift();
            sorted.push(node);
            for (const neighbor of adjacency.get(node) || []) {
                inDegree.set(neighbor, inDegree.get(neighbor) - 1);
                if (inDegree.get(neighbor) === 0) queue.push(neighbor);
            }
        }

        return sorted;
    }
}

module.exports = StateGraph;
