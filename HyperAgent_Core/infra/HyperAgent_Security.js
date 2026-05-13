/**
 * HyperAgent_Security.js — 安全沙箱
 *
 * 工具权限矩阵、路径白名单/黑名单、命令过滤、速率限制
 */

const path = require('path');

class SecuritySandbox {
  constructor(config = {}) {
    this.config = {
      blockedCommands: config.blockedCommands || [
        'shutdown', 'reboot', 'restart', 'halt', 'poweroff',
        'format', 'diskpart', 'fdisk', 'mkfs', 'dd',
        'rm -rf /', 'rm -rf *', 'del /f /s', 'rd /s /q',
      ],
      blockedPaths: config.blockedPaths || [
        /[/\\]\.ssh[/\\]/,
        /[/\\]Windows[/\\]System32[/\\]config[/\\]/i,
        /[/\\]AppData[/\\]Local[/\\]Google[/\\]Chrome[/\\]User Data/i,
      ],
      blockedExtensions: config.blockedExtensions || ['.exe', '.dll', '.sys', '.ps1'],
      allowedCommands: config.allowedCommands || null, // null = allow all unless blocked
      maxCommandLength: config.maxCommandLength || 10000,
      maxFilePathLength: config.maxFilePathLength || 512,
      requirePermissionFor: config.requirePermissionFor || [
        'file_delete', 'file_overwrite', 'command_exec',
        'process_kill', 'network_access',
      ],
      userHome: config.userHome || process.env.USERPROFILE || process.env.HOME || '/',
    };

    this.auditLog = [];
    this.maxAuditSize = 1000;
  }

  // 命令验证

  validateCommand(command) {
    if (!command || typeof command !== 'string') {
      return { ok: false, reason: 'Command must be a string' };
    }
    if (command.length > this.config.maxCommandLength) {
      return { ok: false, reason: `Command exceeds max length (${command.length} > ${this.config.maxCommandLength})` };
    }

    const lower = command.toLowerCase().trim();

    // 黑名单命令
    for (const blocked of this.config.blockedCommands) {
      if (lower.includes(blocked.toLowerCase())) {
        this._audit('command_blocked', command, `Blocked command: ${blocked}`);
        return { ok: false, reason: `Command contains blocked pattern: ${blocked}` };
      }
    }

    // 白名单模式（如果配置了）
    if (this.config.allowedCommands) {
      const matches = this.config.allowedCommands.some(pat =>
        typeof pat === 'string' ? lower.startsWith(pat.toLowerCase()) : pat.test(lower)
      );
      if (!matches) {
        this._audit('command_not_allowed', command, 'Command not in allowlist');
        return { ok: false, reason: 'Command not in allowlist' };
      }
    }

    // 危险字符检测
    const dangerousPatterns = [
      /[;&|`$]/g,   // shell 注入字符
      /\brm\s+-rf\b/i,
      /\bwget\b.*\|.*sh\b/i,
      /\bcurl\b.*\|.*sh\b/i,
    ];
    for (const pat of dangerousPatterns) {
      if (pat.test(command) && !this._isSafeCommand(command)) {
        this._audit('dangerous_pattern', command, `Dangerous pattern: ${pat}`);
        return { ok: false, reason: 'Command contains potentially dangerous pattern' };
      }
    }

    return { ok: true };
  }

  _isSafeCommand(command) {
    // 允许 git、npm 等使用管道的高级命令
    const safePipes = [
      /git\s+.+\|/, /npm\s+.+\|/, /dir\s+.+\|/, /ls\s+.+\|/,
      /type\s+.+\|/, /cat\s+.+\|/, /findstr\s+/i, /find\s+/i,
    ];
    return safePipes.some(pat => pat.test(command));
  }

  // 文件路径验证

  validatePath(filePath, operation = 'read') {
    if (!filePath || typeof filePath !== 'string') {
      return { ok: false, reason: 'Path must be a string' };
    }
    if (filePath.length > this.config.maxFilePathLength) {
      return { ok: false, reason: `Path exceeds max length` };
    }

    // 规范化路径
    const normalized = path.resolve(filePath);

    // 路径黑名单
    for (const blocked of this.config.blockedPaths) {
      if (blocked.test(normalized)) {
        this._audit('path_blocked', filePath, `Blocked path pattern: ${blocked}`);
        return { ok: false, reason: 'Access to this path is blocked' };
      }
    }

    // 扩展名黑名单（写操作）
    if (operation === 'write' || operation === 'overwrite') {
      const ext = path.extname(normalized).toLowerCase();
      if (this.config.blockedExtensions.includes(ext)) {
        return { ok: false, reason: `Cannot write files with extension: ${ext}` };
      }
    }

    return { ok: true, resolved: normalized };
  }

  // 工具权限

  checkToolPermission(toolName, params = {}) {
    if (toolName === 'Bash' || toolName === 'command_exec') {
      return this.validateCommand(params.command || '');
    }
    if (toolName === 'Write' || toolName === 'Edit' || toolName === 'Read') {
      const op = toolName === 'Read' ? 'read' : toolName === 'Edit' ? 'overwrite' : 'write';
      return this.validatePath(params.file_path || '', op);
    }
    if (toolName === 'Glob' || toolName === 'Grep') {
      return { ok: true };
    }
    if (toolName === 'WebFetch' || toolName === 'WebSearch') {
      return { ok: true };
    }
    return { ok: true };
  }

  // 审计日志

  _audit(action, target, reason) {
    this.auditLog.push({
      t: new Date().toISOString(),
      action,
      target: String(target).substring(0, 200),
      reason,
    });
    if (this.auditLog.length > this.maxAuditSize) this.auditLog.shift();
  }

  getAuditLog(limit = 50) {
    return this.auditLog.slice(-limit);
  }

  getStats() {
    const blocked = this.auditLog.filter(e =>
      e.action.includes('blocked') || e.action.includes('not_allowed')
    ).length;
    return {
      totalAuditEvents: this.auditLog.length,
      blockedActions: blocked,
      blockedCommands: this.config.blockedCommands.length,
      blockedPaths: this.config.blockedPaths.length,
    };
  }
}

module.exports = SecuritySandbox;
