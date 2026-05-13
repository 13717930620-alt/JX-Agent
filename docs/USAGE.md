# JingxuanAgent 使用说明

JingxuanAgent 是一个运行在您电脑上的智能助手，通过自然语言指令操控您的电脑。

---

## 核心原则

**明确指令 = 在该任务范围内已取得授权**

当您给出明确的操作指令时，JingxuanAgent 会直接执行，无需额外授权。例如:

```
❌ 需要先授权再执行:
   用户: "你可以操控我的电脑了"   ← 不需要
   用户: "帮我创建一个文件"

✅ 直接下指令即可:
   用户: "帮我创建一个文件"
```

如果您只是提问而非下指令，JingxuanAgent 会回答问题而不执行任何操作。

---

## 指令示例

### 文件操作

```
帮我创建一个文件 test.txt，内容是"你好世界"
把桌面上的 report.docx 复制到 D:\backup 目录
删除 C:\temp\old.log
列出我的桌面有哪些文件
搜索 D:\projects 目录下所有包含 "TODO" 的文件
将这个文件中的 "abc" 全部替换为 "xyz"
```

### 命令执行

```
帮我看看当前系统进程
查一下 CPU 使用率
运行 ipconfig 查看网络配置
清理一下系统临时文件
```

### 系统信息

```
当前系统时间是多少？
我的电脑有多少内存？
显示我的 IP 地址
这台电脑运行了多久？
```

### 进程管理

```
列出所有 Chrome 进程
帮我结束 PID 1234 的进程
```

### 浏览器自动化

```
打开百度搜索"JingxuanAgent"
截图当前浏览器页面
把搜索结果保存到文件
```

### 桌面 GUI 操作

```
截取当前屏幕
点击屏幕中央位置
分析一下屏幕上的内容
```

### 剪贴板和通知

```
复制"你好"到剪贴板
获取剪贴板内容
发送通知"任务完成了"
```

---

## v5.0 新功能

### 1. 代码差异对比 (Diff/Apply)

生成和运用 unified diff 格式补丁:

```
# 对比两段文本的差异
帮我对比以下两段代码的差异:
原文: "function add(a,b){return a+b}"
改后: "function add(a,b){return a + b;}"
```

Diff 工具会自动计算出增删行和变更统计，输出标准的 unified diff 格式。

### 2. LSP 代码智能

连接语言服务器，获取专业的代码诊断和分析:

```
# 启动 LSP 服务器
启动 JavaScript 的代码分析服务器

# 获取代码诊断
帮我检查 index.js 文件有没有语法错误

# 获取代码补全
在 index.js 的第5行第10列给我补全建议

# 查看类型信息
查看 index.js 第5行第10列的类型信息

# 跳转到定义
查看 index.js 第3行第8列的符号定义位置
```

需要先安装对应的 LSP 服务器（详见 INSTALL.md）。

### 3. AST 代码结构分析

无需外部依赖，直接解析 JavaScript/TypeScript 代码结构:

```
# 提取函数和类定义
分析以下代码的结构: 
function greet(name) { return "Hello " + name; }
class Calculator {
  add(a,b){return a+b}
  subtract(a,b){return a-b}
}

# 分析代码复杂度
帮我分析以下代码的圈复杂度:
function process(data) {
  if (data.valid) {
    for (const item of data.items) {
      if (item.active) {
        processItem(item);
      }
    }
  }
  return result;
}
```

### 4. 真实语义搜索 (Embedding)

JingxuanAgent v5.0 的记忆系统支持三种 Embedding 模式:

| 模式 | 配置 | 精度 | 依赖 |
|------|------|------|------|
| API | `EMBEDDING_MODE=api` | ★★★★★ | 需 API Key |
| Local | `EMBEDDING_MODE=local` + ollama | ★★★★ | 需 ollama |
| Builtin | 默认（零配置） | ★★★ | 无 |

配置后自动生效，无需手动干预。所有记忆的检索（跨会话记忆、RAG 增强、语义搜索）都会使用 Embedding 提升准确度。

验证 Embedding 已生效:

