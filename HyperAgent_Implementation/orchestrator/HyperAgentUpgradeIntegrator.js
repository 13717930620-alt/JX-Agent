// HyperAgentUpgradeIntegrator - upgrade integration factory

// Phase 1: Memory upgrade
const AUDNConsolidator = require('../memory_engine/AUDNConsolidator');
const MemoryBlocks = require('../memory_engine/MemoryBlocks');
const BitemporalGraph = require('../memory_engine/BitemporalGraph');
const HierarchicalRAG = require('../memory_engine/HierarchicalRAG');

// Phase 2: Decision upgrade
const StateGraph = require('../../HyperAgent_Core/cognitive_core/StateGraph');
const TreeOfThoughts = require('../../HyperAgent_Core/cognitive_core/TreeOfThoughts');
const SkillLibrary = require('./SkillLibrary');
const MCTSPlanner = require('./MCTSPlanner');

// Phase 3: Interaction upgrade
const MessagePool = require('../conversation/MessagePool');
const GroupChatManager = require('../conversation/GroupChatManager');
const AdversarialVerifier = require('../conversation/AdversarialVerifier');
const PersonaInjection = require('../conversation/PersonaInjection');

// Phase 4: Perception and execution upgrade
const ScreenAgent = require('../atomic_executor/ScreenAgent');
const CodeActMode = require('../atomic_executor/CodeActMode');
const DurableWorkflow = require('./DurableWorkflow');

// Phase 5: Anti-hallucination system
const ToolRegistry = require('../../HyperAgent_Core/tool_registry');
const ToolCallStateMachine = require('../../HyperAgent_Core/tool_call_state_machine');

