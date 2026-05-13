@echo off
chcp 65001 >nul
title JingxuanAgent 安装程序 v5.2

setlocal EnableDelayedExpansion

echo.
echo  ╔═══════════════════════════════════════════════════════════╗
echo  ║                                                         ║
echo  ║     🧠 JingxuanAgent v5.0 Ultimate — 超级智能体            ║
echo  ║     安装程序                                            ║
echo  ║                                                         ║
echo  ║     ✨ 多模型路由 | 记忆增强 | GUI控制 | 多智能体      ║
echo  ║     ✨ 代码工具链 | 检查点恢复 | MCP协议                ║
echo  ╚═══════════════════════════════════════════════════════════╝
echo.

:: ============================================
:: 获取安装目录
:: ============================================
set "DEFAULT_DIR=%USERPROFILE%\JingxuanAgent"
set /p INSTALL_DIR="安装目录 [默认: %DEFAULT_DIR%]: "
if "!INSTALL_DIR!"=="" set "INSTALL_DIR=%DEFAULT_DIR%"

:: 检查是否存在已安装的版本
if exist "!INSTALL_DIR!\.env" (
    echo ⚠️  检测到已有安装
    set /p OVERWRITE="是否覆盖安装？(Y/N): "
    if /i not "!OVERWRITE!"=="Y" (
        echo.
        echo 安装已取消。
        pause
        exit /b
    )
)

echo.
echo  📁 目标目录: !INSTALL_DIR!
echo.

:: ============================================
:: [1/5] 检查 Node.js
:: ============================================
echo [1/5] 检查运行环境...

node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ 未检测到 Node.js
    echo.
    echo 请先安装 Node.js：
    echo   1. 访问 https://nodejs.org/
    echo   2. 下载 LTS 版本（18.x 或更高）
    echo   3. 运行安装程序，全部默认选项
    echo   4. 安装完成后重启此安装程序
    echo.
    pause
    start https://nodejs.org/
    exit /b 1
)
for /f "delims=" %%v in ('node --version') do set "NODE_VER=%%v"
echo ✅ Node.js: !NODE_VER!

:: 检查 npm
npm --version >nul 2>&1
if errorlevel 1 (
    echo ❌ 未检测到 npm
    pause
    exit /b 1
)
for /f "delims=" %%v in ('npm --version') do set "NPM_VER=%%v"
echo ✅ npm: !NPM_VER!

echo.

:: ============================================
:: [2/5] 复制程序文件
:: ============================================
echo [2/5] 复制程序文件...

set "SOURCE_DIR=%~dp0"
if not exist "!SOURCE_DIR!" (
    echo ❌ 未找到程序文件
    echo    安装程序可能已损坏
    pause
    exit /b 1
)

:: 创建安装目录
if not exist "!INSTALL_DIR!" mkdir "!INSTALL_DIR!"

:: 复制文件（排除不需要的目录）
xcopy /E /Y /Q "!SOURCE_DIR!" "!INSTALL_DIR!\" >nul 2>&1
if errorlevel 1 (
    echo ❌ 文件复制失败
    pause
    exit /b 1
)
echo ✅ 程序文件复制完成

echo.

:: ============================================
:: [3/5] 安装依赖包
:: ============================================
echo [3/5] 安装依赖包...

cd /d "!INSTALL_DIR!"
if exist "node_modules" (
    echo   检测到已有依赖，跳过安装
    echo   如需重新安装，请删除 node_modules 目录后重试
) else (
    echo   正在安装核心依赖（含 UI-TARS GUI、MCP 工具等）...
    call npm install 2>&1
    if errorlevel 1 (
        echo.
        echo ⚠️  部分依赖安装失败，尝试重试...
        call npm install --legacy-peer-deps 2>&1
        if errorlevel 1 (
            echo ❌ 依赖安装失败，请检查网络连接
            pause
            exit /b 1
        )
    )
)
echo ✅ 依赖安装完成

echo.

:: ============================================
:: [4/5] 配置 API
:: ============================================
echo [4/5] 配置 API...
echo.