```
启动时控制台输出: [MemoryPipeline] 初始化完成 (XX项索引, embedding=api)
或: [VectorStore] Building embeddings for XX items (mode=api)
```

### 5. 检查点恢复 (长时间任务)

长时间、多步骤的任务会自动保存执行状态:

- 每完成一个子任务自动保存检查点
- 工具循环执行中每 5 步自动保存
- 任务中断后重新运行可自动恢复

```
# 创建一个多步骤任务（会自动在后台保存检查点）
帮我做三件事: 先查看系统信息，再创建一个测试文件，最后列出桌面文件

# 模拟中断: Ctrl+C 退出后重启，再次输入相同任务
# JingxuanAgent 会自动检测到之前的检查点，从中断处继续执行
```

检查点文件保存在 `checkpoints/` 目录下，包含完整的消息历史和子任务状态。

### 6. 工作记录 (Work Record) — 中断恢复

JingxuanAgent 会自动记录每次对话的工作目标、进度和关键发现，保存在 `work_records/` 目录。

**中断后恢复流程:**

```
第一次使用: 创建文件 test.txt → 系统自动保存工作记录
  ↓ (意外关闭 / Ctrl+C / 崩溃)
第二次启动: JingxuanAgent 读取上次工作记录 → 自动注入恢复上下文
            → 智能体知道"刚才在创建文件" → 可以直接继续
```

**查看工作记录:**

```bash
# CLI 交互模式
.work

# 输出示例:
{
  "hasPreviousRecord": true,
  "currentGoal": "帮我创建文件 test.txt",
  "keyFindings": 2,
  "pendingTasks": 1,
  ...
}

=== 工作记录恢复 ===
上次活动: 2026-05-09T19:37:00
之前的目标: 帮我创建文件 test.txt
之前的进度: 文件已创建
之前的摘要: 成功创建了 test.txt
关键发现:
  - 用户桌面路径: C:\Users\xxx\Desktop
```

**自动保存机制:**

- 每次对话后自动更新工作记录
- 每 15 秒自动保存变更（有更新时）
- 退出时（Ctrl+C）强制保存
- 最多保留最近 30 条工作记录

**Web API:**

```bash
curl http://localhost:3000/api/work-record
# 返回工作记录统计和恢复上下文
```

---

## 工作模式

### 1. 交互模式（CLI）

```bash
node JingxuanAgent_Main.js
```

内置命令:
| 命令 | 作用 |
|------|------|
| `.status` | 查看系统状态 |
| `.stats` | 查看统计信息 |
| `.devices` | 查看已注册设备 |
| `.learn` | 查看学习报告 |
| `.work` | 查看工作记录和恢复状态 |
| `.help` | 帮助 |
| `.quit` / `.exit` | 退出 |

### 2. 服务模式（Web）

```bash
node JingxuanAgent_Main.js server
```

提供 REST API:
- `POST /api/chat` — 发送任务（JSON: `{ "goal": "你的指令" }`）
- `POST /api/chat/stream` — SSE 流式对话
- `POST /api/chat/tools` — 工具调用模式
- `GET /api/status` — 系统状态
- `GET /api/stats` — 统计信息
- `GET /api/work-record` — 查看工作记录和恢复上下文

### 3. 远程访问

在对话中说:

```
我要出去了 / 开启远程访问
```

JingxuanAgent 会生成一个公网链接。到外面后用浏览器访问即可继续对话。

回到电脑前说:

```
我回来了 / 关闭远程访问
```

> ⚠️ 远程访问时建议设置 `HYPERAGENT_AUTH_TOKEN` 防止未授权访问。

---

## 授权与安全

### 权限级别

| 级别 | 操作范围 | 示例 |
|------|---------|------|
| 信息 | 只读查询 | 查时间、系统信息 |
| 控制 | 文件/命令/进程 | 创建文件、运行命令 |
| 管理 | 系统配置 | 注册表、服务管理 |
| 危险 | 高风险操作 | 格式化、关机 |

**默认**: 安装即获得最高授权。只要您给出明确指令，JingxuanAgent 即可操控承载体全部功能，无需额外授权步骤。

