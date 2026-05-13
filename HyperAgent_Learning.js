/**
 * HyperAgent_Learning.js — 自我进化系统
 *
 * 知识提取、工具效能跟踪、错误学习、用户偏好学习
 */

class SelfLearning {
  constructor(config = {}) {
    this.storage = config.storage;
    this.metrics = config.metrics;
    this.log = config.log || console;
    this.ccContextManager = config.ccContextManager;
    this.toolRegistry = config.toolRegistry;

    this.config = {
      extractKnowledge: config.extractKnowledge !== false,
      trackToolEffectiveness: config.trackToolEffectiveness !== false,
      learnUserPreferences: config.learnUserPreferences !== false,
      maxKnowledgeInjection: config.maxKnowledgeInjection || 5,
      ...config,
    };

    this.stats = {
      extractions: 0,
      toolRecords: 0,
      preferenceUpdates: 0,
      injections: 0,
    };
  }

  // 知识提取 — 对话结束后调用

  async extractKnowledge(userMessage, response, toolCalls = []) {
    if (!this.config.extractKnowledge || !this.storage?._ready) return;
    this.stats.extractions++;

    // 提取工具调用模式
    if (toolCalls.length > 0) {
      const patterns = this._extractToolPatterns(toolCalls);
      for (const p of patterns) {
        // 累加工具-任务对的使用频率
        const key = `tool_pattern:${p.tool}:${p.task}`;
        const existing = this.storage.getKnowledge(key);
        if (existing) {
          const data = JSON.parse(existing.value);
          data.count = (data.count || 1) + 1;
          data.lastUsed = new Date().toISOString();
          this.storage.setKnowledge(key, JSON.stringify(data), 'tool_pattern');
        } else {
          this.storage.setKnowledge(key, JSON.stringify({ ...p, count: 1, lastUsed: new Date().toISOString() }), 'tool_pattern');
        }
      }
    }

    // 提取用户指令中的关键信息
    const facts = this._extractFacts(userMessage);
    for (const fact of facts) {
      this.storage.setKnowledge(`user_fact:${fact.key}`, fact.value, 'user_fact');
    }
  }

  _extractToolPatterns(toolCalls) {
    const patterns = [];
    for (const tc of toolCalls) {
      const name = tc.name || tc.function?.name || '';
      const input = tc.input || tc.function?.arguments || '';

      if (name.includes('Read') || name.includes('Grep') || name.includes('Glob')) {
        patterns.push({ tool: 'search', task: 'find_information' });
      } else if (name.includes('Write') || name.includes('Edit')) {
        patterns.push({ tool: 'edit', task: 'modify_file' });
      } else if (name.includes('Bash')) {
        const cmd = typeof input === 'string' ? input : (input.command || '');
        if (cmd.includes('npm') || cmd.includes('node')) patterns.push({ tool: 'bash', task: 'node_operation' });
        else if (cmd.includes('git')) patterns.push({ tool: 'bash', task: 'git_operation' });
        else if (cmd.includes('pip') || cmd.includes('python')) patterns.push({ tool: 'bash', task: 'python_operation' });
        else patterns.push({ tool: 'bash', task: 'general_command' });
      } else if (name.includes('WebSearch') || name.includes('WebFetch')) {
        patterns.push({ tool: 'web', task: 'online_research' });
      }
    }
    return patterns;
  }

  _extractFacts(message) {
    const facts = [];
    // 提取用户的显性指令偏好
    if (/帮我.*(写|创建|生成|制作)/i.test(message)) facts.push({ key: 'prefers_creation', value: 'true' });
    if (/分析|统计|比较|检查/i.test(message)) facts.push({ key: 'prefers_analysis', value: 'true' });
    if (/修复|修|改|调试|bug/i.test(message)) facts.push({ key: 'prefers_debugging', value: 'true' });
    return facts;
  }

  // 工具效能追踪

  async recordToolEffectiveness(toolCall, durationMs, isError) {
    if (!this.config.trackToolEffectiveness || !this.storage?._ready) return;
    this.stats.toolRecords++;

    const name = typeof toolCall === 'string' ? toolCall : (toolCall.name || toolCall.function?.name || 'unknown');
    const key = `tool_effectiveness:${name}`;
    const existing = this.storage.getKnowledge(key);

    if (existing) {
      const data = JSON.parse(existing.value);
      data.totalCalls = (data.totalCalls || 0) + 1;
      data.errorCount = (data.errorCount || 0) + (isError ? 1 : 0);
      data.totalDuration = (data.totalDuration || 0) + durationMs;
      data.lastUsed = new Date().toISOString();
      data.avgDuration = Math.round(data.totalDuration / data.totalCalls);
      data.successRate = Math.round(((data.totalCalls - data.errorCount) / data.totalCalls) * 100);
      this.storage.setKnowledge(key, JSON.stringify(data), 'tool_stats');
    } else {
      this.storage.setKnowledge(key, JSON.stringify({
        toolName: name,
        totalCalls: 1,
        errorCount: isError ? 1 : 0,
        totalDuration: durationMs,
        avgDuration: durationMs,
        successRate: isError ? 0 : 100,
        firstUsed: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
      }), 'tool_stats');
    }
  }

