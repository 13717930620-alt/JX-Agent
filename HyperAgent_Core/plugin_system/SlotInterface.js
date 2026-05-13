/**
 * SlotInterface - 行业卡槽标准接口协议
 */
class SlotInterface {
    constructor() {
        if (this.constructor === SlotInterface) {
            throw new Error("SlotInterface is an abstract class and cannot be instantiated.");
        }
    }

    /**
     * 插件元数据声明
     * @returns {Object} 包含插件名称、版本、支持的行业领域、能力清单
     */
    getManifest() {
        throw new Error("Method 'getManifest()' must be implemented.");
    }

    /**
     * 执行原子能力
     * @param {string} actionId - 插件内部定义的具体动作 ID
     * @param {Object} params - 执行所需的参数
     * @param {Object} context - 来自通用底盘的全局上下文 (StateManager/MemoryManager)
     * @returns {Promise<<ObjectObject>} 执行结果 { verified: boolean, data: any, error: string }
     */
    async executeAction(actionId, params, context) {
        throw new Error("Method 'executeAction()' must be implemented.");
    }

    async onInitialize() {
        console.log(`[SlotInterface] Plugin initializing...`);
    }

    async onTerminate() {
        console.log(`[SlotInterface] Plugin terminating...`);
    }
}

module.exports = SlotInterface;
