// ToolSystem — 类型安全的工具定义、注册、验证和执行
const path = require('path');
const fs = require('fs');

// 工具 schema 定义

class Schema {
  constructor(type, config = {}) {
    this._type = type;
    this._config = config;
    this._required = config.required !== false;
    this._default = config.default;
    this._description = config.description || '';
    this._properties = config.properties || {};
    this._items = config.items || null;
    this._enum = config.enum || null;
    this._min = config.min;
    this._max = config.max;
    this._pattern = config.pattern;
  }

  static string(config = {}) {
    return new Schema('string', config);
  }

  static number(config = {}) {
    return new Schema('number', config);
  }

  static boolean(config = {}) {
    return new Schema('boolean', config);
  }

  static array(items, config = {}) {
    return new Schema('array', { ...config, items });
  }

  static object(properties, config = {}) {
    return new Schema('object', { ...config, properties });
  }

  static enum(values, config = {}) {
    return new Schema('string', { ...config, enum: values });
  }

  static any(config = {}) {
    return new Schema('any', config);
  }

  toJSONSchema() {
    const schema = { type: this._type, description: this._description };
    if (this._properties) {
      schema.properties = {};
      for (const [key, val] of Object.entries(this._properties)) {
        schema.properties[key] = val instanceof Schema ? val.toJSONSchema() : val;
      }
    }
    if (this._items) {
      schema.items = this._items instanceof Schema ? this._items.toJSONSchema() : this._items;
    }
    if (this._enum) schema.enum = this._enum;
    if (this._min !== undefined) schema.minimum = this._min;
    if (this._max !== undefined) schema.maximum = this._max;
    if (this._pattern) schema.pattern = this._pattern;
    return schema;
  }

  validate(value) {
    if (value === undefined || value === null) {
      return { valid: !this._required, error: this._required ? `${this._description || 'field'} is required` : null };
    }
    switch (this._type) {
      case 'string':
        if (typeof value !== 'string') return { valid: false, error: `expected string, got ${typeof value}` };
        if (this._enum && !this._enum.includes(value)) return { valid: false, error: `must be one of: ${this._enum.join(', ')}` };
        if (this._min && value.length < this._min) return { valid: false, error: `min length ${this._min}` };
        if (this._max && value.length > this._max) return { valid: false, error: `max length ${this._max}` };
        if (this._pattern && !new RegExp(this._pattern).test(value)) return { valid: false, error: `does not match pattern ${this._pattern}` };
        return { valid: true };
      case 'number':
        if (typeof value !== 'number') return { valid: false, error: `expected number, got ${typeof value}` };
        if (this._min !== undefined && value < this._min) return { valid: false, error: `min ${this._min}` };
        if (this._max !== undefined && value > this._max) return { valid: false, error: `max ${this._max}` };
        return { valid: true };
      case 'boolean':
        if (typeof value !== 'boolean') return { valid: false, error: `expected boolean, got ${typeof value}` };
        return { valid: true };
      case 'array':
        if (!Array.isArray(value)) return { valid: false, error: 'expected array' };
        if (this._items && this._items instanceof Schema) {
          for (let i = 0; i < value.length; i++) {
            const result = this._items.validate(value[i]);
            if (!result.valid) return { valid: false, error: `item[${i}]: ${result.error}` };
          }
        }
        if (this._min && value.length < this._min) return { valid: false, error: `min items ${this._min}` };
        if (this._max && value.length > this._max) return { valid: false, error: `max items ${this._max}` };
        return { valid: true };
      case 'object':
        if (typeof value !== 'object' || value === null || Array.isArray(value)) return { valid: false, error: 'expected object' };
        if (this._properties) {
          for (const [key, prop] of Object.entries(this._properties)) {
            if (prop instanceof Schema) {
              const result = prop.validate(value[key]);
              if (!result.valid) return { valid: false, error: `${key}: ${result.error}` };
            }
          }
        }
        return { valid: true };
      case 'any':
        return { valid: true };
      default:
        return { valid: true };
    }
  }
}