  getToolRecommendations() {
    if (!this.storage?._ready) return [];
    const results = this.storage.searchKnowledge('tool_effectiveness:', 'tool_stats');
    return results
      .map(r => {
        try { return { key: r.key, ...JSON.parse(r.value) }; } catch { return null; }
      })
      .filter(Boolean)
      .filter(t => t.totalCalls >= 3)
      .sort((a, b) => (b.successRate || 0) - (a.successRate || 0));
  }

  // 错误学习

  async recordError(context, error) {
    if (!this.storage?._ready) return;
    const key = `error:${context.substring(0, 40)}:${Date.now()}`;
    this.storage.setKnowledge(key, JSON.stringify({
      context: context.substring(0, 200),
      error: error.message || String(error).substring(0, 200),
      time: new Date().toISOString(),
    }), 'error_log');

    // 统计同类错误
    const errorKey = `error_pattern:${error.message?.substring(0, 50) || 'unknown'}`;
    const existing = this.storage.getKnowledge(errorKey);
    if (existing) {
      const data = JSON.parse(existing.value);
      data.count++;
      data.lastSeen = new Date().toISOString();
      this.storage.setKnowledge(errorKey, JSON.stringify(data), 'error_pattern');
    } else {
      this.storage.setKnowledge(errorKey, JSON.stringify({
        message: error.message?.substring(0, 200) || 'unknown',
        count: 1,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      }), 'error_pattern');
    }
  }

  // 用户偏好学习

  async updateUserPreferences(message, response) {
    if (!this.config.learnUserPreferences || !this.storage?._ready) return;
    this.stats.preferenceUpdates++;

    // 语言偏好
    const chineseRatio = (message.match(/[一-鿿]/g) || []).length / Math.max(message.length, 1);
    if (chineseRatio > 0.3) {
      this.storage.setKnowledge('user_pref:language', 'zh', 'user_preference');
    }

    // 沟通风格
    if (message.length < 20) {
      this.storage.setKnowledge('user_pref:style_concise', 'true', 'user_preference');
    } else if (message.length > 200) {
      this.storage.setKnowledge('user_pref:style_detailed', 'true', 'user_preference');
    }

    // 活跃时段
    const hour = new Date().getHours();
    const existing = this.storage.getKnowledge('user_pref:active_hours');
    const hours = existing ? JSON.parse(existing.value) : [];
    if (!hours.includes(hour)) {
      hours.push(hour);
      this.storage.setKnowledge('user_pref:active_hours', JSON.stringify(hours.sort()), 'user_preference');
    }
  }

  getUserPreferences() {
    if (!this.storage?._ready) return {};
    const results = this.storage.searchKnowledge('user_pref:', 'user_preference');
    const prefs = {};
    for (const r of results) {
      const shortKey = r.key.replace('user_pref:', '');
      try { prefs[shortKey] = JSON.parse(r.value); } catch { prefs[shortKey] = r.value; }
    }
    return prefs;
  }

  // 学习成果注入到 system prompt

  buildLearningContext() {
    if (!this.storage?._ready) return '';
    this.stats.injections++;

    const parts = [];

    // 工具效能推荐
    const topTools = this.getToolRecommendations().slice(0, 3);
    if (topTools.length > 0) {
      parts.push(`[经验] 以下工具之前效果较好：${topTools.map(t => `${t.toolName}(${t.successRate}%成功率,${t.avgDuration}ms平均耗时)`).join('、')}`);
    }

    // 用户偏好
    const prefs = this.getUserPreferences();
    const prefLines = [];
    if (prefs.language === 'zh') prefLines.push('用户习惯用中文交流');
    if (prefs.style_concise === 'true') prefLines.push('用户偏好简洁回复');
    if (prefs.style_detailed === 'true') prefLines.push('用户偏好详细回复');
    if (prefs.prefers_creation === 'true') prefLines.push('用户经常要求创作内容');
    if (prefs.prefers_debugging === 'true') prefLines.push('用户经常需要调试帮助');
    if (prefLines.length > 0) parts.push(`[用户习惯] ${prefLines.join('；')}`);

    // 错误警告
    const errors = this.storage.searchKnowledge('error_pattern:', 'error_pattern');
    const frequentErrors = errors
      .map(r => { try { return JSON.parse(r.value); } catch { return null; } })
      .filter(Boolean)
      .filter(e => e.count >= 3);
    if (frequentErrors.length > 0) {
      parts.push(`[注意] 之前遇到过 ${frequentErrors.length} 类反复错误，建议注意避免`);
    }

    return parts.length > 0 ? parts.join('\n') : '';
  }

  // 统计

  getStats() {
    return {
      extractions: this.stats.extractions,
      toolRecords: this.stats.toolRecords,
      preferenceUpdates: this.stats.preferenceUpdates,
      injections: this.stats.injections,
      patterns: this.config.trackToolEffectiveness ? this.getToolRecommendations().length : 0,
    };
  }
}

module.exports = SelfLearning;
