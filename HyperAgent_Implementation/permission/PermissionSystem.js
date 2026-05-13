// PermissionSystem — tiered permission system

const LEVEL_NAMES = { 0: 'none', 1: 'info', 2: 'control', 3: 'admin', 4: 'dangerous' };
const LEVEL_FROM_NAME = { none: 0, info: 1, control: 2, admin: 3, dangerous: 4 };

class PermissionSystem {
    constructor() {
        // 当前授权状态: { scope: { level, grantedAt, expiresAt, grantType, sourceMessage } }
        this._grants = new Map();
        // 挂起的授权请求
        this._pendingRequests = [];
        // 默认级别 (设备类型 -> 级别)
        this._defaultLevels = { pc: 1 };
        // 已拒绝的操作记录 (用于避免重复询问)
        this._rejectedOps = new Map();
        // 授权检测关键词
        this._authPatterns = this._buildAuthPatterns();
    }

    _buildAuthPatterns() {
        return {
            // 全权授权
            fullAccess: [
                /你可以(操控|控制|操作)(我(的)?)?(电脑|桌面|设备|系统)?/i,
                /允许你(操控|控制|操作)(电脑|我|设备)/i,
                /授权你(操控|控制|操作)(电脑|我|设备)/i,
                /grant you (full )?(control|access|permission)/i,
                /you (can |may )?(control|operate|access) (my )?(computer|pc|desktop|device)/i,
                /enable.*(computer control|full access|device control)/i,
            ],
            // 特定级别授权
            levelGrant: [
                /允许你(查看|读取|查询)/i,                    // info
                /允许你(操作|控制|执行|运行)/i,               // control
                /允许你(管理|配置|修改系统)/i,                // admin
                /you can (read|view|check)/i,                 // info
                /you can (operate|control|run|execute)/i,     // control
                /you can (admin|configure|modify system)/i,   // admin
            ],
            // 单次操作授权
            singleOp: [
                /这次允许|临时允许|just this once|for this time/i,
                /允许.*(就够|就行|即可|就可以)/i,
            ],
            // 拒绝/撤销授权
            revoke: [
                /取消授权|撤销权限|禁止.*操控|不再允许|收回权限/i,
                /revoke|deny|disable.*control/i,
            ]
        };
    }

    /** 检测用户消息中的授权意图 */
    detectIntent(message, deviceType = 'pc') {
        // 撤销
        if (this._authPatterns.revoke.some(p => p.test(message))) {
            return { detected: true, action: 'revoke', level: 0, grantType: 'none', scope: `${deviceType}:none` };
        }

        // 全权授权
        if (this._authPatterns.fullAccess.some(p => p.test(message))) {
            const grantType = this._authPatterns.singleOp.some(p => p.test(message)) ? 'single' : 'session';
            return { detected: true, action: 'grant', level: 4, grantType, scope: `${deviceType}:admin` };
        }

        // 特定级别
        for (let i = 0; i < this._authPatterns.levelGrant.length; i++) {
            if (this._authPatterns.levelGrant[i].test(message)) {
                const level = (i % 3) + 1; // 0,3->1(info); 1,4->2(control); 2,5->3(admin)
                const grantType = this._authPatterns.singleOp.some(p => p.test(message)) ? 'single' : 'session';
                return {
                    detected: true, action: 'grant', level, grantType,
                    scope: `${deviceType}:${LEVEL_NAMES[level]}`
                };
            }
        }

        return { detected: false, action: null, level: 0, grantType: null, scope: null };
    }

    /** 授予权限 */
    grant(scope, level, grantType = 'session', options = {}) {
        const [deviceType] = scope.split(':');
        if (!deviceType) return { success: false, error: '无效的作用域' };

        // admin级及以上必须有明确的消息来源
        if (level >= 3 && !options.sourceMessage && grantType !== 'permanent') {
            return { success: false, error: '高风险授权需要用户明确确认' };
        }

        // temporary 必须有 TTL
        let expiresAt = null;
        if (grantType === 'temporary') {
            const ttl = options.ttl || 300; // 默认5分钟
            expiresAt = Date.now() + ttl * 1000;
        }
        if (grantType === 'single') {
            // single-use: 使用一次后自动降级为 info
            expiresAt = 'single';
        }

        // 设置或升级授权
        const existing = this._grants.get(scope);
        if (existing && existing.level >= level && grantType !== 'permanent') {
            return { success: true, alreadyGranted: true, scope, level: existing.level };
        }

        this._grants.set(scope, {
            level,
            deviceType,
            grantType,
            grantedAt: Date.now(),
            expiresAt,
            sourceMessage: options.sourceMessage || null
        });

        // 自动设置低级别权限 (info 自动包含)
        if (level >= 2 && !this._grants.has(`${deviceType}:info`)) {
            this._grants.set(`${deviceType}:info`, {
                level: 1, deviceType, grantType: 'permanent',
                grantedAt: Date.now(), expiresAt: null, sourceMessage: null
            });
        }

        // 更新默认级别
        if (level > (this._defaultLevels[deviceType] || 0)) {
            this._defaultLevels[deviceType] = level;
        }

        console.log(`[Permission] ✅ ${scope} = level ${level} (${grantType})`);
        return { success: true, scope, level, grantType };
    }