if not exist "!INSTALL_DIR!\.env" (
    echo 请选择 AI 模型服务商（用于智能对话和任务执行）：
    echo.
    echo   1. DeepSeek（推荐 — 速度快，支持工具调用）
    echo   2. Anthropic Claude（强大的推理能力）
    echo   3. GLM 智谱（中文优化）
    echo   4. Qwen 通义千问（低成本）
    echo   5. MiniMax（创意模型）
    echo.
    set /p MODEL_CHOICE="请选择 [1]: "
    if "!MODEL_CHOICE!"=="" set "MODEL_CHOICE=1"

    set "ADAPTER=deepseek"
    set "BASE_URL=https://api.deepseek.com"
    set "MODEL=deepseek-v4-flash"
    set "API_KEY="

    if "!MODEL_CHOICE!"=="1" (
        set "ADAPTER=deepseek"
        set "BASE_URL=https://api.deepseek.com"
        set "MODEL=deepseek-v4-flash"
        set /p API_KEY="DeepSeek API Key: "
    ) else if "!MODEL_CHOICE!"=="2" (
        set "ADAPTER=anthropic"
        set "BASE_URL=https://api.anthropic.com"
        set "MODEL=claude-sonnet-4-20250514"
        set /p API_KEY="Anthropic API Key: "
    ) else if "!MODEL_CHOICE!"=="3" (
        set "ADAPTER=glm"
        set "BASE_URL=https://open.bigmodel.cn/api/paas/v4"
        set "MODEL=glm-4.7-flash"
        set /p API_KEY="GLM API Key: "
    ) else if "!MODEL_CHOICE!"=="4" (
        set "ADAPTER=qwen"
        set "BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1"
        set "MODEL=qwen-plus"
        set /p API_KEY="Qwen API Key: "
    ) else if "!MODEL_CHOICE!"=="5" (
        set "ADAPTER=minimax"
        set "BASE_URL=https://api.minimax.chat/v1"
        set "MODEL=MiniMax-Text-01"
        set /p API_KEY="MiniMax API Key: "
    ) else (
        echo 无效选择，使用 DeepSeek 默认配置
        set /p API_KEY="DeepSeek API Key: "
    )

    echo.
    echo 是否启用额外功能？（推荐全部启用）
    echo.
    echo   当前可用的增强功能:
    echo     🧠 记忆增强 — 记住之前的对话内容（跨会话记忆）
    echo     🖥️ GUI控制 — 通过截图控制桌面应用（UI-TARS）
    echo     🔌 MCP工具 — 文件/Shell/浏览器等系统工具
    echo     🤖 多智能体 — 5个角色协作完成任务
    echo     💻 代码工具 — Diff/Apply补丁、LSP、AST分析
    echo.
    set /p ENHANCED="启用全部增强功能？(Y/n) [Y]: "
    if /i "!ENHANCED!"=="" set "ENHANCED=Y"

    if /i "!ENHANCED!"=="Y" (
        set "MEMORY_ENABLED=true"
        set "GUI_ENABLED=true"
        set "MULTI_AGENT=true"
        set "STATE_MACHINE=true"
    ) else (
        set "MEMORY_ENABLED=true"
        set "GUI_ENABLED=false"
        set "MULTI_AGENT=false"
        set "STATE_MACHINE=true"
    )

    :: 写入 .env 配置
    (
        echo # JingxuanAgent v5.0 Ultimate 环境变量配置
        echo # ============================================
        echo LLM_ADAPTER=!ADAPTER!
        echo.
        if "!ADAPTER!"=="deepseek" (
            echo DEEPSEEK_API_KEY=!API_KEY!
            echo DEEPSEEK_BASE_URL=!BASE_URL!
            echo DEEPSEEK_MODEL=!MODEL!
        ) else if "!ADAPTER!"=="anthropic" (
            echo ANTHROPIC_API_KEY=!API_KEY!
            echo ANTHROPIC_BASE_URL=!BASE_URL!
            echo ANTHROPIC_MODEL=!MODEL!
            echo LLM_ADAPTER=deepseek
            echo # 注意: Anthropic 使用 DeepSeek 适配器兼容模式
        ) else if "!ADAPTER!"=="glm" (
            echo GLM_API_KEY=!API_KEY!
            echo GLM_BASE_URL=!BASE_URL!
            echo GLM_MODEL=!MODEL!
        ) else if "!ADAPTER!"=="minimax" (
            echo MINIMAX_API_KEY=!API_KEY!
            echo MINIMAX_BASE_URL=!BASE_URL!
            echo MINIMAX_MODEL=!MODEL!
        ) else if "!ADAPTER!"=="qwen" (
            echo QWEN_API_KEY=!API_KEY!
            echo QWEN_BASE_URL=!BASE_URL!
            echo QWEN_MODEL=!MODEL!
        )
        echo.
        echo # ---- 增强功能 ----
        echo MULTI_MODEL_ENABLED=true
        echo VECTOR_STORE_ENABLED=!MEMORY_ENABLED!
        echo CROSS_SESSION_MEMORY=!MEMORY_ENABLED!
        echo KG_ENABLED=!MEMORY_ENABLED!
        echo STATE_MACHINE_ENABLED=!STATE_MACHINE!
        echo TASK_DECOMPOSITION=true
        echo CHECKPOINT_ENABLED=true
        echo MULTI_AGENT_ENABLED=!MULTI_AGENT!
        echo UI_TARS_ENABLED=!GUI_ENABLED!
        echo.
        echo # ---- 承载体配置 ----
        echo DEVICE_TYPE=pc
        echo SAFETY_LEVEL=medium
        echo STATE_COLLECT_INTERVAL=15000
        echo.
        echo # ---- Web服务 ----
        echo PORT=3000
    ) > "!INSTALL_DIR!\.env"

    echo ✅ API 配置完成
) else (
    echo ✅ 检测到已有配置，跳过
)

