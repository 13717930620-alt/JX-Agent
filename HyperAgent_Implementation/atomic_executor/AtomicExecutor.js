const StateManager = require('../state_manager/StateManager');
const ToolExecutor = require('./ToolExecutor');
const ExecutionReceipt = require('../../HyperAgent_Core/cognitive_core/ExecutionReceipt');

/**
 * AtomicExecutor — executes tool actions with HMAC-signed receipts for verifiability.
 */
class AtomicExecutor {
    constructor(stateManager) {
        this.stateManager = stateManager;
        this.toolExecutor = new ToolExecutor();
        this.executionLog = [];
        this.maxLogSize = 1000;

        // 执行凭证系统 — each tool execution generates a signed receipt for verification
        this.receiptSystem = new ExecutionReceipt({
            maxReceipts: 10000
        });
    }

    async executeAction(actionRequest, options = {}) {
        const { id, tool, params, expected } = actionRequest;
        const timeout = options.timeout || 30000;
        const executionId = `exec_${Date.now()}_${Math.random().toString(36).substring(2, 2+5)}`;

        const logEntry = {
            executionId, actionId: id, tool,
            params: this._sanitizeParams(params),
            status: 'STARTING', startTime: new Date().toISOString(),
            endTime: null, duration: null, result: null, error: null
        };

        const preCheck = this._checkPreconditions(tool, params);
        if (!preCheck.verified) {
            logEntry.status = 'PRECONDITION_FAILED';
            logEntry.error = preCheck.error;
            logEntry.endTime = new Date().toISOString();
            this._addLog(logEntry);
            return { verified: false, error: `Precondition failed: ${preCheck.error}`, executionId };
        }

        try {
            const result = await Promise.race([
                this.toolExecutor.execute({ tool, params }),
                new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout))
            ]);

            logEntry.status = result.verified ? 'SUCCESS' : 'VERIFICATION_FAILED';
            logEntry.result = result.data || result;
            logEntry.error = result.error;
            logEntry.endTime = new Date().toISOString();
            logEntry.duration = new Date(logEntry.endTime) - new Date(logEntry.startTime);
            this._addLog(logEntry);

            // 生成执行凭证
            const receipt = this.receiptSystem.create(
                tool,
                params,
                { data: result.data, verified: result.verified, error: result.error },
                { verify: result.verified }
            );

            const verified = result.verified && (expected === 'Any' || this._checkExpected(result.data, expected));

            // 返回结果附带凭证ID
            return {
                verified,
                data: result.data || result,
                error: result.error || null,
                executionId,
                duration: logEntry.duration,
                receiptId: receipt.id,
                receiptSignature: receipt.signature
            };
        } catch (error) {
            logEntry.status = 'ERROR';
            logEntry.error = error.message;
            logEntry.endTime = new Date().toISOString();
            logEntry.duration = new Date(logEntry.endTime) - new Date(logEntry.startTime);
            this._addLog(logEntry);

            // 错误也生成凭证（便于学习）
            this.receiptSystem.create(tool, params, { error: error.message, verified: false }, { verify: false });

            return { verified: false, error: error.message, executionId, duration: logEntry.duration };
        }
    }

    /**
     * Verify a claim against the receipt system.
     * @param {string} claim - the claim text
     * @param {string} tool - the tool allegedly used
     * @returns {object} { verified, reason, epistemic, confidence }
     */
    verifyClaim(claim, tool) {
        return this.receiptSystem.verify(claim, tool);
    }

    /** 批量验证一组声明 */
    verifyClaims(claims, tools) {
        return this.receiptSystem.verifyBatch(claims, tools);
    }

    getLastReceipt(tool) {
        return this.receiptSystem.getLatestReceipt(tool);
    }

    getAllReceipts() {
        return this.receiptSystem.getAllReceipts();
    }

    getUnverifiedReceipts() {
        return this.receiptSystem.getUnverifiedReceipts();
    }

    getReceiptStats() {
        return this.receiptSystem.getStats();
    }

    _checkPreconditions(action, params) {
        if (action === 'file_write' && params.path) {
            const dir = require('path').dirname(params.path);
            if (!require('fs').existsSync(dir)) return { verified: false, error: `Directory not found: ${dir}` };
        }
        if (action === 'file_read' && params.path && !require('fs').existsSync(params.path)) {
            return { verified: false, error: `File not found: ${params.path}` };
        }
        return { verified: true };
    }

    _checkExpected(data, expected) {
        if (!expected || expected === 'Success' || expected === 'Any') return true;
        if (typeof data === 'object' && JSON.stringify(data).includes(expected)) return true;
        return String(data) === String(expected);
    }

    _sanitizeParams(params) {
        const sanitized = {};
        for (const [key, value] of Object.entries(params || {})) {
            if (/password|secret|key|token/i.test(key)) sanitized[key] = '***REDACTED***';
            else sanitized[key] = value;
        }
        return sanitized;
    }

    _addLog(entry) {
        this.executionLog.push(entry);
        if (this.executionLog.length > this.maxLogSize) this.executionLog.shift();
    }

    getLog(limit = 100) { return this.executionLog.slice(-limit); }

    getStats() {
        const stats = {
            total: this.executionLog.length,
            starting: 0, success: 0, failed: 0, errors: 0,
            receipts: this.receiptSystem.getStats()
        };
        for (const entry of this.executionLog) {
            if (entry.status === 'STARTING') stats.starting++;
            else if (entry.status === 'SUCCESS') stats.success++;
            else if (entry.status === 'VERIFICATION_FAILED') stats.failed++;
            else if (entry.status === 'ERROR') stats.errors++;
        }
        return stats;
    }

    clearLog() { this.executionLog = []; }
    getLastResult() { return this.executionLog[this.executionLog.length - 1] || null; }
}

module.exports = AtomicExecutor;
