# JingxuanAgent — Open-Source AI Agent Framework

<div align="center">

[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](package.json)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](https://github.com/13717930620-alt/jingxuanagent/pulls)
[![GitHub stars](https://img.shields.io/github/stars/13717930620-alt/jingxuanagent?style=social)](https://github.com/13717930620-alt/jingxuanagent)

</div>

> **I am a Chinese lawyer who loves AI. I don't know how to code.**
>
> I used publicly available AI coding assistants to translate my vision of what a true intelligent agent should be into a working framework.
>
> This is a skeleton — a foundation. I am opening it up so that everyone who shares this vision can come together and make it real.
>
> **Everyone is welcome.**

---

## What Is This?

JingxuanAgent is an open-source framework that gives your computer its own AI agent. Tell it what you want, and it makes it happen.

```
You say: "Organize my desktop files by type into folders"
→ JingxuanAgent: Scans desktop → Identifies file types → Creates folders → Moves files → Reports results
```

It works with DeepSeek, GLM, Qwen, MiniMax, or entirely offline using its built-in engine.

---

## Quick Start

```bash
npm install
cp .env.example .env     # Optional — built-in model works without it
node JingxuanAgent_Main.js
```

Then just talk to it: "Check my CPU usage" or "Create a file called test.txt"

---

## Features

| Feature | Description |
|---------|-------------|
| **File Operations** | Read, write, edit, search, copy, move, delete |
| **Command Execution** | cmd / PowerShell with safety restrictions |
| **System Control** | Process manager, clipboard, notifications, power management |
| **Browser Automation** | Puppeteer-powered |
| **Desktop GUI** | Mouse, keyboard, screenshot |
| **Code Tools** | Diff/Apply patches, AST analysis, LSP intelligence |
| **Memory System** | 4-layer memory (L0→L1→L2→L3) + semantic search |
| **Self-Learning** | Continuously learns user habits and system patterns |
| **Multi-LLM** | DeepSeek / GLM / Qwen / MiniMax / Built-in engine |
| **Remote Access** | Public tunnel — use it from anywhere |
| **Security** | 5-level authorization, dangerous operations require confirmation |
| **MCP Protocol** | Model Context Protocol compatible |

---

## Project Structure

```
JingxuanAgent/
├── JingxuanAgent_Main.js          # Entry point
├── JingxuanAgent_Config.js        # Configuration
├── JingxuanAgent_Learning.js      # Self-learning system
├── JingxuanAgent_Core/            # Core system
│   ├── cc_mode/                   # Query engine + tool system
│   ├── cognitive_core/            # Cognitive framework
│   ├── llm_adapter/               # 5 LLM adapters
│   └── infra/                     # Infrastructure
├── JingxuanAgent_Implementation/  # Implementation layer
│   ├── conversation/              # Conversation engine
│   ├── orchestrator/              # Task orchestration
│   ├── atomic_executor/           # Tool executor
│   ├── memory_engine/             # Memory + vector search
│   └── device_abstraction/        # Device abstraction + security
├── services/                      # Web search, config, tunnel
├── extensions/                    # Productivity extensions
├── docs/                          # Documentation
├── 安装程序.bat                   # Windows setup script
├── 启动命令行.bat                 # CLI mode launcher
├── 启动网页版.bat                 # Web UI launcher
└── .github/                       # Issue templates
```

---

## Why I Built This

I am a lawyer. I spend my days reading, writing, and reasoning with words — not code.

But I have always believed that a truly intelligent machine should be more than a chatbot. It should be able to **see** your computer, **understand** what you need, **plan** how to do it, and **execute** the task with its own hands (or rather, its own tools). It should learn from experience, remember what it has learned, and grow smarter over time.

I couldn't write a single line of code to make this real. So I used AI coding assistants — the same tools available to anyone — to describe my vision, piece by piece, and let them help me build it.

This is not a finished product. This is a **framework** — a skeleton — that captures my understanding of what an intelligent agent should be. The muscles, the nerves, the skin — those are for the community to add.

---

## How You Can Help

I don't know how to code, so there is a lot of room for improvement:

- Fix bugs and optimize the code
- Add new tools and capabilities
- Improve the built-in AI engine
- Write tests so we know it works
- Port to more platforms
- Improve documentation
- Suggest new architectural ideas
- Anything you think would make it better

This project is not "mine." It belongs to everyone who wants to see intelligent agents become real.

**Open an Issue. Submit a PR. Fork it. Share it. Build on it.**

---

## The Vision

A true intelligent agent should:

1. **Understand** natural language, not just commands
2. **Plan** complex tasks by breaking them down
3. **Execute** actions safely on any device
4. **Remember** everything it has experienced
5. **Learn** from successes and failures
6. **Evolve** its own capabilities over time
7. **Collaborate** with humans and other agents

JingxuanAgent is my attempt to build towards this vision. But no single person can finish it — especially not one who cannot code.

**That is why I need you.**

---

## License

MIT License — use it, modify it, share it. Free for everyone, forever.

---

> **A Chinese lawyer who cannot code built the skeleton.**
> **Now the world can breathe life into it.**
