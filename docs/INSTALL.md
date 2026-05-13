# HyperAgent 安装指南

## 系统要求

| 项目 | 要求 |
|------|------|
| 运行环境 | Node.js 18+ |
| 操作系统 | Windows 10/11（推荐）、macOS、Linux |
| 内存 | 最低 2GB，推荐 4GB+ |
| 网络 | 需要访问 LLM API 端点 |

---

## 一、安装步骤

### 1. 下载项目

```bash
# 进入项目目录
cd hyperagent
```

### 2. 安装依赖

```bash
npm install
```

安装内容包括:
- **核心框架**: express, axios, ws, uuid, dotenv
- **MCP 服务器**: filesystem, puppeteer（浏览器自动化）
- **GUI 自动化**: @ui-tars/sdk, @ui-tars/operator-nut-js, @ui-tars/action-parser
- **其他工具**: localtunnel（远程访问）

> **注意**: Puppeteer 首次运行时会自动下载 Chromium（约 300MB）。如需手动安装:
> ```bash
> npx puppeteer browsers install chrome
> ```

### 3. 配置 LLM

```bash
# 复制环境变量模板
cp .env.example .env
```

编辑 `.env` 文件，至少配置一个 LLM 的 API Key:

#### 方式 A: DeepSeek（推荐）

```env
LLM_ADAPTER=deepseek
DEEPSEEK_API_KEY=sk-your-key-here
DEEPSEEK_BASE_URL=https://api.deepseek.com/chat/completions
DEEPSEEK_MODEL=deepseek-pro
```

#### 方式 B: GLM（智谱）

```env
LLM_ADAPTER=glm
GLM_API_KEY=your-glm-key
GLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
GLM_MODEL=glm-4.7-flash
```

#### 方式 C: Qwen（通义千问）

```env
LLM_ADAPTER=qwen
QWEN_API_KEY=your-qwen-key
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen-plus
```

### 4. (可选) 配置 Embedding 模型 — v5.0 真实语义搜索

HyperAgent v5.0 支持使用真实 Embedding 模型替换内置 TF-IDF，大幅提升记忆检索精度。

#### 方式 A: OpenAI text-embedding-3（推荐，效果最佳）

```env
EMBEDDING_MODE=api
EMBEDDING_API_URL=https://api.openai.com/v1/embeddings
EMBEDDING_API_KEY=sk-your-openai-key
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSION=1536
```

#### 方式 B: Jina Embeddings（开源替代）

```env
EMBEDDING_MODE=api
EMBEDDING_API_URL=https://api.jina.ai/v1/embeddings
EMBEDDING_API_KEY=jina_your-key
EMBEDDING_MODEL=jina-embeddings-v3
EMBEDDING_DIMENSION=1024
```

#### 方式 C: 本地 BGE（通过 ollama，无需 API Key）

```env
# 先安装 ollama 并拉取模型:
#   ollama pull bge-m3
#   ollama pull nomic-embed-text
EMBEDDING_MODE=local
OLLAMA_URL=http://localhost:11434
LOCAL_EMBED_MODEL=bge-m3
```

#### 方式 D: 内置引擎（默认，零配置）

不配置任何 Embedding 环境变量时，自动使用内置 TF-IDF + N-gram 引擎，无需任何外部依赖即可运行。

### 5. (可选) 代码工具链 — LSP 语言服务器

代码分析工具中的 LSP 集成需要安装对应语言的 LSP 服务器:

```bash
# JavaScript/TypeScript
npm install -g typescript-language-server typescript

# Python
pip install pyright  # 或 pylsp

# Go
go install golang.org/x/tools/gopls@latest

# Rust
rustup component add rust-analyzer
```

如果未安装对应的 LSP 服务器，代码工具的其他功能（diff/apply、AST 分析）仍可正常使用。

---

## 二、启动

### 交互模式（CLI）

```bash
node HyperAgent_Main.js
```

启动后进入交互式命令行，输入指令即可与 HyperAgent 对话。

HyperAgent 会自动在项目目录下创建以下数据目录:
- **`work_records/`** — 工作记录（中断恢复用）
- **`mem_store/`** — 记忆存储（L1-L3 记忆）
- **`checkpoints/`** — 任务检查点（长时间任务恢复）
- **`experience_store/`** — 经验库（认知框架）

### 服务模式（Web + API）

```bash
node HyperAgent_Main.js server
```

访问 `http://localhost:3000` 打开 Web 控制台。

默认从 3000 端口开始，被占用会自动递增。

---

## 三、验证安装

启动后，输入以下指令测试是否正常工作:

```
你好，在吗？
```

如果 LLM 配置正确，会收到正常回复。然后测试工具执行:

```
帮我查看一下当前系统时间
```

系统会调用工具并返回结果。

### v5.0 新功能验证

```
# 验证代码差异对比
帮我对比 "hello" 和 "world" 的差异

# 验证代码复杂度分析
帮我分析以下代码的复杂度: function test(a,b){ if(a)return a; return b; }

# 验证检查点系统 (长时间任务自动保存)
帮我创建一个多步骤任务: 先创建文件1.txt，再创建文件2.txt，然后列出桌面文件

# 验证 Embedding (配置后自动生效)
请记住一个重要信息: 我的生日是5月20日
```

---

## 常见问题

### Q: 启动报 "No API key set"
确保 `.env` 文件已正确配置 API Key。

### Q: Puppeteer 启动失败
```bash
npx puppeteer browsers install chrome
```

### Q: 端口被占用
服务模式会自动尝试递增端口，查看控制台输出的实际端口号。

### Q: 如何切换 LLM 模型
运行中可以直接说"换用GLM模型"或修改 `.env` 文件后重启。

### Q: Embedding 不起作用
- API 模式: 确保 `EMBEDDING_API_URL` 和 `EMBEDDING_API_KEY` 正确
- local 模式: 确保 ollama 已启动且模型已拉取
- 内置模式无需配置，始终可用

### Q: LSP 提示 "不支持的 LSP 语言"
需要安装对应语言的 LSP 服务器，详见上文的"代码工具链"章节。