class HyperAgentUpgradeIntegrator {
    /**
     * Integrate all upgrade modules
     */
    static async integrate(core, config = {}) {
        const modules = {};
        const log = (msg) => console.log(`[Upgrade] ${msg}`);

        // ============================================
        // Phase 1: Memory system upgrade
        // ============================================

        if (config.audnConsolidator !== false) {
            try {
                modules.audnConsolidator = new AUDNConsolidator({
                    llmAdapter: core.llmAdapter,
                    memoryManager: core.memoryManager,
                    batchSize: config.audnBatchSize || 10,
                    interval: config.audnInterval || 120000
                });
                core.memoryManager.setAUDNConsolidator(modules.audnConsolidator);
                modules.audnConsolidator.startAutoConsolidation();
                log('AUDNConsolidator READY');
            } catch (e) {
                log(`AUDNConsolidator FAILED: ${e.message}`);
            }
        }

        if (config.memoryBlocks !== false) {
            try {
                modules.memoryBlocks = new MemoryBlocks({
                    storageDir: require('path').join(process.cwd(), 'mem_store', 'blocks')
                });
                await modules.memoryBlocks.init();
                log(`MemoryBlocks READY (${Object.keys(modules.memoryBlocks.getStats()).length} blocks)`);
            } catch (e) {
                log(`MemoryBlocks FAILED: ${e.message}`);
            }
        }

        if (config.bitemporalGraph !== false && core.cognitiveFramework) {
            try {
                const kg = core.cognitiveFramework.knowledgeGraph || null;
                modules.bitemporalGraph = new BitemporalGraph({
                    knowledgeGraph: kg,
                    debug: false
                });
                await modules.bitemporalGraph.load();
                log(`BitemporalGraph READY (${modules.bitemporalGraph.getStats().totalFacts} facts)`);
            } catch (e) {
                log(`BitemporalGraph FAILED: ${e.message}`);
            }
        }

        if (config.hierarchicalRAG !== false && core.memoryPipeline) {
            try {
                const vs = core.memoryPipeline.vectorStore || null;
                modules.hierarchicalRAG = new HierarchicalRAG({
                    vectorStore: vs,
                    llmAdapter: core.llmAdapter
                });
                log('HierarchicalRAG READY');
            } catch (e) {
                log(`HierarchicalRAG FAILED: ${e.message}`);
            }
        }

        // ============================================
        // Phase 2: Decision and reasoning upgrade
        // ============================================

        modules.stateGraph = new StateGraph({
            stateSchema: {
                messages: { default: [], reducer: 'append' },
                completedSteps: { default: [], reducer: 'append' },
                currentGoal: { default: null },
                status: { default: 'pending' },
                result: { default: null },
                error: { default: null }
            }
        });
        log('StateGraph READY');

        if (config.treeOfThoughts !== false) {
            try {
                modules.treeOfThoughts = new TreeOfThoughts({
                    llmAdapter: core.llmAdapter,
                    searchMode: 'bfs',
                    maxBranches: 3,
                    maxDepth: 3
                });

                // 注入到 ReasoningEngine
                if (core.cognitiveFramework && core.cognitiveFramework.reasoningEngine) {
                    core.cognitiveFramework.reasoningEngine.setTreeOfThoughts(modules.treeOfThoughts);
                }
                log('TreeOfThoughts READY');
            } catch (e) {
                log(`TreeOfThoughts FAILED: ${e.message}`);
            }
        }

        if (config.skillLibrary !== false) {
            try {
                modules.skillLibrary = new SkillLibrary({
                    vectorStore: core.memoryPipeline?.vectorStore || null,
                    llmAdapter: core.llmAdapter
                });
                await modules.skillLibrary.init();

                // 注入到 Orchestrator
                if (core.orchestrator) {
                    core.orchestrator.skillLibrary = modules.skillLibrary;
                }
                log(`SkillLibrary READY (${modules.skillLibrary.getStats().totalSkills} skills)`);
            } catch (e) {
                log(`SkillLibrary FAILED: ${e.message}`);
            }
        }

        if (config.mctsPlanner === true) {  // 默认关闭（高成本）
            try {
                modules.mctsPlanner = new MCTSPlanner({
                    llmAdapter: core.llmAdapter,
                    simulationDepth: 3,
                    numSimulations: 5
                });

                if (core.cognitiveFramework && core.cognitiveFramework.reasoningEngine) {
                    core.cognitiveFramework.reasoningEngine.setMCTSPlanner(modules.mctsPlanner);
                }
                if (core.orchestrator) {
                    core.orchestrator.mctsPlanner = modules.mctsPlanner;
                }
                log('MCTSPlanner READY');
            } catch (e) {
                log(`MCTSPlanner FAILED: ${e.message}`);
            }
        }

        // ============================================
        // Phase 3: Interaction system upgrade
        // ============================================

        modules.messagePool = new MessagePool({ maxHistory: 500 });
        log('MessagePool READY');

        if (config.groupChat === true && core.conversationEngine) {  // 默认关闭
            try {
                modules.groupChatManager = new GroupChatManager({
                    llmAdapter: core.llmAdapter,
                    mode: config.groupChatMode || 'round_robin',
                    messagePool: modules.messagePool,
                    maxTurns: config.groupChatMaxTurns || 10
                });
                core.conversationEngine.setGroupChatManager(modules.groupChatManager);
                log('GroupChatManager READY');
            } catch (e) {
                log(`GroupChatManager FAILED: ${e.message}`);
            }
        }

        if (config.adversarialCheck !== false && core.llmAdapter) {
            try {
                modules.adversarialVerifier = new AdversarialVerifier({
                    llmAdapter: core.llmAdapter,
                    verificationDepth: config.adversarialDepth || 'quick'
                });
                if (core.conversationEngine) {
                    core.conversationEngine.setAdversarialVerifier(modules.adversarialVerifier);
                }
                log('AdversarialVerifier READY');
            } catch (e) {
                log(`AdversarialVerifier FAILED: ${e.message}`);
            }
        }

        if (config.personaInjection !== false) {
            try {
                modules.personaInjection = new PersonaInjection({
                    llmAdapter: core.llmAdapter
                });
                if (core.conversationEngine) {
                    core.conversationEngine.setPersonaInjection(modules.personaInjection);
                }
                log('PersonaInjection READY');
            } catch (e) {
                log(`PersonaInjection FAILED: ${e.message}`);
            }
        }

        // 注入消息池到对话引擎
        if (core.conversationEngine) {
            core.conversationEngine.setMessagePool(modules.messagePool);
        }

        // ============================================
        // Phase 5: Anti-hallucination system
        // ============================================

        if (config.antiHallucination !== false) {
            try {
                // 5.1 工具注册表 - 注册所有可用工具
                modules.toolRegistry = new ToolRegistry();
                if (core.executor?.toolExecutor) {
                    const toolDefs = core.executor.toolExecutor.getToolDefinitions();
                    for (const def of toolDefs) {
                        const name = def.function?.name || def.name;
                        const desc = def.function?.description || def.description || '';
                        const schema = def.function?.parameters || def.parameters || null;
                        if (name) {
                            modules.toolRegistry.register(name, {
                                description: desc,
                                inputSchema: schema,
                                call: async (params) => {
                                    try {
                                        return await core.executor.toolExecutor.execute({ tool: name, params });
                                    } catch (e) {
                                        return { verified: false, error: e.message };
                                    }
                                },
                                permissionLevel: 1
                            });
                        }
                    }
                }
                log(`ToolRegistry READY (${modules.toolRegistry.getStats().registeredTools} tools)`);

                // 5.2 工具调用状态机
                modules.toolCallStateMachine = new ToolCallStateMachine({
                    toolRegistry: modules.toolRegistry,
                    permissionSystem: core.permissionSystem || null,
                    maxRetries: config.toolCallMaxRetries || 3
                });

                // 注入到 Orchestrator
                if (core.orchestrator) {
                    core.orchestrator.toolCallStateMachine = modules.toolCallStateMachine;
                    core.orchestrator.toolRegistry = modules.toolRegistry;
                }

                log('ToolCallStateMachine READY (7-state lifecycle)');
            } catch (e) {
                log(`AntiHallucination FAILED: ${e.message}`);
            }
        }

        // ============================================
        // Phase 4: Perception and execution upgrade
        // ============================================

        if (config.screenAgent !== false) {
            try {
                const guiOp = core.executor?.toolExecutor
                    ? await core.executor.toolExecutor.getGuiOperator().catch(() => null)
                    : null;
                modules.screenAgent = new ScreenAgent({
                    llmAdapter: core.llmAdapter,
                    guiOperator: guiOp,
                    maxIterations: 10
                });
                if (core.executor?.toolExecutor) {
                    core.executor.toolExecutor.setScreenAgent(modules.screenAgent);
                }
                log('ScreenAgent READY');
            } catch (e) {
                log(`ScreenAgent FAILED: ${e.message}`);
            }
        }

        if (config.codeActMode === true) {  // 默认关闭
            try {
                const sandbox = core.executor?.toolExecutor?.toolRegistry?.eval_js
                    ? { execute: (code) => core.executor.toolExecutor.toolRegistry.eval_js({ code }) }
                    : null;
                modules.codeActMode = new CodeActMode({
                    safeSandbox: sandbox,
                    llmAdapter: core.llmAdapter
                });
                if (core.executor?.toolExecutor) {
                    core.executor.toolExecutor.registerCodeActMode(modules.codeActMode);
                }
                log('CodeActMode READY');
            } catch (e) {
                log(`CodeActMode FAILED: ${e.message}`);
            }
        }

        if (config.durableWorkflow !== false) {
            try {
                modules.durableWorkflow = new DurableWorkflow({
                    workflowId: `hyperagent_main`,
                    storageDir: require('path').join(process.cwd(), 'workflows')
                });
                await modules.durableWorkflow.init();

                // 恢复未完成的工作流
                const recovered = await DurableWorkflow.recover(
                    require('path').join(process.cwd(), 'workflows')
                );
                if (recovered.length > 0) {
                    log(`Recovered ${recovered.length} incomplete workflows`);
                }
                log('DurableWorkflow READY');
            } catch (e) {
                log(`DurableWorkflow FAILED: ${e.message}`);
            }
        }

        // ============================================
        // Stats
        // ============================================
        const activeModules = Object.entries(modules)
            .filter(([_, v]) => v !== null && v !== undefined)
            .map(([k]) => k);

        log(`${activeModules.length} modules integrated: ${activeModules.join(', ')}`);

        return modules;
    }
}

module.exports = HyperAgentUpgradeIntegrator;
