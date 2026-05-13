// ContextManager — 分层系统提示构建与消息历史管理

class ContextManager {
  constructor(config = {}) {
    this.config = {
      maxHistoryMessages: config.maxHistoryMessages || 50,
      maxContextLength: config.maxContextLength || 8000,
      enableMemoryInjection: config.enableMemoryInjection !== false,
      enableTimeInjection: config.enableTimeInjection !== false,
      enableToolDescriptions: config.enableToolDescriptions !== false,
      enableUserProfiling: config.enableUserProfiling !== false,
      systemPrompt: config.systemPrompt || '',
      appendSystemPrompt: config.appendSystemPrompt || '',
      ...config,
    };

    this.messages = [];
    this.userProfile = {
      language: 'auto',
      communicationStyle: null,
      knownPreferences: {},
      commonTopics: [],
    };

    this.turnCount = 0;

    // 命中率统计
    this.stats = {
      totalContextsBuilt: 0,
      memoryInjections: 0,
    };
  }

  // 消息管理

  addMessage(role, content, metadata = {}) {
    this.messages.push({
      role,
      content,
      timestamp: Date.now(),
      turnNumber: this.turnCount,
      ...metadata,
    });

    // 自动修剪超长历史
    if (this.messages.length > this.config.maxHistoryMessages * 2) {
      this._pruneHistory();
    }
  }

  getHistory(options = {}) {
    const { maxMessages = 30, includeSystem = false } = options;
    let history = this.messages;
    if (!includeSystem) {
      history = history.filter(m => m.role !== 'system');
    }
    if (maxMessages && history.length > maxMessages) {
      history = history.slice(-maxMessages);
    }
    return history;
  }

  clearHistory() {
    this.messages = [];
    this.turnCount = 0;
  }

  _pruneHistory() {
    // 保留最近的 history，但压缩旧的
    const keepCount = this.config.maxHistoryMessages;
    if (this.messages.length > keepCount) {
      // 保留最早的系统消息（如果有）和最近的 messages
      const systemMsgs = this.messages.filter(m => m.role === 'system');
      const recentMsgs = this.messages.slice(-keepCount);
      this.messages = [...systemMsgs, ...recentMsgs];
    }
  }

  // 系统提示构建

  buildSystemContext(options = {}) {
    this.stats.totalContextsBuilt++;

    const parts = [];
    const { analysis, memoryContext, tools } = options;

    // Part 1: 核心角色定义
    parts.push(this._buildRoleDefinition(options));

    // Part 2: 能力声明
    parts.push(this._buildCapabilitiesDeclaration(options));

    // Part 2b: 系统模块清单（告知 LLM 已加载的完整系统能力）
    parts.push(
`## 系统模块（均已加载，无需额外读取源码）
- 【记忆系统】MemoryManager 分层记忆( L0-L3 )，自动持久化磁盘，跨会话自动加载
- 【任务编排】任务分解 / 工具循环 / 检查点恢复 / 自动重试
- 【执行器】文件读写 / 命令执行 / 浏览器控制 / GUI 操作 / 安全沙箱
- 【认知框架】决策引擎 / 模式检测 / 概念构建 / 知识图谱 / 经验积累
- 【LLM 适配】多模型切换（DeepSeek / GLM / Qwen / MiniMax），自动回退
- 【MCP 客户端】可连接外部工具服务器扩展能力
- 【配置系统】JingxuanAgent_Ultimate_Config.js 自动加载生效`);

    // Part 3: 工具描述
    if (this.config.enableToolDescriptions && tools && tools.length > 0) {
      parts.push(this._buildToolDescriptions(tools));
    }

    // Part 4: 当前分析
    if (analysis) {
      parts.push(this._buildAnalysisContext(analysis));
    }

    // Part 5: 记忆增强上下文
    if (this.config.enableMemoryInjection && memoryContext) {
      parts.push(memoryContext);
      this.stats.memoryInjections++;
    }

    // Part 6: 用户画像
    if (this.config.enableUserProfiling && this.turnCount > 3) {
      const profileStr = this._buildUserProfile();
      if (profileStr) parts.push(profileStr);
    }

    // Part 7: 当前时间
    if (this.config.enableTimeInjection) {
      parts.push(this._buildTimeContext());
    }

    // Part 8: 行为规则
    parts.push(this._buildBehaviorRules(options));

    // Part 9: 自定义 system prompt
    if (this.config.systemPrompt) {
      parts.push(this.config.systemPrompt);
    }

    // Part 10: 追加 system prompt
    if (this.config.appendSystemPrompt) {
      parts.push(this.config.appendSystemPrompt);
    }

    return parts.join('\n\n');
  }

  _buildRoleDefinition(options = {}) {
    const roleName = options.roleName || 'JingxuanAgent';
    const roleVersion = options.roleVersion || 'CC Edition';
    return `你是 ${roleName} ${roleVersion} — 运行在用户 Windows 电脑上的高级智能助手。
你具有真正的理解能力、判断能力和工具使用能力。`;
  }

