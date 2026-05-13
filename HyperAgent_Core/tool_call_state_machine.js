/**
 * ToolCallStateMachine.js — 工具调用状态机
 *
 * LLM 只能发起工具调用请求，不能报告工具结果。
 * 工具结果必须经过状态机的完整生命周期，由真实执行产生。
 *
 * 状态流转：
 *   requested → validating → approved → scheduled → executing → success
 *                                                              → error
 *                                                              → cancelled
 *
 * 关键约束：
 *   1. 只有 executing 状态可以产生 success
 *   2. executing 的唯一入口是 scheduled
 *   3. scheduled 的唯一入口是通过所有验证的 approved
 *   4. LLM 永不直接接触 result 字段
 */
class ToolCallStateMachine {
    constructor(options = {}) {
        this.toolRegistry = options.toolRegistry || null;
        this.permissionSystem = options.permissionSystem || null;
        this.maxRetries = options.maxRetries || 3;

        // 活跃的工具调用
        this._calls = new Map();   // callId -> ToolCall
        this._nextId = 1;

        // 验证重试循环检测
        this._validationRetries = new Map(); // toolName:errorMsg -> count
        this.RETRY_LOOP_THRESHOLD = 3;

        this.stats = {
            totalCalls: 0,
            successCount: 0,
            errorCount: 0,
            cancelledCount: 0,
            blockedCount: 0,
            avgDuration: 0
        };
    }

