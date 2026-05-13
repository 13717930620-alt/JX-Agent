/**
 * universal_coordinator.js
 * 流程：Research -> Synthesis -> Implementation -> Verification
 */
class UniversalCoordinator {
    constructor(agent, taskContext) {
        this.agent = agent;
        this.task = taskContext;
        this.state = 'RESEARCH';
        this.context = {};
    }

    async run() {
        console.log(`[UniversalCoordinator] 启动任务流水线: ${this.task.goal}`);
        while (this.state !== 'SUCCESS') {
            switch (this.state) {
                case 'RESEARCH':
                    console.log("[Coordinator] 阶段: 研究 (RESEARCH)...");
                    this.context.data = await this._doResearch();
                    this.state = 'SYNTHESIS';
                    break;
                case 'SYNTHESIS':
                    console.log("[Coordinator] 阶段: 综合 (SYNTHESIS)...");
                    this.context.plan = await this._doSynthesis();
                    this.state = 'IMPLEMENTATION';
                    break;
                case 'IMPLEMENTATION':
                    console.log("[Coordinator] 阶段: 执行 (IMPLEMENTATION)...");
                    this.context.result = await this._doImplementation();
                    this.state = 'VERIFICATION';
                    break;
                case 'VERIFICATION':
                    console.log("[Coordinator] 阶段: 验证 (VERIFICATION)...");
                    const isValid = await this._doVerification();
                    this.state = isValid ? 'SUCCESS' : 'RESEARCH'; 
                    break;
            }
        }
        console.log("[Coordinator] 任务成功完成。");
        return this.context.result;
    }

    async _doResearch() {
        // 调用 Agent 的工具系统进行调研
        return await this.agent.ccQueryEngine.processMessage(`深度调研关于 ${this.task.goal} 的相关信息，尽可能详尽。`);
    }

    async _doSynthesis() {
        // 将调研结果转化为执行计划
        const prompt = `基于以下调研数据，为任务 "${this.task.goal}" 制定一个最高效的执行方案：\n\n${this.context.data}`;
        return await this.agent.components.llmAdapter.chat([{ role: 'user', content: prompt }]);
    }

    async _doImplementation() {
        // 执行计划
        const prompt = `按照以下计划执行任务 "${this.task.goal}"：\n\n${this.context.plan}`;
        return await this.agent.ccQueryEngine.processMessage(prompt);
    }

    async _doVerification() {
        // 质量审计
        const prompt = `请审计以下执行结果是否完全达到了任务目标 "${this.task.goal}"，并检查是否存在逻辑错误或缺失项。如果合格请回复 "PASS"，否则请指出问题：\n\n${this.context.result}`;
        const res = await this.agent.components.llmAdapter.chat([{ role: 'user', content: prompt }]);
        return res.includes('PASS');
    }
}

module.exports = UniversalCoordinator;
