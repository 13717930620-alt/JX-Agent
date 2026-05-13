/**
 * PluginRegistry - 行业插件注册与动态路由中心
 */
const fs = require('fs');
const path = require('path');
const SlotInterface = require('./SlotInterface');

class PluginRegistry {
    constructor(options = {}) {
        this.plugins = new Map();           // pluginId -> instance
        this.capabilityMap = new Map();     // capabilityId -> pluginId
        this.dependencyGraph = new Map();   // pluginId -> [dependencyIds]
        this.pluginDir = options.pluginDir || path.join(process.cwd(), 'plugins');
        this.pluginStates = new Map();      // pluginId -> { status, loadTime, errorCount, lastCheck }
        this.lifecycleHooks = new Map();     // pluginId -> { onInit, onTerminate, onHealthCheck }
        
        // 健康检查配置
        this.healthCheckInterval = options.healthCheckInterval || 60000; // 1分钟
        this.maxErrorCount = options.maxErrorCount || 5;
        
        // 确保目录存在
        if (!fs.existsSync(this.pluginDir)) {
            fs.mkdirSync(this.pluginDir, { recursive: true });
        }
        
        // 启动健康检查循环
        this._startHealthChecker();
    }

    /**
     * [加载] 加载单个插件
     * @param {string} pluginPath 插件文件路径
     */
    async loadPlugin(pluginPath) {
        try {
            // 跳过抽象接口
            if (pluginPath.endsWith('SlotInterface.js')) {
                return null;
            }
            
            const PluginClass = require(pluginPath);
            const instance = new PluginClass();
            
            // 验证接口实现
            if (!(instance instanceof SlotInterface)) {
                throw new Error(`Plugin does not implement SlotInterface`);
            }
            
            const manifest = instance.getManifest();
            const pluginId = manifest.id;
            
            // 检查依赖
            if (manifest.dependencies && manifest.dependencies.length > 0) {
                for (const depId of manifest.dependencies) {
                    if (!this.plugins.has(depId)) {
                        throw new Error(`Missing dependency: ${depId}`);
                    }
                }
            }
            
            // 初始化插件
            if (instance.onInitialize) {
                await instance.onInitialize();
            }
            
            // 注册插件
            this.plugins.set(pluginId, instance);
            this._setPluginState(pluginId, 'LOADED');
            
            // 注册能力映射
            manifest.capabilities.forEach(capId => {
                this.capabilityMap.set(capId, pluginId);
            });
            
            // 记录依赖关系
            if (manifest.dependencies) {
                this.dependencyGraph.set(pluginId, manifest.dependencies);
            }
            
            console.log(`[PluginRegistry] ✅ Loaded: ${manifest.name} [${pluginId}]`);
            return pluginId;
            
        } catch (error) {
            console.error(`[PluginRegistry] ❌ Load failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * [卸载] 卸载插件
     * @param {string} pluginId 插件ID
     */
    async unloadPlugin(pluginId) {
        const instance = this.plugins.get(pluginId);
        if (!instance) return false;
        
        // 检查是否有其他插件依赖此插件
        for (const [pId, deps] of this.dependencyGraph) {
            if (pId !== pluginId && deps.includes(pluginId)) {
                throw new Error(`Cannot unload ${pluginId}: required by ${pId}`);
            }
        }
        
        // 调用终止钩子
        if (instance.onTerminate) {
            await instance.onTerminate();
        }
        
        // 移除能力映射
        for (const [capId, pId] of this.capabilityMap.entries()) {
            if (pId === pluginId) this.capabilityMap.delete(capId);
        }
        
        // 移除依赖关系
        this.dependencyGraph.delete(pluginId);
        
        // 移除插件
        this.plugins.delete(pluginId);
        this.pluginStates.delete(pluginId);
        
        console.log(`[PluginRegistry] ✅ Unloaded: ${pluginId}`);
        return true;
    }

    /**
     * [路由] 智能路由分发
     * @param {string} actionId 操作ID
     * @param {Object} params 参数
     * @param {Object} context 上下文
     */
    async routeAction(actionId, params, context) {
        const pluginId = this.capabilityMap.get(actionId);
        
        if (!pluginId) {
            throw new Error(`No plugin registered for action: ${actionId}`);
        }
        
        const instance = this.plugins.get(pluginId);
        if (!instance) {
            throw new Error(`Plugin ${pluginId} not loaded`);
        }
        
        // 检查插件健康状态
        const state = this.pluginStates.get(pluginId);
        if (state && state.status === 'UNHEALTHY') {
            throw new Error(`Plugin ${pluginId} is unhealthy`);
        }
        
        try {
            const result = await instance.executeAction(actionId, params, context);
            this._incrementSuccess(pluginId);
            return result;
        } catch (error) {
            this._incrementError(pluginId);
            throw error;
        }
    }

    /**
     * [自动发现] 自动发现并加载插件
     */
    async autoDiscover() {
        const pluginDir = this.pluginDir;
        if (!fs.existsSync(pluginDir)) {
            console.log('[PluginRegistry] Plugin dir not found:', pluginDir);
            return { loaded: 0, failed: 0 };
        }

        const files = fs.readdirSync(pluginDir).filter(f => f.endsWith('.js'));
        let loaded = 0, failed = 0;
        
        // 按依赖顺序加载（简单拓扑排序）
        const loadQueue = [...files];
        const loadedSet = new Set();
        
        while (loadQueue.length > 0) {
            const file = loadQueue.shift();
            const filePath = path.join(pluginDir, file);
            
            try {
                const pluginId = await this.loadPlugin(filePath);
                if (pluginId) {
                    loaded++;
                    loadedSet.add(pluginId);
                }
            } catch (e) {
                console.log(`[PluginRegistry] Skip ${file}: ${e.message}`);
                failed++;
            }
        }
        
        console.log(`[PluginRegistry] Auto-discovered ${loaded} plugins (${failed} failed)`);
        return { loaded, failed };
    }

    /**
     * 手动触发健康检查
     * @param {string} pluginId 插件ID（可选）
     */
    async healthCheck(pluginId = null) {
        const targetIds = pluginId ? [pluginId] : Array.from(this.plugins.keys());
        const results = {};
        
        for (const pId of targetIds) {
            const instance = this.plugins.get(pId);
            const state = this.pluginStates.get(pId) || {};
            
            try {
                // 执行健康检查钩子
                if (instance.onHealthCheck) {
                    const healthy = await instance.onHealthCheck();
                    if (healthy) {
                        this._setPluginState(pId, 'HEALTHY');
                        results[pId] = { status: 'HEALTHY' };
                    } else {
                        this._setPluginState(pId, 'UNHEALTHY');
                        results[pId] = { status: 'UNHEALTHY' };
                    }
                } else {
                    results[pId] = { status: 'UNKNOWN', note: 'No health check defined' };
                }
            } catch (error) {
                this._incrementError(pId);
                this._setPluginState(pId, 'UNHEALTHY');
                results[pId] = { status: 'UNHEALTHY', error: error.message };
            }
        }
        
        return results;
    }

    /**
     * 获取插件状态
     * @param {string} pluginId 插件ID
     */
    getPluginState(pluginId) {
        return this.pluginStates.get(pluginId) || null;
    }

    /**
     * 获取所有插件
     */
    listPlugins() {
        const list = [];
        for (const [pluginId, instance] of this.plugins) {
            const manifest = instance.getManifest ? instance.getManifest() : { name: pluginId };
            const state = this.pluginStates.get(pluginId) || {};
            list.push({
                id: pluginId,
                name: manifest.name || pluginId,
                capabilities: manifest.capabilities || [],
                status: state.status || 'UNKNOWN',
                loadTime: state.loadTime,
                errorCount: state.errorCount || 0
            });
        }
        return list;
    }

    /**
     * 获取所有已注册的能力映射
     * @returns {Map} capabilityId -> pluginId 的映射
     */
    getCapabilities() {
        return this.capabilityMap;
    }

    findPluginByCapability(capabilityId) {
        const pluginId = this.capabilityMap.get(capabilityId);
        return pluginId ? this.plugins.get(pluginId) : null;
    }

    // 私有方法

    _setPluginState(pluginId, status) {
        const current = this.pluginStates.get(pluginId) || {};
        this.pluginStates.set(pluginId, {
            ...current,
            status,
            lastCheck: new Date().toISOString()
        });
    }

    _incrementSuccess(pluginId) {
        const current = this.pluginStates.get(pluginId) || { errorCount: 0 };
        this.pluginStates.set(pluginId, {
            ...current,
            status: 'HEALTHY',
            lastCheck: new Date().toISOString(),
            errorCount: Math.max(0, current.errorCount - 1) // 成功减少错误计数
        });
    }

    _incrementError(pluginId) {
        const current = this.pluginStates.get(pluginId) || { errorCount: 0 };
        const newCount = current.errorCount + 1;
        this.pluginStates.set(pluginId, {
            ...current,
            status: newCount >= this.maxErrorCount ? 'UNHEALTHY' : 'DEGRADED',
            lastCheck: new Date().toISOString(),
            errorCount: newCount
        });
        
        if (newCount >= this.maxErrorCount) {
            console.warn(`[PluginRegistry] Plugin ${pluginId} marked as UNHEALTHY (${newCount} errors)`);
        }
    }

    _startHealthChecker() {
        this._healthInterval = setInterval(async () => {
            for (const [pluginId, instance] of this.plugins) {
                if (instance.onHealthCheck) {
                    try {
                        const healthy = await instance.onHealthCheck();
                        if (healthy) {
                            this._setPluginState(pluginId, 'HEALTHY');
                        } else {
                            this._incrementError(pluginId);
                        }
                    } catch (e) {
                        this._incrementError(pluginId);
                    }
                }
            }
        }, this.healthCheckInterval);
    }

    destroy() {
        if (this._healthInterval) {
            clearInterval(this._healthInterval);
            this._healthInterval = null;
        }
    }
}

module.exports = PluginRegistry;