  _buildCapabilitiesDeclaration(options = {}) {
    const caps = options.capabilities || [
      '对话交流 — 深刻理解用户意图，用自然语言交流',
      '文件操作 — 读/写/编辑/搜索本地文件，支持多种格式',
      '命令执行 — 运行 shell 命令，获取系统信息',
      '代码能力 — 阅读、编写、调试、审查代码',
      '网络访问 — 获取网页内容，搜索网络信息',
      '任务管理 — 创建和追踪工作进度',
    ];
    return `## 能力\n${caps.map((c, i) => `${i + 1}. ${c}`).join('\n')}`;
  }

  _buildToolDescriptions(tools) {
    const lines = ['## 可用工具\n你可以使用以下工具来完成任务:'];
    for (const tool of tools) {
      if (tool.hidden) continue;
      const schema = typeof tool.getInputSchema === 'function' ? tool.getInputSchema() : (tool.input_schema || {});
      const props = schema.properties || {};
      const params = Object.keys(props).length > 0
        ? Object.entries(props)
            .map(([k, v]) => `  - ${k}${schema.required?.includes(k) ? ' (必需)' : ''}: ${v.description || v.type}`)
            .join('\n')
        : '  (无参数)';
      lines.push(`\n### ${tool.name}\n${tool.description}\n参数:\n${params}`);
    }
    return lines.join('\n');
  }

  _buildAnalysisContext(analysis) {
    return `## 当前分析\n- 意图: ${analysis.intent || 'chat'}\n- 复杂度: ${analysis.complexity || 'simple'}\n- 摘要: ${analysis.summary || ''}`;
  }

  _buildUserProfile() {
    const parts = [];
    if (this.userProfile.communicationStyle) {
      parts.push(`风格: ${this.userProfile.communicationStyle}`);
    }
    const prefs = Object.entries(this.userProfile.knownPreferences);
    if (prefs.length > 0) {
      parts.push(`偏好: ${prefs.slice(-5).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    }
    if (parts.length > 0) {
      return `[用户画像]\n${parts.join('\n')}`;
    }
    return null;
  }

  _buildTimeContext() {
    const now = new Date();
    return `[当前时间]\n本地时间: ${now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}\nISO: ${now.toISOString()}\n时区: Asia/Shanghai (UTC+8)`;
  }

  _buildBehaviorRules(options = {}) {
    const rules = options.behaviorRules || [
      '使用用户的语言回复（中文/英文）',
      '回复要简洁专业，直接解决问题',
      '使用工具前简要说明你要做什么',
      '如果用户问"如何做X"，提供步骤说明，不要真的执行',
      '不确定时，优先提问澄清而不是猜测执行',
      '对于复杂任务，分解步骤依次执行',
      '【关键】当用户要求执行操作时（创建文件、运行命令、修改设置等），你必须调用对应的工具来执行，绝不能只用文字回复"好的我做了"这种假成功。没有实际调用工具 = 没有执行任务。',
      '【关键】工具调用后，必须检查返回结果中的 is_error 和 _verification 字段。如果 is_error=true，说明执行失败，你必须如实报告错误信息。如果 _verification.passed=false，说明磁盘校验未通过，文件没有真正写入，你必须报告验证失败。',
    ];
    return `## 回复规则\n${rules.map(r => `- ${r}`).join('\n')}`;
  }

  // 构建完整消息列表

  buildMessages(userMessage, options = {}) {
    this.turnCount++;

    const { analysis, memoryContext, tools, systemPromptOverrides } = options;

    // 构建 system prompt
    const systemContent = this.buildSystemContext({
      analysis,
      memoryContext,
      tools,
      ...systemPromptOverrides,
    });

    // 构建消息列表
    const messages = [
      { role: 'system', content: systemContent },
      ...this.getHistory({ maxMessages: 20 }),
      { role: 'user', content: userMessage },
    ];

    return messages;
  }

  // 用户画像更新

  updateUserProfile(message, response) {
    // 语言检测
    const chineseChars = (message.match(/[一-鿿]/g) || []).length;
    const totalChars = message.replace(/\s/g, '').length;
    if (totalChars > 0) {
      this.userProfile.language = (chineseChars / totalChars) > 0.3 ? 'zh' : 'en';
    }

    // 风格检测
    if (this.turnCount > 2 && response) {
      if (response.length > 500) {
        this.userProfile.communicationStyle = 'detailed';
      } else if (response.length < 80) {
        this.userProfile.communicationStyle = 'concise';
      }
    }
  }

  // 状态

  getStats() {
    return {
      turnCount: this.turnCount,
      messageCount: this.messages.length,
      totalContextsBuilt: this.stats.totalContextsBuilt,
      memoryInjections: this.stats.memoryInjections,
      userLanguage: this.userProfile.language,
      userStyle: this.userProfile.communicationStyle,
    };
  }

  setSystemPrompt(prompt) {
    this.config.systemPrompt = prompt;
  }

  setAppendSystemPrompt(prompt) {
    this.config.appendSystemPrompt = prompt;
  }
}

module.exports = ContextManager;