    /**
     * 检查是否有指定级别的权限
     * @param {string} scope - 作用域 (例如 "pc:control")
     * @param {number} requiredLevel - 需要的级别
     * @returns {{ allowed: boolean, level: number, reason?: string }}
     */
    check(scope, requiredLevel) {
        const [deviceType] = scope.split(':');

        // 查找匹配的授权（精确匹配或通配）
        let effectiveLevel = this._defaultLevels[deviceType] || 0;

        for (const [grantedScope, grant] of this._grants) {
            const [grantDevice] = grantedScope.split(':');
            if (grantDevice === deviceType) {
                // 检查是否过期
                if (grant.expiresAt === 'single') {
                    // single-use: 检查是否已消耗
                    if (grant._consumed) continue;
                } else if (typeof grant.expiresAt === 'number' && grant.expiresAt < Date.now()) {
                    this._grants.delete(grantedScope);
                    continue;
                }
                if (grant.level > effectiveLevel) {
                    effectiveLevel = grant.level;
                }
            }
        }

        if (effectiveLevel >= requiredLevel) {
            return { allowed: true, level: effectiveLevel };
        }

        return {
            allowed: false,
            level: effectiveLevel,
            reason: `需要 ${LEVEL_NAMES[requiredLevel]||requiredLevel} 级权限，当前 ${LEVEL_NAMES[effectiveLevel]||effectiveLevel} 级`
        };
    }

    /**
     * 消耗一次 single-use 权限
     */
    consumeSingleUse(scope) {
        const [deviceType] = scope.split(':');
        for (const [grantedScope, grant] of this._grants) {
            const [grantDevice] = grantedScope.split(':');
            if (grantDevice === deviceType && grant.expiresAt === 'single' && !grant._consumed) {
                grant._consumed = true;
                return true;
            }
        }
        return false;
    }

    /**
     * 检查某个工具操作是否需要用户确认
     * @param {string} toolName - 工具名
     * @param {number} riskLevel - 安全引擎评级
     * @param {string} deviceType - 设备类型
     * @returns {{ needsConfirm: boolean, message: string }}
     */
    needsUserConfirmation(toolName, riskLevel, deviceType = 'pc') {
        const scope = `${deviceType}:${LEVEL_NAMES[riskLevel] || 'control'}`;
        const check = this.check(scope, riskLevel);

        if (check.allowed) return { needsConfirm: false, message: '' };

        // 检查是否近期拒绝过同类操作
        const recentReject = this._rejectedOps.get(toolName);
        if (recentReject && (Date.now() - recentReject) < 60000) {
            return { needsConfirm: false, message: '已拒绝，跳过' };
        }

        const levelName = LEVEL_NAMES[riskLevel] || 'control';
        const messages = {
            2: `需要控制权限。请授权，例如"你可以操作我的电脑了"`,
            3: `需要管理员权限。请确认授权，例如"允许你管理系统配置"`,
            4: `⚠️ 危险操作！请明确确认授权后才能执行。`,
        };

        return {
            needsConfirm: true,
            message: messages[riskLevel] || `需要 ${levelName} 权限`
        };
    }

    /**
     * 记录用户拒绝的操作（避免重复询问）
     */
    recordRejection(toolName) {
        this._rejectedOps.set(toolName, Date.now());
    }

    /**
     * 撤销指定作用域的权限
     */
    revoke(scope) {
        const removed = this._grants.delete(scope);
        if (removed) {
            // 重新计算默认级别
            const [deviceType] = scope.split(':');
            let maxLevel = 0;
            for (const [s, g] of this._grants) {
                const [d] = s.split(':');
                if (d === deviceType && g.level > maxLevel) maxLevel = g.level;
            }
            this._defaultLevels[deviceType] = maxLevel;
            console.log(`[Permission] 🔒 Revoked: ${scope}`);
        }
        return { success: removed };
    }

    /**
     * 撤销设备的所有权限
     */
    revokeAll(deviceType) {
        for (const scope of this._grants.keys()) {
            const [d] = scope.split(':');
            if (d === deviceType) this._grants.delete(scope);
        }
        this._defaultLevels[deviceType] = 0;
        console.log(`[Permission] 🔒 All permissions revoked for ${deviceType}`);
        return { success: true };
    }

    /**
     * 获取当前权限状态
     */
    getStatus() {
        const grants = [];
        for (const [scope, grant] of this._grants) {
            let status = 'active';
            if (grant.expiresAt === 'single' && grant._consumed) status = 'consumed';
            else if (typeof grant.expiresAt === 'number' && grant.expiresAt < Date.now()) status = 'expired';

            grants.push({
                scope,
                level: grant.level,
                levelName: LEVEL_NAMES[grant.level],
                grantType: grant.grantType,
                grantedAt: new Date(grant.grantedAt).toISOString(),
                expiresAt: grant.expiressAt instanceof Date ? grant.expiresAt.toISOString() : grant.expiresAt,
                status
            });
        }

        return {
            defaults: { ...this._defaultLevels },
            grants
        };
    }

    /**
     * 获取当前设备的有效级别
     */
    getEffectiveLevel(deviceType = 'pc') {
        return this._defaultLevels[deviceType] || 0;
    }

    getLevelName(deviceType = 'pc') {
        return LEVEL_NAMES[this._defaultLevels[deviceType] || 0];
    }
}

module.exports = { PermissionSystem, LEVEL_NAMES, LEVEL_FROM_NAME };
