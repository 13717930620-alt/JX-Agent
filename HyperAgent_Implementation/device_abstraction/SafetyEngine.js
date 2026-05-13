// SafetyEngine - safety boundary engine

const DANGER_PATTERNS = [
    /shutdown/i, /format/i, /diskpart/i, /del \/f/i, /rd \/s/i, /rmdir \/s/i,
    /reg delete/i, /net user/i, /net localgroup/i, /taskkill \/f/i,
    /cipher \/w/i, /bootrec/i, /bcdedit/i, /clean/i,
];

/**
 * 工具风险级别映射表 (tool -> level)
 */
const TOOL_RISK_MAP = {
    // Level 1: 信息查询
    sys_info: 1, sys_sensors: 1, sys_time: 1,
    device_info: 1, device_sensors: 1, list_capabilities: 1,
    file_read: 1, dir_list: 1, text_search: 1,
    http_get: 1, network_info: 1, process_list: 1,
    vehicle_status: 1, vehicle_info: 1, vehicle_read_dtc: 1,

    // Level 2: 常规控制
    file_write: 2, file_delete: 2, file_copy: 2, file_move: 2,
    dir_create: 2, text_replace: 2,
    exec_cmd: 2, exec_powershell: 2,
    eval_js: 2, calc_basic: 2,
    http_post: 2,
    service_control: 2,
    system_open_file: 2, system_open_url: 2,
    system_notification: 2,
    system_clipboard_set: 2, system_clipboard_get: 2,
    desktop_screenshot: 2,
    vehicle_clear_dtc: 2, vehicle_alert: 2, vehicle_set_speed: 2,

    // Level 3: 管理员级别
    registry_write: 3, registry_read: 3,
    process_kill: 3, system_power: 3,

    // Level 4: 危险操作 (需每次确认)
    system_power_shutdown: 4, system_power_restart: 4,
};

class SafetyEngine {
    constructor(config = {}) {
        this.safetyLevel = config.safetyLevel || 'medium';
        this.permissionSystem = null; // 由外部注入
        this._pendingApprovals = new Map();
    }

    setPermissionSystem(ps) { this.permissionSystem = ps; }

    /**
     * Assess risk of an operation
     */
    assessRisk(action, params) {
        // 危险命令检测（针对命令执行类工具）
        if (action === 'exec_cmd' || action === 'exec_powershell') {
            const cmdStr = (params.cmd || params.script || '').toLowerCase();
            for (const pattern of DANGER_PATTERNS) {
                if (pattern.test(cmdStr)) {
                    return { level: -1, allowed: false, needsConfirm: false, reason: `命令包含危险操作：${cmdStr.substring(0, 100)}` };
                }
            }
        }

        // 检查系统电源管理
        if (action === 'system_power') {
            const powerAction = (params.action || '').toLowerCase();
            if (['shutdown', 'restart'].includes(powerAction)) {
                return {
                    level: 4, allowed: false, needsConfirm: true,
                    confirmMessage: `⚠️ 即将${powerAction === 'shutdown' ? '关机' : '重启'}电脑，请确认。输入"确认执行"以继续。`
                };
            }
            return { level: 2, allowed: true, needsConfirm: false };
        }

        // 查表获取风险级别
        const level = TOOL_RISK_MAP[action] || 2;

        // 不需要特殊确认的 Level 2 操作
        if (level <= 2) {
            return { level, allowed: true, needsConfirm: false };
        }

        // Level 3 需要 admin 权限
        if (level === 3) {
            return {
                level: 3, allowed: false, needsConfirm: true,
                confirmMessage: `需要管理员权限才能执行 ${action}。请授权，例如"允许你管理配置"`
            };
        }

        // Level 4 需要明确确认
        if (level === 4) {
            return {
                level: 4, allowed: false, needsConfirm: true,
                confirmMessage: `⚠️ 高危操作：${action}。请明确确认：输入"确认执行"`
            };
        }

        return { level, allowed: level <= 2, needsConfirm: false };
    }

    /**
     * Request user approval
     */
    async requestApproval(operationId, risk, action) {
        const msg = risk.confirmMessage || `需要确认：${action.action} ${JSON.stringify(action.params)}`;
        this._pendingApprovals.set(operationId, { status: 'pending', msg, risk });
        return false;
    }

    /**
     * Resolve approval (accept/reject)
     */
    resolveApproval(operationId, approved) {
        const entry = this._pendingApprovals.get(operationId);
        if (!entry) return false;
        entry.status = approved ? 'approved' : 'rejected';
        return true;
    }
}

module.exports = SafetyEngine;
