// ParallelPipeline - parallel task pipeline
const EventEmitter = require('events');

class TaskNode {
    constructor(id, task, dependencies = []) {
        this.id = id;
        this.task = task;
        this.dependencies = dependencies; // 依赖的 taskId 数组
        this.status = 'PENDING'; // PENDING | RUNNING | SUCCESS | FAILED | SKIPPED
        this.result = null;
        this.error = null;
        this.startTime = null;
        this.endTime = null;
    }
}

class ParallelPipeline extends EventEmitter {
    constructor(options = {}) {
        super();
        this.maxConcurrency = options.maxConcurrency || 5;
        this.taskTimeout = options.taskTimeout || 60000; // 默认60秒
        this.tasks = new Map();      // taskId -> TaskNode
        this.runningTasks = new Map(); // 正在运行的任务
        this.results = new Map();     // taskId -> result
        this._executionQueue = [];
        this._eventLog = [];
    }

    /**
     * Register a task
     */
    register(taskId, taskFn, dependencies = []) {
        if (this.tasks.has(taskId)) {
            throw new Error(`Task ${taskId} already registered`);
        }
        const node = new TaskNode(taskId, taskFn, dependencies);
        this.tasks.set(taskId, node);
        this._log('REGISTER', taskId, { dependencies });
    }

    /**
     * Batch register tasks
     */
    registerBatch(tasks) {
        for (const { id, fn, deps } of tasks) {
            this.register(id, fn, deps || []);
        }
    }

    /**
     * Execute all tasks in dependency order
     */
    async run() {
        const executionPlan = this._buildExecutionPlan();
        const results = {};

        for (const layer of executionPlan) {
            // 同一层级的任务并行执行
            const promises = layer.map(taskId => this._executeTask(taskId));
            const layerResults = await Promise.allSettled(promises);

            // 聚合结果
            for (let i = 0; i < layer.length; i++) {
                const taskId = layer[i];
                const outcome = layerResults[i];
                if (outcome.status === 'fulfilled') {
                    results[taskId] = { success: true, value: outcome.value };
                } else {
                    results[taskId] = { success: false, error: outcome.reason?.message || String(outcome.reason) };
                }
            }
        }

        return results;
    }

    /**
     * Execute a single task
     */
    async _executeTask(taskId) {
        const node = this.tasks.get(taskId);
        if (!node) throw new Error(`Task ${taskId} not found`);

        // 检查依赖是否都成功
        for (const depId of node.dependencies) {
            const depResult = this.results.get(depId);
            if (!depResult || !depResult.success) {
                node.status = 'SKIPPED';
                this._log('SKIP', taskId, { reason: `Dependency ${depId} failed` });
                throw new Error(`Dependency ${depId} not satisfied`);
            }
        }

        this._log('START', taskId);
        node.status = 'RUNNING';
        node.startTime = Date.now();
        this.emit('task:start', taskId);

        try {
            // 执行任务（带超时）
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error(`Task ${taskId} timeout (${this.taskTimeout}ms)`)), this.taskTimeout)
            );
            
            const taskPromise = Promise.resolve(node.task(this._getDepResults(node.dependencies)));
            const result = await Promise.race([taskPromise, timeoutPromise]);

            node.status = 'SUCCESS';
            node.result = result;
            node.endTime = Date.now();
            this.results.set(taskId, { success: true, value: result });
            this._log('SUCCESS', taskId, { duration: node.endTime - node.startTime });
            this.emit('task:success', taskId, result);

            return result;

        } catch (error) {
            node.status = 'FAILED';
            node.error = error.message;
            node.endTime = Date.now();
            this.results.set(taskId, { success: false, error: error.message });
            this._log('FAIL', taskId, { error: error.message });
            this.emit('task:failed', taskId, error);

            throw error;
        }
    }

    /**
     * 获取依赖任务的结果字典
     */
    _getDepResults(depIds) {
        const context = {};
        for (const depId of depIds) {
            const result = this.results.get(depId);
            context[depId] = result ? result.value : null;
        }
        return context;
    }

    /**
     * 构建执行计划（拓扑排序，生成层级）
     */
    _buildExecutionPlan() {
        const inDegree = new Map();
        const adjacency = new Map();

        // 初始化
        for (const [taskId, node] of this.tasks) {
            inDegree.set(taskId, node.dependencies.length);
            adjacency.set(taskId, []);
        }

        // 构建邻接表（反向：依赖 -> 被依赖者）
        for (const [taskId, node] of this.tasks) {
            for (const depId of node.dependencies) {
                if (adjacency.has(depId)) {
                    adjacency.get(depId).push(taskId);
                }
            }
        }

        // Kahn 算法 + 分层
        const layers = [];
        const visited = new Set();

        while (visited.size < this.tasks.size) {
            // 找出入度为0的节点
            const layer = [];
            for (const [taskId, degree] of inDegree) {
                if (degree === 0 && !visited.has(taskId)) {
                    layer.push(taskId);
                }
            }

            if (layer.length === 0) {
                // 环形依赖，剩余的都是环内节点
                for (const taskId of this.tasks.keys()) {
                    if (!visited.has(taskId)) layer.push(taskId);
                }
                break;
            }

            layers.push(layer);

            // 更新入度
            for (const taskId of layer) {
                visited.add(taskId);
                for (const nextTask of (adjacency.get(taskId) || [])) {
                    inDegree.set(nextTask, inDegree.get(nextTask) - 1);
                }
            }
        }

        return layers;
    }

    _log(event, taskId, data = {}) {
        const entry = { event, taskId, time: new Date().toISOString(), ...data };
        this._eventLog.push(entry);
    }

    /**
     * 获取执行统计
     */
    getStats() {
        const stats = { total: this.tasks.size, pending: 0, running: 0, success: 0, failed: 0, skipped: 0 };
        for (const node of this.tasks.values()) {
            stats[node.status.toLowerCase()] = (stats[node.status.toLowerCase()] || 0) + 1;
        }
        return stats;
    }

    /**
     * 重置管道
     */
    reset() {
        this.tasks.clear();
        this.runningTasks.clear();
        this.results.clear();
        this._executionQueue = [];
        this._eventLog = [];
    }
}

module.exports = ParallelPipeline;