echo.

:: ============================================
:: [5/5] 创建快捷方式
:: ============================================
echo [5/5] 创建快捷方式...

:: 启动脚本
set "STARTUP_SCRIPT=!INSTALL_DIR!\启动网页版.bat"
(
echo @echo off
echo chcp 65001 ^>nul
echo title JingxuanAgent v5.0 Ultimate
echo cd /d "!INSTALL_DIR!"
echo.
echo cls
echo echo.
echo echo  ╔══════════════════════════════════════════════════╗
echo echo  ║     🧠 JingxuanAgent v5.0 Ultimate                ║
echo echo  ║     超级智能体 — 正在启动...                    ║
echo echo  ╚══════════════════════════════════════════════════╝
echo echo.
echo node JingxuanAgent_Main.js server
echo pause
) > "!STARTUP_SCRIPT!"

:: CLI 启动脚本
set "CLI_SCRIPT=!INSTALL_DIR!\启动命令行.bat"
(
echo @echo off
echo chcp 65001 ^>nul
echo title JingxuanAgent v5.0 CLI
echo cd /d "!INSTALL_DIR!"
echo cls
echo echo.
echo echo  ╔══════════════════════════════════════════════════╗
echo echo  ║     🧠 JingxuanAgent v5.0 Ultimate                ║
echo echo  ║     命令行模式 — 正在启动...                    ║
echo echo  ╚══════════════════════════════════════════════════╝
echo echo.
echo node JingxuanAgent_Main.js interactive
) > "!CLI_SCRIPT!"

:: 桌面快捷方式
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%USERPROFILE%\Desktop\JingxuanAgent网页版.lnk'); $s.TargetPath = '!STARTUP_SCRIPT!'; $s.WorkingDirectory = '!INSTALL_DIR!'; $s.Description = 'JingxuanAgent v5.0 Ultimate - Web界面'; $s.IconLocation = '%SystemRoot%\System32\shell32.dll,165'; $s.Save()" 2>nul

powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%USERPROFILE%\Desktop\JingxuanAgent命令行.lnk'); $s.TargetPath = '!CLI_SCRIPT!'; $s.WorkingDirectory = '!INSTALL_DIR!'; $s.Description = 'JingxuanAgent v5.0 Ultimate - CLI交互'; $s.IconLocation = '%SystemRoot%\System32\shell32.dll,166'; $s.Save()" 2>nul

echo ✅ 桌面快捷方式已创建（网页版 + 命令行）
echo.

:: ============================================
:: 安装完成
:: ============================================
echo ════════════════════════════════════════════════════════════
echo.
echo  ✅ JingxuanAgent v5.0 Ultimate 安装成功！
echo.
echo  📁 安装目录: !INSTALL_DIR!
echo.
echo  🚀 启动方式：
echo  ─────────────────────────────────────────────────────
echo  方式1: 双击桌面 "JingxuanAgent网页版" 快捷方式
echo  方式2: 双击桌面 "JingxuanAgent命令行" 快捷方式
echo  方式3: 运行 "!INSTALL_DIR!\启动网页版.bat"
echo.
echo  🌐 启动后打开浏览器访问：
echo     http://localhost:3000
echo.
echo  🧠 核心能力：
echo     ✅ 多模型路由  ✅ 记忆增强  ✅ GUI桌面控制
echo     ✅ 任务分解    ✅ 多智能体  ✅ MCP工具集成
echo     ✅ 代码工具链  ✅ 检查点恢复
echo.
echo  📖 详细使用说明：
echo     "!INSTALL_DIR!\docs\使用说明.html"
echo.
echo ════════════════════════════════════════════════════════════
echo.

set /p LAUNCH="是否立即启动网页版？(Y/N) [Y]: "
if /i "!LAUNCH!"=="" set "LAUNCH=Y"
if /i "!LAUNCH!"=="Y" (
    start "" "!STARTUP_SCRIPT!"
)

echo.
echo 感谢使用 JingxuanAgent！按任意键退出安装程序...
pause >nul
