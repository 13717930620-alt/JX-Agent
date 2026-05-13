class MCTSPlanner {
    constructor(options = {}) {
        this.llmAdapter = options.llmAdapter || null;
        this.simulationDepth = options.simulationDepth || 3;
        this.numSimulations = options.numSimulations || 5;
    }

    async plan(goal, context = {}) {
        return { steps: [], description: `MCTS plan for: ${goal}` };
    }
}

module.exports = MCTSPlanner;