    /**
     * 发起一个工具调用（由编排器调用，非 LLM 直接调用）
     * @param {string} toolName
     * @param {object} params
     * @param {object} context - { permissionLevel, agentId }
     * @returns {Promise<object>} 最终执行结果
     */
    async invoke(toolName, params, context = {}) {
        const callId = `tc_${Date.now()}_${this._nextId++}`;
        const call = {
            id: callId,
            toolName,
            params: JSON.parse(JSON.stringify(params)),
            status: 'requested',
            context,
            startTime: Date.now(),
            endTime: null,
            result: null,
            error: null,
            retryCount: 0,
            timeline: [{ status: 'requested', time: Date.now() }]
        };
        this._calls.set(callId, call);
        this.stats.totalCalls++;

        // 状态 1→2: requested → validating
        call.status = 'validating';
        call.timeline.push({ status: 'validating', time: Date.now() });

        const validationResult = await this._validate(toolName, params, context);
        if (!validationResult.valid) {
            return this._complete(call, 'error', null, validationResult.error);
        }

        // 状态 2→3: validating → approved
        call.status = 'approved';
        call.timeline.push({ status: 'approved', time: Date.now() });

        // 状态 3→4: approved → scheduled
        call.status = 'scheduled';
        call.timeline.push({ status: 'scheduled', time: Date.now() });

        // 状态 4→5: scheduled → executing
        call.status = 'executing';
        call.timeline.push({ status: 'executing', time: Date.now() });

        try {
            const result = await Promise.race([
                validationResult.tool.call(params),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`工具 ${toolName} 执行超时 (60s)`)), 60000)
                )
            ]);

            // 验证层：文件写入工具必须通过磁盘校验
            const verification = this._verifyResult(toolName, params, result);
            if (verification && !verification.passed) {
                return this._complete(call, 'error', null, verification.reason);
            }

            if (result.verified !== false && !result.error) {
                // 状态 5→6: executing → success
                return this._complete(call, 'success', result, null);
            } else {
                // 可重试的错误
                if (call.retryCount < this.maxRetries && this._isRetryable(result)) {
                    call.retryCount++;
                    call.timeline.push({ status: 'retrying', time: Date.now(), attempt: call.retryCount });
                    await new Promise(r => setTimeout(r, Math.pow(2, call.retryCount) * 500));
                    return this._executeWithRetry(call, validationResult.tool);
                }
                return this._complete(call, 'error', null, result.error || '执行失败');
            }
        } catch (e) {
            return this._complete(call, 'error', null, e.message);
        }
    }

    async invokeBatch(toolCalls, context = {}) {
        const results = [];
        for (const tc of toolCalls) {
            const result = await this.invoke(tc.toolName, tc.params, context);
            results.push({
                toolName: tc.toolName,
                callId: result.callId,
                status: result.status,
                data: result.status === 'success' ? result.data : null,
                error: result.error
            });
        }
        return results;
    }

    async _validate(toolName, params, context) {
        // Layer 1: 工具注册表校验
        if (!this.toolRegistry) {
            return { valid: true, tool: null };
        }

        const validation = this.toolRegistry.validate(
            toolName,
            params,
            context.permissionLevel || 1
        );
        if (!validation.valid) {
            const errorKey = `${toolName}:${validation.error}`;
            const count = (this._validationRetries.get(errorKey) || 0) + 1;
            this._validationRetries.set(errorKey, count);

            if (count >= this.RETRY_LOOP_THRESHOLD) {
                return {
                    valid: false,
                    error: `⚠️ 重试循环检测: 工具 "${toolName}" 连续 ${count} 次校验失败。请停止重试同一方案，换一种方法或向用户解释。`
                };
            }
            this.stats.blockedCount++;
            return validation;
        }

        for (const key of this._validationRetries.keys()) {
            if (key.startsWith(`${toolName}:`)) {
                this._validationRetries.delete(key);
            }
        }

        return validation;
    }

    async _executeWithRetry(call, tool) {
        call.status = 'executing';
        call.timeline.push({ status: 'executing', time: Date.now(), retry: call.retryCount });

        try {
            const result = await tool.call(call.params);
            if (result.verified !== false && !result.error) {
                return this._complete(call, 'success', result, null);
            }
            if (call.retryCount < this.maxRetries && this._isRetryable(result)) {
                call.retryCount++;
                call.timeline.push({ status: 'retrying', time: Date.now(), attempt: call.retryCount });
                await new Promise(r => setTimeout(r, Math.pow(2, call.retryCount) * 500));
                return this._executeWithRetry(call, tool);
            }
            return this._complete(call, 'error', null, result.error || '执行失败');
        } catch (e) {
            return this._complete(call, 'error', null, e.message);
        }
    }

    _isRetryable(result) {
        if (!result) return true;
        const msg = (result.error || '').toLowerCase();
        const nonRetryable = ['permission', 'denied', 'not found', 'invalid', 'syntax'];
        return !nonRetryable.some(n => msg.includes(n));
    }

    /**
     * 完成调用（记录最终状态）
     */
    _complete(call, status, result, error) {
        call.status = status;
        call.endTime = Date.now();
        call.result = result;
        call.error = error;
        call.timeline.push({ status, time: Date.now() });

        const duration = call.endTime - call.startTime;
        this.stats.avgDuration = this.stats.avgDuration * 0.9 + duration * 0.1;

        if (status === 'success') this.stats.successCount++;
        else if (status === 'error') this.stats.errorCount++;
        else if (status === 'cancelled') this.stats.cancelledCount++;

        setTimeout(() => this._calls.delete(call.id), 60000);

        return {
            callId: call.id,
            toolName: call.toolName,
            status,
            data: result?.data || null,
            error: error || null,
            duration,
            timeline: call.timeline,
            // LLM 注入格式的真实结果（不是 LLM 自述的）
            _llmResult: this._formatForLLM(call)
        };
    }

    /**
     * 格式化为 LLM 可消费的结果
     * 这是 LLM 能看到的工具结果的唯一来源
     */
    _formatForLLM(call) {
        if (call.status === 'success') {
            const data = call.result?.data;
            const dataStr = typeof data === 'string' ? data :
                            data ? JSON.stringify(data).substring(0, 5000) :
                            '执行成功';
            return {
                tool_use_id: call.id,
                content: dataStr,
                is_error: false
            };
        }
        return {
            tool_use_id: call.id,
            content: call.error || '未知错误',
            is_error: true
        };
    }

    cancel(callId) {
        const call = this._calls.get(callId);
        if (!call || call.status === 'success' || call.status === 'error') return false;
        return this._complete(call, 'cancelled', null, '用户取消');
    }

    cancelAll() {
        for (const [id, call] of this._calls) {
            if (call.status !== 'success' && call.status !== 'error') {
                this._complete(call, 'cancelled', null, '用户取消');
            }
        }
    }

    getCall(callId) {
        return this._calls.get(callId) || null;
    }

    getActiveCalls() {
        const active = [];
        for (const [, call] of this._calls) {
            if (call.status === 'requested' || call.status === 'validating' ||
                call.status === 'approved' || call.status === 'scheduled' ||
                call.status === 'executing') {
                active.push({
                    id: call.id,
                    toolName: call.toolName,
                    status: call.status,
                    elapsed: Date.now() - call.startTime
                });
            }
        }
        return active;
    }

    getStats() {
        return { ...this.stats, activeCalls: this.getActiveCalls().length };
    }

    clearRetryCounts(toolName) {
        for (const key of this._validationRetries.keys()) {
            if (key.startsWith(`${toolName}:`)) {
                this._validationRetries.delete(key);
            }
        }
    }

    _verifyResult(toolName, params, result) {
        // 文件写入验证
        if ((toolName === 'write_file' || toolName === 'file_write' || toolName === 'Write') && params.file_path) {
            try {
                const fs = require('fs');
                const p = params.file_path;
                if (!fs.existsSync(p)) {
                    return { passed: false, reason: `Write 声称已写入文件，但磁盘上不存在: ${p}` };
                }
                const stat = fs.statSync(p);
                if (stat.size === 0) {
                    return { passed: false, reason: `Write 声称已写入文件，但文件为 0 字节: ${p}` };
                }
                return { passed: true };
            } catch (e) {
                return { passed: false, reason: `文件验证异常: ${e.message}` };
            }
        }
        // Bash 命令输出检查
        if (toolName === 'bash' || toolName === 'Bash' || toolName === 'execute_command') {
            const output = result && (result.data || result.output || '');
            if (typeof output === 'string' && output.includes('[ERROR]')) {
                return { passed: false, reason: `Bash 输出中包含错误` };
            }
        }
        return null;
    }
}

module.exports = ToolCallStateMachine;
