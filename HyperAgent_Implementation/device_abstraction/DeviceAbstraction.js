// DeviceAbstraction - abstract base class for devices

class DeviceAbstraction {
    constructor(deviceType, deviceName) {
        this.deviceType = deviceType || 'generic';
        this.deviceName = deviceName || 'Unnamed Device';
        this._safetyLimits = {};
        this._status = 'initialized';
    }

    /** ===== Subclasses must implement ===== */

    getDeviceInfo() {
        throw new Error(`${this.deviceType}: getDeviceInfo() must be implemented`);
    }

    getSensors() {
        throw new Error(`${this.deviceType}: getSensors() must be implemented`);
    }

    /**
     * Get tool definitions (LLM function calling format)
     */
    getToolDefinitions() {
        throw new Error(`${this.deviceType}: getToolDefinitions() must be implemented`);
    }

    /**
     * Execute a tool call
     */
    async executeTool(toolName, params) {
        throw new Error(`${this.deviceType}: executeTool() must be implemented`);
    }

    /** ===== Optional overrides ===== */

    /**
     * Device-level parameter validation
     */
    validateParams(action, params) {
        const limits = this._safetyLimits[action];
        if (!limits) return null;
        for (const [key, value] of Object.entries(params || {})) {
            if (limits[key] !== undefined && typeof value === 'number') {
                if (limits[key].min !== undefined && value < limits[key].min)
                    return { ok: false, reason: `${action}.${key}=${value} 低于下限 ${limits[key].min}` };
                if (limits[key].max !== undefined && value > limits[key].max)
                    return { ok: false, reason: `${action}.${key}=${value} 超过上限 ${limits[key].max}` };
            }
            if (limits[key]?.denyValues?.includes(value))
                return { ok: false, reason: `${action}.${key}=${value} 在禁止列表中` };
        }
        return null;
    }

    /** ===== Public methods ===== */

    setSafetyLimits(limits) {
        this._safetyLimits = { ...this._safetyLimits, ...limits };
    }

    getStatus() { return this._status; }
    setStatus(s) { this._status = s; }

    /**
     * Get device capability summary
     */
    getCapabilitySummary() {
        const tools = this.getToolDefinitions();
        return {
            deviceType: this.deviceType,
            deviceName: this.deviceName,
            toolCount: tools.length,
            tools: tools.map(t => ({
                name: t.name,
                description: t.description,
                parameters: Object.keys(t.parameters?.properties || {})
            }))
        };
    }
}

module.exports = DeviceAbstraction;
