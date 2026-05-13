// ExecutionReceipt — 执行凭证系统

const crypto = require('crypto');

class ExecutionReceipt {
    constructor(options = {}) {
        // HMAC 密钥（每次启动时随机生成，确保旧凭证不可重用）
        this._hmacKey = options.hmacKey || crypto.randomBytes(32).toString('hex');
        this._algorithm = 'sha256';

        // 凭证存储
        this._receipts = [];
        this._maxReceipts = options.maxReceipts || 10000;

        // 统计
        this.stats = {
            totalReceipts: 0,
            verifiedClaims: 0,
            rejectedClaims: 0,
            lastReceipt: null
        };
    }

    /**
     * 创建一条执行凭证
     * @param {string} tool - 工具名称
     * @param {object} params - 调用参数
     * @param {object} result - 执行结果
     * @param {object} [options]
     * @returns {object} 凭证
     */
    create(tool, params, result, options = {}) {
        const timestamp = Date.now();
        const receiptId = `rcpt_${timestamp}_${Math.random().toString(36).substring(2, 8)}`;

        // 构建凭证数据
        const receiptData = {
            id: receiptId,
            tool,
            params: this._sanitize(params),
            result: this._sanitize(result),
            timestamp,
            iso: new Date(timestamp).toISOString(),
            session: options.session || 'default',
            verified: false,
            verifyTimestamp: null
        };

        // 生成 HMAC 签名（确保不可伪造）
        receiptData.signature = this._sign(receiptData);

        // 可选：立即验证执行结果
        if (options.verify !== false) {
            receiptData.verified = true;
            receiptData.verifyTimestamp = Date.now();
        }

        this._receipts.push(receiptData);
        if (this._receipts.length > this._maxReceipts) {
            this._receipts.shift();
        }

        this.stats.totalReceipts++;
        this.stats.lastReceipt = receiptData;

        return receiptData;
    }

    /**
     * 尝试验证一个声明是否匹配执行凭证
     * @param {string} claim - 声明内容（如"已删除5个文件"）
     * @param {string} tool - 声称使用的工具
     * @param {object} [options]
     * @returns {object} 验证结果
     */
    verify(claim, tool, options = {}) {
        // 查找匹配的凭证
        const candidates = this._receipts.filter(r => r.tool === tool);

        if (candidates.length === 0) {
            this.stats.rejectedClaims++;
            return {
                verified: false,
                reason: 'no_receipt',      // 没有对应工具的执行凭证
                epistemic: 'ungrounded',    // 知识论分类：无依据
                confidence: 0,
                matchedReceipt: null
            };
        }

        // 找最新匹配的凭证
        const latest = candidates[candidates.length - 1];

        // 验证签名是否有效
        const sigValid = this._verifySignature(latest);
        if (!sigValid) {
            this.stats.rejectedClaims++;
            return {
                verified: false,
                reason: 'invalid_signature',
                epistemic: 'ungrounded',
                confidence: 0,
                matchedReceipt: null
            };
        }

        // 声明通过验证
        this.stats.verifiedClaims++;
        const epistemicType = latest.verified ? 'executed' : 'unverified_execution';

        return {
            verified: true,
            reason: 'receipt_matched',
            epistemic: epistemicType,
            confidence: latest.verified ? 1.0 : 0.5,
            matchedReceipt: {
                id: latest.id,
                tool: latest.tool,
                timestamp: latest.iso,
                result: latest.result,
                signature: latest.signature
            }
        };
    }

    /**
     * 批量验证一组声明
     * @param {string[]} claims - 声明数组
     * @param {string[]} tools - 对应的工具名数组
     * @returns {object[]}
     */
    verifyBatch(claims, tools) {
        return claims.map((claim, i) => this.verify(claim, tools[i] || 'unknown'));
    }

    getLatestReceipt(tool) {
        for (let i = this._receipts.length - 1; i >= 0; i--) {
            if (this._receipts[i].tool === tool) return this._receipts[i];
        }
        return null;
    }

    getAllReceipts() {
        return [...this._receipts];
    }

    getReceiptsSince(timestamp) {
        return this._receipts.filter(r => r.timestamp >= timestamp);
    }

    getReceiptsBySession(session) {
        return this._receipts.filter(r => r.session === session);
    }

    /**
     * 根据工具名称和参数模式查找凭证
     */
    findReceipt(tool, paramPattern = {}) {
        return this._receipts.filter(r => {
            if (r.tool !== tool) return false;
            for (const [key, value] of Object.entries(paramPattern)) {
                if (r.params[key] !== value) return false;
            }
            return true;
        });
    }

    getUnverifiedReceipts() {
        return this._receipts.filter(r => !r.verified);
    }

    /**
     * 验证一个凭证的 HMAC 签名
     */
    _verifySignature(receipt) {
        try {
            const { signature, ...data } = receipt;
            const expected = this._sign(data);
            return signature === expected;
        } catch (e) {
            return false;
        }
    }

    /**
     * 对凭证数据生成 HMAC 签名
     */
    _sign(data) {
        const canonical = this._canonicalize(data);
        return crypto
            .createHmac(this._algorithm, this._hmacKey)
            .update(canonical)
            .digest('hex');
    }

    /**
     * 将凭证数据序列化为规范形式（用于签名）
     */
    _canonicalize(data) {
        const { id, tool, params, result, timestamp, session } = data;
        // 只对关键字段签名，确保签名的确定性和不可伪造性
        return `${id}|${tool}|${JSON.stringify(params)}|${JSON.stringify(result)}|${timestamp}|${session}`;
    }

    /**
     * 清理参数（移除循环引用、函数等）
     */
    _sanitize(data) {
        if (typeof data === 'string') return data;
        if (typeof data === 'number' || typeof data === 'boolean') return data;
        if (data === null || data === undefined) return null;
        if (Array.isArray(data)) return data.map(d => this._sanitize(d));
        if (typeof data === 'object') {
            const sanitized = {};
            for (const [key, value] of Object.entries(data)) {
                if (typeof value === 'function' || typeof value === 'symbol') continue;
                sanitized[key] = this._sanitize(value);
            }
            return sanitized;
        }
        return String(data);
    }

    reset() {
        this._receipts = [];
        this.stats = { totalReceipts: 0, verifiedClaims: 0, rejectedClaims: 0, lastReceipt: null };
    }

    getStats() {
        return { ...this.stats, activeReceipts: this._receipts.length };
    }
}

module.exports = ExecutionReceipt;
