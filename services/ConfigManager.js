/**
 * ConfigManager — reads, writes, validates .env config and tracks restart requirements.
 */

const fs = require('fs');
const path = require('path');
const { SCHEMA, validateApiKey, isValidPort } = require('./ConfigSchema');

class ConfigManager {
    constructor() {
        this.envPath = path.join(__dirname, '..', '.env');
        this._parsed = null;   // { KEY: value }
        this._rawLines = null; // string[] — 保留原格式
    }

    // Internal: parse .env

    _loadEnv() {
        if (this._parsed) return;
        this._parsed = {};
        this._rawLines = [];

        try {
            if (!fs.existsSync(this.envPath)) return;
            const content = fs.readFileSync(this.envPath, 'utf-8');
            this._rawLines = content.split('\n');

            for (const line of this._rawLines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;
                const eqIdx = trimmed.indexOf('=');
                if (eqIdx === -1) continue;
                const key = trimmed.slice(0, eqIdx).trim();
                let value = trimmed.slice(eqIdx + 1).trim();
                // Remove surrounding quotes
                if ((value.startsWith('"') && value.endsWith('"'))
                    || (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.slice(1, -1);
                }
                this._parsed[key] = value;
            }
        } catch { /* .env not available */ }
    }

    // Reading

    get(key) {
        this._loadEnv();
        return this._parsed[key] ?? null;
    }

    getAll() {
        this._loadEnv();
        return { ...this._parsed };
    }

    /**
     * 友好的配置展示（隐去 API Key 全文）
     */
    getDisplayConfig() {
        this._loadEnv();
        const cfg = { ...this._parsed };
        // Mask API keys
        for (const key of Object.keys(cfg)) {
            if (key.endsWith('_API_KEY') || key.endsWith('_AUTH_TOKEN')) {
                const v = cfg[key];
                cfg[key] = v ? v.slice(0, 6) + '****' + v.slice(-4) : '';
            }
        }
        return cfg;
    }

    // Writing .env (atomic write)

    async set(key, value) {
        this._loadEnv();

        const strValue = String(value);
        this._parsed[key] = strValue;
        // 立即同步到 process.env，让 Config.js 下次读取时生效
        process.env[key] = strValue;

        // 重建文件内容
        const lines = [];
        let found = false;
        for (const rawLine of this._rawLines) {
            const trimmed = rawLine.trim();
            if (!trimmed || trimmed.startsWith('#')) {
                lines.push(rawLine);
                continue;
            }
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx === -1) {
                lines.push(rawLine);
                continue;
            }
            const k = trimmed.slice(0, eqIdx).trim();
            if (k === key) {
                lines.push(`${key}=${strValue}`);
                found = true;
            } else {
                lines.push(rawLine);
            }
        }
        if (!found) {
            // Key not in file yet — append
            lines.push(`${key}=${strValue}`);
        }

        // 原子写入
        const tmpPath = this.envPath + '.tmp';
        await fs.promises.writeFile(tmpPath, lines.join('\n'), 'utf-8');
        await fs.promises.rename(tmpPath, this.envPath);
        this._rawLines = lines;

        return { success: true, key, value: strValue };
    }

    /**
     * 批量设置多个 key
     */
    async setMultiple(entries) {
        for (const { key, value } of entries) {
            await this.set(key, value);
        }
        return { success: true, count: entries.length };
    }

    // Validation

    validate(key, value) {
        // API keys
        if (key.endsWith('_API_KEY')) {
            return validateApiKey(value)
                ? { valid: true }
                : { valid: false, error: `API密钥长度不足，至少需要8个字符` };
        }
        // Port
        if (key === 'PORT' || key === 'STATE_COLLECT_INTERVAL') {
            const num = typeof value === 'number' ? value : parseInt(value, 10);
            return isValidPort(num)
                ? { valid: true }
                : { valid: false, error: `端口号需在 1024-65535 之间` };
        }
        // Boolean-ish
        if (key.startsWith('MULTI_MODEL_') || key.endsWith('_ENABLED')) {
            const v = String(value);
            return (v === 'true' || v === 'false')
                ? { valid: true }
                : { valid: false, error: `值需为 true 或 false` };
        }
        // LLM_ADAPTER
        if (key === 'LLM_ADAPTER') {
            const { isValidAdapter } = require('./ConfigSchema');
            return isValidAdapter(String(value))
                ? { valid: true }
                : { valid: false, error: `无效的适配器: ${value}，可选: deepseek, glm, minimax, qwen, mock` };
        }
        // Base URL
        if (key.endsWith('_BASE_URL')) {
            try {
                new URL(String(value));
                return { valid: true };
            } catch {
                return { valid: false, error: `无效的 URL 格式` };
            }
        }
        return { valid: true };
    }

    // Query

    requiresRestart(key) {
        for (const entry of SCHEMA) {
            if (entry.key === key) return !!entry.requiresRestart;
        }
        return false;
    }

    // Reset

    async reset() {
        this._loadEnv();
        // 备份
        const bakPath = this.envPath + '.bak';
        if (fs.existsSync(this.envPath)) {
            await fs.promises.copyFile(this.envPath, bakPath);
        }
        // 清空配置内容（只保留注释头）
        const header = '# JingxuanAgent 环境变量配置\n# 已重置为默认\n';
        await fs.promises.writeFile(this.envPath, header, 'utf-8');
        this._parsed = {};
        this._rawLines = header.split('\n');

        // 从 process.env 中删除自定义 key
        for (const key of Object.keys(this._parsed)) {
            delete process.env[key];
        }

        return { success: true };
    }

    // Schema access

    getSchema() {
        return SCHEMA;
    }
}

module.exports = ConfigManager;