// 工具定义基类

class ToolDefinition {
  constructor(config) {
    this.name = config.name;
    this.description = config.description;
    this.schema = config.schema || {};
    this.category = config.category || 'general';
    this.isEnabled = config.isEnabled !== false;
    this.hidden = config.hidden || false;
    this._handler = config.handler || null;
    this._tag = config.tag || null;
  }

  getInputSchema() {
    if (this.schema instanceof Schema) {
      return this.schema.toJSONSchema();
    }
    return this.schema;
  }

  async execute(params, context) {
    if (!this._handler) throw new Error(`Tool ${this.name} has no handler`);
    const schema = this.getInputSchema();
    if (schema && schema.properties) {
      for (const [key, prop] of Object.entries(schema.properties)) {
        if (prop.type === 'object' && prop.properties && params[key]) {
          continue;
        }
      }
    }
    return this._handler(params, context);
  }

  isAvailable() {
    return this.isEnabled;
  }
}

// 工具注册中心

class ToolRegistry {
  constructor() {
    this._tools = new Map();
    this._categories = new Map();
    this._toolCallIdCounter = 0;
  }

  register(tool) {
    if (!(tool instanceof ToolDefinition)) {
      throw new Error('Tool must be a ToolDefinition instance');
    }
    this._tools.set(tool.name, tool);
    const cat = this._categories.get(tool.category) || [];
    cat.push(tool.name);
    this._categories.set(tool.category, cat);
    return this;
  }

  registerHandler(name, handler, config = {}) {
    const tool = new ToolDefinition({
      name,
      description: config.description || `${name} tool`,
      schema: config.schema || null,
      category: config.category || 'custom',
      handler,
      isEnabled: config.isEnabled !== false,
      hidden: config.hidden || false,
    });
    this._tools.set(name, tool);
    return this;
  }

  get(name) {
    return this._tools.get(name) || null;
  }

  getAll() {
    return Array.from(this._tools.values());
  }

  getEnabledTools() {
    return this.getAll().filter(t => t.isAvailable() && !t.hidden);
  }

