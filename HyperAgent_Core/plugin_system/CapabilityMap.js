/**
 * CapabilityMap - 物理能力地图
 */
class CapabilityMap {
    constructor(pluginRegistry) {
        this.registry = pluginRegistry;
        this.map = new Map();
    }

    refresh() {
        this.map.clear();
        for (const [pluginId, instance] of this.registry.plugins) {
            const manifest = instance.getManifest();
            manifest.capabilities.forEach(cap => {
                this.map.set(cap, {
                    pluginId,
                    pluginName: manifest.name,
                    description: `Capable of ${cap}`
                });
            });
        }
    }

    getCapability(actionId) {
        return this.map.get(actionId) || null;
    }

    getAllCapabilities() {
        return Array.from(this.map.keys());
    }
}

module.exports = CapabilityMap;
