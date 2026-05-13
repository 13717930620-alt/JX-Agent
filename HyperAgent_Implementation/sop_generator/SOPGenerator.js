class SOPGenerator {
    constructor(memoryManager, llmAdapter) {
        this.memoryManager = memoryManager;
        this.llmAdapter = llmAdapter;
        this._capabilityMap = null;
    }

    setCapabilityMap(map) {
        this._capabilityMap = map;
    }

    async generate(goal, context = {}) {
        return { steps: [], description: `SOP for: ${goal}` };
    }

    getStats() {
        return { type: 'sop_generator', ready: true };
    }
}

module.exports = SOPGenerator;