### 手动降级（可选）

如需限制 JingxuanAgent 的权限范围:

```
取消授权                    # 取消所有权限
允许你查看系统信息          # 降级为仅 info 权限
允许你操作我的电脑          # 降级为 control 权限
```

### 安全机制

- 危险命令（shutdown、format、diskpart 等）被硬编码阻止
- 工作目录限制在用户目录下
- GUI 操作（鼠标/键盘）默认开启但可配置
- `SAFETY_LEVEL` 环境变量控制整体安全级别

---

## 功能特性

| 模块 | 说明 | 配置项 |
|------|------|--------|
| 记忆系统 | 四层记忆 + 语义搜索 | 默认开启 |
| 持续学习 | 自动吸收/分析/进化 | `CONTINUAL_LEARNING_ENABLED` |
| 认知框架 | 从经验自建认知 | `COGNITIVE_FRAMEWORK_ENABLED` |
| 本地推理 | 离线推理引擎 | `LOCAL_INFERENCE_ENABLED` |
| 思维树 | 多分支推理 | `UPGRADE_TOT` |
| 技能库 | 可复用技能 | `UPGRADE_SKILLS` |
| 对抗验证 | 防幻觉交叉检查 | `UPGRADE_ADVERSARIAL` |
| ScreenAgent | 屏幕视觉分析 | `UPGRADE_SCREEN` |
| 持久化工作流 | 可暂停恢复 | `UPGRADE_DURABLE` |
| GUI 自动化 | 桌面鼠标/键盘操作 | 需 `@ui-tars/sdk` |
| **代码 Diff (v5.0)** | unified diff 生成/应用 | 内置 |
| **LSP 集成 (v5.0)** | 诊断/补全/跳转 | 需安装对应 LSP |
| **AST 分析 (v5.0)** | 代码结构/复杂度分析 | 内置 |
| **真实 Embedding (v5.0)** | 语义搜索提升 | `EMBEDDING_*` 环境变量 |
| **检查点恢复 (v5.0)** | 任务中断续传 | `CHECKPOINT_ENABLED` |
| **工作记录 (v5.0)** | 中断后快速恢复工作状态 | 自动启用 |

---

## 故障排查

### 指令没有被执行

可能原因:
1. 你的描述被识别为"提问"而非"指令"——尽量使用"帮我做X"、"创建X"等明确措辞
2. LLM API 调用失败——检查 `.env` 中的 API Key 和 URL
3. 工具执行出错——查看控制台输出

### LLM 没有响应

```bash
# 测试 DeepSeek API
curl https://api.deepseek.com/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_KEY" \
  -d '{"model":"deepseek-v4-flash","messages":[{"role":"user","content":"hello"}]}'
```

### Embedding 未生效

启动时观察控制台输出:
- `[MemoryPipeline] 初始化完成 (XX项索引, embedding=api)` — API 模式正常
- `[MemoryPipeline] 初始化完成 (XX项索引, embedding=hybrid)` — 混合模式 (有 API 则用，否则 TF-IDF)
- `[VectorStore] Embedding built: XX/YY` — 嵌入构建成功
- 如无相关输出，说明使用内置 TF-IDF 模式

### 工作记录未恢复

启动时观察控制台输出:
- `[WorkRecord] 发现上次工作记录` — 成功找到并加载工作记录
- `[WorkRecord] 未找到历史工作记录，首次启动` — 没有上一会话的记录（首次使用或 `work_records/` 被清空）
- `[JingxuanAgent] 已加载工作记录恢复上下文` — 恢复上下文已注入到 system prompt

如果工作记录没有恢复，检查 `work_records/` 目录是否存在且有 JSON 文件。

### 检查点恢复失败

检查点文件保存在 `checkpoints/` 目录，为 JSON 格式。如遇到恢复问题:
1. 检查 `checkpoints/` 目录是否存在且有写入权限
2. 手动设置 `CHECKPOINT_ENABLED=true`
3. 查看控制台的 `[CheckpointManager]` 相关日志

### 查看日志

启动时的控制台输出包含了所有初始化信息和错误日志。
