// DeviceManager - device manager

const SafetyEngine = require('./SafetyEngine');
const DeviceStateCollector = require('./DeviceStateCollector');
const PcDevice = require('./PcDevice');

class DeviceManager {
    constructor(config = {}) {
        this.safety = new SafetyEngine({ safetyLevel: config.safetyLevel || 'medium' });

        // 设备插件注册表: { deviceType -> DeviceAbstraction 实例 }
        this._devices = new Map();
        // 当前活动设备类型
        this._activeDeviceType = config.deviceType || 'pc';
        // 状态收集器 (每个设备独立)
        this._stateCollectors = new Map();
        // 配置
        this._config = config;
    }

    /**
     * Initialize: register built-in devices and start state collection
     */
    async init() {
        // 注册 PC 设备（内置）
        const pcDevice = new PcDevice();
        this.registerDevice('pc', pcDevice);

        // 激活默认设备
        await this.activateDevice(this._activeDeviceType);

        return {
            deviceType: this._activeDeviceType,
            info: this.getDevice()?.getDeviceInfo() || {},
            registeredTypes: Array.from(this._devices.keys())
        };
    }

    /**
     * Register a device plugin
     */
    registerDevice(type, deviceInstance) {
        if (this._devices.has(type)) {
            console.log(`[DeviceManager] Updating device: ${type}`);
        }
        this._devices.set(type, deviceInstance);
        console.log(`[DeviceManager] ✅ Device registered: ${type} (${deviceInstance.deviceName})`);
        return this;
    }

    /**
     * Switch to a specific device
     */
    async activateDevice(type) {
        if (!this._devices.has(type)) {
            throw new Error(`Device type not registered: ${type}`);
        }

        // 停止旧设备的状态收集
        if (this._activeDeviceType && this._stateCollectors.has(this._activeDeviceType)) {
            this._stateCollectors.get(this._activeDeviceType).stop();
        }

        this._activeDeviceType = type;

        // 启动新设备的状态收集
        if (!this._stateCollectors.has(type)) {
            const interval = this._config.stateInterval || 30000;
            const collector = new DeviceStateCollector(interval);
            this._stateCollectors.set(type, collector);
        }
        this._stateCollectors.get(type).start();
        this._devices.get(type).setStatus('active');

        console.log(`[DeviceManager] Switched to device: ${type}`);
        return { deviceType: type, info: this.getDevice().getDeviceInfo() };
    }

    /**
     * 获取当前活动设备
     */
    getDevice() {
        return this._devices.get(this._activeDeviceType) || null;
    }

    /**
     * 获取当前设备最新状态
     */
    getState() {
        const collector = this._stateCollectors.get(this._activeDeviceType);
        return collector ? collector.getState() : {};
    }

    /**
     * 获取设备传感器数据（由设备插件自行采集）
     */
    getSensors() {
        const device = this.getDevice();
        return device ? device.getSensors() : {};
    }

    /**
     * 获取完整设备报告（供 LLM 上下文和 Web 仪表盘使用）
     */
    getFullReport() {
        const device = this.getDevice();
        if (!device) return { error: 'No active device' };

        return {
            info: device.getDeviceInfo(),
            sensors: device.getSensors(),
            state: this.getState(),
            capabilities: device.getCapabilitySummary(),
            safetyLevel: this.safety.safetyLevel,
            permissionLevel: this._permissionLevel || 'none'
        };
    }

    /**
     * 获取当前设备的 LLM 工具定义
     */
    getToolDefinitions() {
        const device = this.getDevice();
        const deviceTools = device ? device.getToolDefinitions() : [];

        // 添加通用工具
        const commonTools = [
            {
                name: 'device_info',
                description: `获取当前承载体 (${this._activeDeviceType}) 的详细信息和状态`,
                parameters: { type: 'object', properties: {} }
            },
            {
                name: 'device_sensors',
                description: `获取当前承载体 (${this._activeDeviceType}) 的实时传感器数据`,
                parameters: { type: 'object', properties: {} }
            },
            {
                name: 'list_capabilities',
                description: '列出当前承载体支持的所有工具能力',
                parameters: { type: 'object', properties: {} }
            }
        ];

        return [...commonTools, ...deviceTools];
    }

    /**
     * 执行工具调用（带安全校验）
     */
    async execute(action, params) {
        const device = this.getDevice();
        if (!device) return { verified: false, error: 'No active device' };

        // 1. SafetyEngine 风险评级
        const risk = this.safety.assessRisk(action, params);

        // 2. 设备级参数校验
        const paramCheck = device.validateParams(action, params);
        if (paramCheck && !paramCheck.ok) {
            return { verified: false, error: `[安全拦截] ${paramCheck.reason}` };
        }

        // 3. 执行
        try {
            return await device.executeTool(action, params);
        } catch (e) {
            return { verified: false, error: e.message };
        }
    }

    /**
     * 设置当期权限级别（由 PermissionSystem 同步）
     */
    setPermissionLevel(level) {
        this._permissionLevel = level;
    }

    /**
     * 获取所有已注册设备类型列表
     */
    listDeviceTypes() {
        return Array.from(this._devices.entries()).map(([type, inst]) => ({
            type,
            name: inst.deviceName,
            active: type === this._activeDeviceType,
            toolCount: inst.getToolDefinitions().length
        }));
    }

    /**
     * 关闭所有设备
     */
    shutdown() {
        for (const [type, collector] of this._stateCollectors) {
            collector.stop();
        }
        for (const [type, device] of this._devices) {
            device.setStatus('shutdown');
        }
        console.log('[DeviceManager] Shutdown complete');
    }
}

module.exports = DeviceManager;
