# HyperAgent — 承载体智能体系统

> 💡 **我不会写代码。这个项目是我用 AI 辅助（Claude Code / ChatGPT）从零构建的。**
> 它现在有约 30,000 行代码、60+ 模块、45+ 工具，能在 Windows/Linux/macOS 上运行。
> 如果你觉得有用，欢迎 Star ⭐ 和贡献代码。

让您的电脑拥有自己的智能体，用自然语言指挥它完成目标。

**版本**: 5.0.0 | **语言**: Node.js | **平台**: Windows / macOS / Linux

---

## 快速开始

```bash
cd hyperagent
npm install
# 配置 .env（复制 .env.example 并填入 API Key）
cp .env.example .env
# 启动交互模式
node HyperAgent_Main.js
```

详细安装说明 → [docs/INSTALL.md](docs/INSTALL.md)

---

## 核心设计

### 明确指令 = 授权

当您给出明确的操作指令时，HyperAgent 在该任务范围内直接执行，无需额外授权:

```
你: "帮我创建一个文件 test.txt"
 → HyperAgent: 直接创建文件 ✅
```

提问 vs 指令由内置的反任务幻觉系统区分，无需记忆额外的"咒语"。

详细使用说明 → [docs/USAGE.md](docs/USAGE.md)

---

## 快速示例

| 你说 | 效果 |
|------|------|
| `当前系统时间是多少？` | 查询系统信息 |
| `帮我创建一个桌面文件 readme.txt` | 创建文件 |
| `帮我运行 ipconfig` | 执行命令 |
| `列出所有 Chrome 进程` | 进程管理 |
| `截取当前屏幕` | 桌面截图 |
| `打开百度搜索"HyperAgent"` | 浏览器自动化 |
| `对比这两个文件的差异` | 代码 diff (v5.0) |
| `分析这个函数的时间复杂度` | 代码分析 (v5.0) |
| `.work` | 查看工作记录，中断后快速恢复 |

---

## 功能一览

| 模块 | 说明 |
|------|------|
| **文件操作** | 读/写/编辑/搜索/复制/移动/删除 |
| **命令执行** | cmd / PowerShell，安全限制 |
| **进程管理** | 查看/终止进程，服务控制 |
| **系统操控** | 剪贴板、通知、电源管理 |
| **浏览器** | Puppeteer 自动化 |
| **GUI 操作** | 桌面鼠标/键盘/截图（UI-TARS） |
| **网络请求** | HTTP GET/POST |
| **记忆系统** | 四层记忆 + 语义搜索 + RAG |
| **持续学习** | 三环自动进化 |
| **认知框架** | 从经验自建认知 |
| **思维树** | 多分支推理 |
| **多模型** | DeepSeek / GLM / Qwen / MiniMax |
| **远程访问** | 公网隧道（localtunnel） |
| **代码工具链 (v5.0)** | Diff/Apply 补丁、LSP 代码智能、AST 分析 |
| **真实 Embedding (v5.0)** | 支持 text-embedding-3 / BGE / jina-embeddings 语义搜索 |
| **检查点恢复 (v5.0)** | 长时间任务可中断恢复 |
| **工作记录 (v5.0)** | 中断后自动恢复工作状态 |

---

## 项目结构

```
hyperagent/
├── HyperAgent_Main.js                 # 主入口
├── HyperAgent_Config.js                # 配置（终极版配置优先）
├── HyperAgent_Ultimate_Config.js       # 终极版配置 v5.0
├── HyperAgent_Core/                    # 核心系统
│   ├── llm_adapter/                    # LLM 适配器（DeepSeek / GLM / Qwen / ...）
│   ├── mcp_client/                     # MCP 协议客户端
│   ├── cognitive_core/                 # 认知框架
│   └── plugin_system/                  # 插件系统
├── HyperAgent_Implementation/          # 具体实现
│   ├── conversation/                   # 对话引擎 + 反幻觉意图分析
│   ├── orchestrator/                   # 任务编排器 + 检查点 (v5.0)
│   ├── atomic_executor/                # 工具执行器 + 代码工具 (v5.0)
│   ├── memory_engine/                  # 记忆引擎 + Embedding (v5.0)
│   ├── device_abstraction/             # 设备抽象层 + 安全引擎
│   ├── sop_generator/                  # SOP 生成器
│   └── permission/                     # 权限系统
├── HyperAgent_Monitoring/              # 监控和指标
├── docs/                               # 文档
│   ├── INSTALL.md                      # 安装指南
│   └── USAGE.md                        # 使用说明
├── work_records/                        # 工作记录（中断恢复）
├── mem_store/                           # 记忆存储
├── checkpoints/                         # 任务检查点
├── experience_store/                    # 经验库
├── web/                                # Web 控制台
├── plugins/                            # 插件目录
└── tests/                              # 测试
```

---

## 技术规格

| 项目 | 值 |
|------|-----|
| 运行环境 | Node.js 18+ |
| 工具数 | 45+ (含 v5.0 代码工具) |
| 支持的 LLM | DeepSeek / GLM / Qwen / MiniMax |
| GUI 自动化 | UI-TARS + Nut.js |
| 浏览器 | Puppeteer |
| 协议 | MCP (Model Context Protocol) |
| 记忆层级 | L0 → L1 → L2 → L3 + 认知升华 |
| Embedding (v5.0) | text-embedding-3 / BGE / jina-embeddings / 内置 TF-IDF |
| 检查点 (v5.0) | 完整执行上下文持久化 + 中断恢复 |
| 工作记录 (v5.0) | 自动记录工作目标/进度，重启后恢复上下文 |
| 代码工具 (v5.0) | Diff/Apply / LSP (JS/TS/Python/Go/Rust/Java) / AST 分析 |

---

## 许可证

MIT License