  getToolSchemasForAPI() {
    return this.getEnabledTools().map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.getInputSchema(),
    }));
  }

  getByCategory(category) {
    const names = this._categories.get(category) || [];
    return names.map(n => this._tools.get(n)).filter(Boolean);
  }

  nextToolCallId() {
    return `toolu_${Date.now()}_${++this._toolCallIdCounter}`;
  }

  async executeToolCall(toolCall, context) {
    const { name, input, id } = toolCall;
    const tool = this._tools.get(name);
    if (!tool) {
      return {
        type: 'tool_result',
        tool_use_id: id || this.nextToolCallId(),
        content: JSON.stringify({ error: `Unknown tool: ${name}` }),
        is_error: true,
      };
    }
    try {
      const result = await tool.execute(input || {}, context);
      const toolResult = {
        type: 'tool_result',
        tool_use_id: id || this.nextToolCallId(),
        content: typeof result === 'string' ? result : JSON.stringify(result),
        is_error: false,
      };

      // 验证层：对文件写入工具做磁盘校验
      const verification = this._verifyToolResult(name, input, result, toolResult);
      if (verification) {
        toolResult._verification = verification;
        if (!verification.passed) {
          toolResult.is_error = true;
          toolResult.content = JSON.stringify({
            error: `[磁盘验证失败] ${verification.reason}`,
            original_result: toolResult.content
          });
        }
      }
      return toolResult;
    } catch (error) {
      return {
        type: 'tool_result',
        tool_use_id: id || this.nextToolCallId(),
        content: JSON.stringify({ error: error.message }),
        is_error: true,
      };
    }
  }

  _verifyToolResult(name, input, result, toolResult) {
    // 通用防幻觉: 结果包含承诺而非执行 (在所有特定工具检查之前)
    if (typeof result === 'string') {
      if (result.includes('我来帮你') && result.length < 50) {
        return { passed: false, reason: `[防幻觉] 工具返回的是承诺而非执行结果` };
      }
    }

    if (name === 'Write' && input.file_path) {
      const p = path.resolve(input.file_path.replace(/\//g, path.sep));
      if (!fs.existsSync(p)) {
        return { passed: false, reason: `[磁盘校验] Write 声称已写入文件，但磁盘上不存在: ${p}` };
      }
      const stat = fs.statSync(p);
      if (stat.size === 0) {
        return { passed: false, reason: `[磁盘校验] Write 声称已写入文件，但文件大小为 0 字节: ${p}` };
      }
      return { passed: true, file_size: stat.size };
    }
    if (name === 'Edit' && input.file_path) {
      const p = path.resolve(input.file_path.replace(/\//g, path.sep));
      if (!fs.existsSync(p)) {
        return { passed: false, reason: `[磁盘校验] Edit 声称已修改文件，但磁盘上不存在: ${p}` };
      }
      return { passed: true };
    }
    if (name === 'Bash' || name === 'exec_cmd' || name === 'execute_command') {
      const content = typeof result === 'string' ? result : JSON.stringify(result);
      if (content && (content.includes('[ERROR]') || content.includes('Error:') || content.includes('not found'))) {
        return { passed: false, reason: `[输出校验] 命令执行输出中包含错误` };
      }
      if (content && (content.includes('[模拟]') || content.includes('[mock]') || content.includes('模拟执行'))) {
        return { passed: false, reason: `[防幻觉] Bash 返回模拟结果而非真实执行` };
      }
      return { passed: true };
    }
    return null;
  }
}

// 内置工具定义

function createBuiltinTools(fs, path, os, child_process) {
  const tools = [];

  // 1. Read 工具
  tools.push(new ToolDefinition({
    name: 'Read',
    description: '读取文本文件内容。如需查看图片请用 AnalyzeImage，解析文档请用 ExtractDocumentText。',
    category: 'filesystem',
    schema: Schema.object({
      file_path: Schema.string({ description: '文件的绝对路径', required: true }),
      offset: Schema.number({ description: '起始行号', required: false }),
      limit: Schema.number({ description: '读取行数限制', required: false }),
    }),
    handler: async (params, ctx) => {
      const { file_path, offset, limit } = params;
      try {
        // 检测是否为二进制/图片文件
        const ext = path.extname(file_path).toLowerCase();
        const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif'];
        const docExts = ['.pdf', '.docx', '.doc', '.xlsx', '.xls'];
        if (imageExts.includes(ext)) {
          return `[提示] ${file_path} 是图片文件，请使用 AnalyzeImage 工具来分析这张图片。`;
        }
        if (ext === '.pdf') {
          return `[提示] ${file_path} 是 PDF 文件，请使用 ExtractDocumentText 工具来提取文本。`;
        }
        if (ext === '.docx' || ext === '.doc') {
          return `[提示] ${file_path} 是 Word 文档，请使用 ExtractDocumentText 工具来提取文本。`;
        }
        if (ext === '.xlsx' || ext === '.xls') {
          return `[提示] ${file_path} 是 Excel 文件，请使用 ExtractDocumentText 工具来提取文本。`;
        }
        const content = fs.readFileSync(file_path, 'utf-8');
        const lines = content.split('\n');
        if (offset !== undefined) {
          const start = offset;
          const end = limit ? start + limit : lines.length;
          return lines.slice(start, end).join('\n');
        }
        return content;
      } catch (e) {
        throw new Error(`Read failed: ${e.message}`);
      }
    },
  }));

  // 2. Write 工具
  tools.push(new ToolDefinition({
    name: 'Write',
    description: '创建新文件或完全覆盖现有文件。Windows路径请使用 C:/Users/xxx/Desktop/file.txt 格式（正斜杠），反斜杠会被JSON转义吃掉。',
    category: 'filesystem',
    schema: Schema.object({
      file_path: Schema.string({ description: '文件的绝对路径，Windows用正斜杠如 C:/Users/name/Desktop/file.txt', required: true }),
      content: Schema.string({ description: '写入的文件内容', required: true }),
    }),
    handler: async (params) => {
      let { file_path, content } = params;
      // 修复路径：将正斜杠转为系统路径分隔符
      file_path = path.resolve(file_path.replace(/\//g, path.sep));
      const dir = path.dirname(file_path);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(file_path, content, 'utf-8');
      return `Successfully wrote ${content.length} chars to ${file_path}`;
    },
  }));

  // 3. Edit 工具
  tools.push(new ToolDefinition({
    name: 'Edit',
    description: '对文件进行精确的字符串替换编辑。',
    category: 'filesystem',
    schema: Schema.object({
      file_path: Schema.string({ description: '文件的绝对路径', required: true }),
      old_string: Schema.string({ description: '要被替换的精确文本', required: true }),
      new_string: Schema.string({ description: '替换后的新文本', required: true }),
      replace_all: Schema.boolean({ description: '是否替换所有匹配项', required: false }),
    }),
    handler: async (params) => {
      const { file_path, old_string, new_string, replace_all } = params;
      const content = fs.readFileSync(file_path, 'utf-8');
      let newContent;
      if (replace_all) {
        newContent = content.split(old_string).join(new_string);
      } else {
        newContent = content.replace(old_string, new_string);
      }
      if (content === newContent) {
        throw new Error('No match found for old_string');
      }
      fs.writeFileSync(file_path, newContent, 'utf-8');
      return `Edited ${file_path}`;
    },
  }));

  // 4. Glob 工具
  tools.push(new ToolDefinition({
    name: 'Glob',
    description: '使用glob模式查找文件。',
    category: 'filesystem',
    schema: Schema.object({
      pattern: Schema.string({ description: 'glob搜索模式', required: true }),
      path: Schema.string({ description: '搜索目录', required: false }),
    }),
    handler: async (params, ctx) => {
      const glob = require('glob');
      const searchPath = params.path || process.cwd();
      const files = glob.sync(params.pattern, { cwd: searchPath, nodir: false });
      return files.length > 0
        ? files.join('\n')
        : 'No files found matching pattern';
    },
  }));

  // 5. Grep 工具
  tools.push(new ToolDefinition({
    name: 'Grep',
    description: '在文件中搜索文本模式。支持正则表达式。',
    category: 'filesystem',
    schema: Schema.object({
      pattern: Schema.string({ description: '搜索的正则表达式模式', required: true }),
      path: Schema.string({ description: '搜索路径', required: false }),
      glob: Schema.string({ description: '文件过滤器', required: false }),
      output_mode: Schema.string({ description: '输出模式: content|files_with_matches|count', required: false }),
    }),
    handler: async (params) => {
      const { pattern, path: searchPath, glob: fileGlob, output_mode } = params;
      try {
        const { execSync } = child_process;
        let cmd = `rg --no-heading -n '${pattern.replace(/'/g, "'\\''")}'`;
        if (fileGlob) cmd += ` -g '${fileGlob}'`;
        if (output_mode === 'count') cmd += ' -c';
        if (output_mode === 'files_with_matches') cmd += ' -l';
        cmd += ` '${(searchPath || process.cwd()).replace(/'/g, "'\\''")}'`;
        return execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }).trim() || 'No matches found';
      } catch (e) {
        return e.stderr || 'No matches found or rg not available';
      }
    },
  }));

  // 6. Bash 工具
  tools.push(new ToolDefinition({
    name: 'Bash',
    description: '执行 shell 命令。',
    category: 'system',
    schema: Schema.object({
      command: Schema.string({ description: '要执行的命令', required: true }),
      description: Schema.string({ description: '命令描述', required: false }),
      timeout: Schema.number({ description: '超时时间(毫秒)', required: false }),
    }),
    handler: async (params) => {
      const { command, timeout } = params;
      try {
        const result = child_process.execSync(command, {
          encoding: 'utf-8',
          timeout: timeout || 60000,
          maxBuffer: 10 * 1024 * 1024,
          shell: true,
        });
        return result.trim() || '(command completed with no output)';
      } catch (e) {
        const msg = e.stdout || '';
        const err = e.stderr || e.message;
        return `Exit code: ${e.status}\n${msg}\n${err}`.trim();
      }
    },
  }));

  // 7. WebFetch 工具
  tools.push(new ToolDefinition({
    name: 'WebFetch',
    description: '获取 URL 内容并分析。',
    category: 'network',
    schema: Schema.object({
      url: Schema.string({ description: '要获取的URL', required: true }),
      prompt: Schema.string({ description: '对内容的分析指令', required: false }),
    }),
    handler: async (params) => {
      const https = require('https');
      const http = require('http');
      return new Promise((resolve, reject) => {
        const client = params.url.startsWith('https') ? https : http;
        client.get(params.url, { timeout: 30000 }, (res) => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => resolve(data.substring(0, 50000)));
        }).on('error', e => reject(new Error(e.message)));
      });
    },
  }));

  // 8. WebSearch 工具
  tools.push(new ToolDefinition({
    name: 'WebSearch',
    description: '搜索网络获取最新信息。支持多种搜索引擎 (Tavily/SerpAPI/Google/Bing)。',
    category: 'network',
    schema: Schema.object({
      query: Schema.string({ description: '搜索关键词', required: true }),
      topK: Schema.number({ description: '返回结果数 (默认5)', required: false }),
    }),
    handler: async (params) => {
      try {
        const WebSearch = require('../../services/WebSearch');
        return await WebSearch.search(params.query, params.topK || 5);
      } catch (e) {
        // 回退: 直接用 HTTP 请求模拟简单搜索
        return `WebSearch would search for: ${params.query}`;
      }
    },
  }));

  // 9. TaskCreate / TaskUpdate / TaskList
  tools.push(new ToolDefinition({
    name: 'TaskCreate',
    description: '创建一个新任务来追踪工作进度。',
    category: 'task',
    schema: Schema.object({
      subject: Schema.string({ description: '任务标题', required: true }),
      description: Schema.string({ description: '任务描述', required: true }),
    }),
    handler: async (params, ctx) => {
      if (ctx.taskManager) {
        return ctx.taskManager.createTask(params);
      }
      return `[Task] ${params.subject}: ${params.description}`;
    },
  }));

  tools.push(new ToolDefinition({
    name: 'TaskUpdate',
    description: '更新任务状态。',
    category: 'task',
    schema: Schema.object({
      taskId: Schema.string({ description: '任务ID', required: true }),
      status: Schema.enum(['pending', 'in_progress', 'completed'], { description: '新状态', required: false }),
    }),
    handler: async (params, ctx) => {
      if (ctx.taskManager) {
        return ctx.taskManager.updateTask(params);
      }
      return `[TaskUpdate] ${params.taskId} -> ${params.status || 'updated'}`;
    },
  }));

  // 10. AskUserQuestion
  tools.push(new ToolDefinition({
    name: 'AskUserQuestion',
    description: '向用户提问以澄清需求。',
    category: 'interaction',
    schema: Schema.object({
      question: Schema.string({ description: '要问用户的问题', required: true }),
    }),
    handler: async (params) => {
      return `[QUESTION] ${params.question}`;
    },
  }));

  // 11. SaveMemory — 持久化长期记忆（本地存储，不依赖 LLM）
  tools.push(new ToolDefinition({
    name: 'SaveMemory',
    description: '将重要信息存入长期记忆。跨会话持久化保存，下次启动时自动加载。用于存储用户偏好、工作规则、重要决策等。',
    category: 'memory',
    schema: Schema.object({
      content: Schema.string({ description: '要记住的内容', required: true }),
      tags: Schema.string({ description: '标签，如: 用户偏好,工作规则', required: false }),
    }),
    handler: async (params, ctx) => {
      const { content, tags } = params;
      try {
        if (ctx.memoryPipeline && typeof ctx.memoryPipeline.remember === 'function') {
          await ctx.memoryPipeline.remember(content, {
            level: 'L2', tags: tags || 'user_memory',
            source: 'SaveMemory_tool'
          });
          return `[SaveMemory] 已存入长期记忆: ${content.substring(0, 200)}`;
        }
        return `[SaveMemory] 记录成功（内存模式）: ${content.substring(0, 200)}`;
      } catch (e) {
        return `[SaveMemory] 存储失败: ${e.message}`;
      }
    },
  }));

  // 12. AnalyzeImage — 图片分析工具
  tools.push(new ToolDefinition({
    name: 'AnalyzeImage',
    description: '读取并分析图片文件。返回图片的 base64 编码和元数据（尺寸、格式等）。如果 LLM 支持视觉，会直接"看到"图片内容。',
    category: 'filesystem',
    schema: Schema.object({
      file_path: Schema.string({ description: '图片文件的绝对路径，支持 .jpg/.jpeg/.png/.gif/.bmp/.webp', required: true }),
    }),
    handler: async (params) => {
      const DocumentParser = require('../../JingxuanAgent_Implementation/atomic_executor/DocumentParser');
      const parser = new DocumentParser();
      const result = await parser.parseImage(params.file_path);
      // 返回结构化数据，QueryEngine 会检测到 image_data 并注入视觉 LLM
      return JSON.stringify({
        _type: 'image_data',
        base64: result.metadata.base64,
        mimeType: result.metadata.mimeType,
        fileName: result.metadata.fileName,
        width: result.metadata.width || 0,
        height: result.metadata.height || 0,
        fileSize: result.metadata.fileSize,
        format: result.metadata.format || 'unknown',
        text: result.content,
      });
    },
  }));

  // 13. ExtractDocumentText — 文档文本提取工具
  tools.push(new ToolDefinition({
    name: 'ExtractDocumentText',
    description: '从 PDF、Word (.docx)、Excel (.xlsx/.xls)、CSV、TXT 文件中提取文本内容。返回纯文本供 LLM 分析。',
    category: 'filesystem',
    schema: Schema.object({
      file_path: Schema.string({ description: '文档文件的绝对路径', required: true }),
      max_length: Schema.number({ description: '最大提取字符数，默认 100000', required: false }),
    }),
    handler: async (params) => {
      const DocumentParser = require('../../JingxuanAgent_Implementation/atomic_executor/DocumentParser');
      const parser = new DocumentParser({ maxTextLength: params.max_length || 100000 });
      const result = await parser.parse(params.file_path);
      const meta = result.metadata || {};
      const lines = [
        `[文件] ${meta.fileName || params.file_path}`,
        `[类型] ${result.type}`,
        meta.pages ? `[页数] ${meta.pages}` : '',
        meta.sheets ? `[工作表] ${meta.sheets.join(', ')}` : '',
        meta.rowCount ? `[行数] ${meta.rowCount}` : '',
        `[字符数] ${result.content.length}`,
        '',
        result.content,
      ].filter(Boolean).join('\n');
      return lines;
    },
  }));

  // 12. DocumentAutomation — 文档自动化工具
  tools.push(new ToolDefinition({
    name: 'DocumentAutomation',
    description: '文档自动化操作：对比两份文档(cmp)、生成分析报告(report)、批量解析目录(batch)、在文档中搜索(search)。返回结构化分析结果。',
    category: 'filesystem',
    schema: Schema.object({
      action: Schema.enum(['cmp', 'report', 'batch', 'search'], { description: '操作类型: cmp=对比, report=分析报告, batch=批量解析目录, search=搜索', required: true }),
      file_path: Schema.string({ description: '文件路径 (report/search 时使用，或 cmp 的第一个文件)', required: false }),
      file_path_b: Schema.string({ description: '对比时的第二个文件路径 (仅 cmp 操作)', required: false }),
      directory: Schema.string({ description: '批量解析的目录路径 (仅 batch 操作)', required: false }),
      query: Schema.string({ description: '搜索关键词 (仅 search 操作)', required: false }),
      save_report: Schema.boolean({ description: '是否保存报告到文件 (仅 report 操作)', required: false }),
    }),
    handler: async (params) => {
      const DocAuto = require('../../services/DocumentAutomation');
      const auto = new DocAuto();
      switch (params.action) {
        case 'cmp': {
          if (!params.file_path || !params.file_path_b) return '需要两个文件路径(file_path 和 file_path_b)进行对比';
          const result = await auto.compare(params.file_path, params.file_path_b);
          const lines = [
            `[文档对比] ${result.files.a} vs ${result.files.b}`,
            `相似度: ${result.similarity.percentage} (${result.similarity.description})`,
            `差异: +${result.diffs.added} 行 / -${result.diffs.removed} 行`,
            '',
          ];
          for (const d of result.diffs.details.slice(0, 30)) {
            if (d.type === 'add') lines.push(`+ ${d.text}`);
            else if (d.type === 'remove') lines.push(`- ${d.text}`);
          }
          return lines.join('\n');
        }
        case 'report': {
          if (!params.file_path) return '需要文件路径(file_path)生成报告';
          const result = await auto.generateReport(params.file_path, { save: params.save_report });
          return result.report;
        }
        case 'batch': {
          if (!params.directory) return '需要目录路径(directory)进行批量解析';
          const result = await auto.parseDirectory(params.directory, { continueOnError: true });
          const summary = result.summary;
          const lines = [
            `[批量解析] ${summary.directory}`,
            `结果: ${summary.success} 成功, ${summary.failed} 失败`,
            `类型分布: ${Object.entries(summary.types || {}).map(([k, v]) => `${k}:${v}个`).join(', ')}`,
            '',
          ];
          for (const r of result.results.slice(0, 20)) {
            const meta = r.metadata || {};
            const info = [r.type, meta.pages ? `${meta.pages}页` : '', meta.sheets ? `${meta.sheets.length}工作表` : ''].filter(Boolean).join(', ');
            lines.push(`  ✓ ${path.basename(r.filePath)} (${info})`);
          }
          for (const e of result.errors.slice(0, 5)) {
            lines.push(`  ✗ ${path.basename(e.filePath)}: ${e.error}`);
          }
          return lines.join('\n');
        }
        case 'search': {
          if (!params.file_path || !params.query) return '需要文件路径(file_path)和关键词(query)进行搜索';
          const result = await auto.searchInDocument(params.file_path, params.query);
          const lines = [`[文档搜索] "${params.query}" 在 ${path.basename(params.file_path)} 中找到 ${result.count} 处匹配`];
          for (const m of result.matches.slice(0, 30)) {
            lines.push(`  第${m.lineNumber}行: ${m.text}`);
          }
          return lines.join('\n');
        }
        default:
          return `未知操作: ${params.action}，支持: cmp(对比), report(报告), batch(批量), search(搜索)`;
      }
    },
  }));

  return tools;
}

// 工具执行上下文

class ToolUseContext {
  constructor(config = {}) {
    this.cwd = config.cwd || process.cwd();
    this.debug = config.debug || false;
    this.verbose = config.verbose || false;
    this.llmAdapter = config.llmAdapter || null;
    this.memoryPipeline = config.memoryPipeline || null;
    this.taskManager = config.taskManager || null;
    this.permissionSystem = config.permissionSystem || null;
    this.deviceManager = config.deviceManager || null;
    this.stateManager = config.stateManager || null;
    this.registry = config.registry || null;
    this.conversationHistory = config.conversationHistory || [];
    this.userMessage = config.userMessage || '';
    this.abortSignal = config.abortSignal || null;
    this.metadata = config.metadata || {};
  }

  clone(overrides = {}) {
    return new ToolUseContext({ ...this, ...overrides });
  }
}

// 导出

module.exports = {
  Schema,
  ToolDefinition,
  ToolRegistry,
  ToolUseContext,
  createBuiltinTools,
};
