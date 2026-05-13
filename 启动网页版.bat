@echo off
chcp 65001 >nul
title JX-Agent v5.2 网页版
cd /d "%~dp0"

if not exist "node_modules" (
    echo 正在安装依赖...
    call npm install
    if errorlevel 1 (
        echo ❌ 依赖安装失败，请检查网络连接后重试
        pause
        exit /b 1
    )
)

cls
echo  ╔══════════════════════════════════════════╗
echo  ║     JX-Agent v5.2 网页版               ║
echo  ╚══════════════════════════════════════════╝
echo.

:: 检查环境变量
if not "%ANTHROPIC_AUTH_TOKEN%"=="" (
    echo  [✓] API Key 已设置 (ANTHROPIC_AUTH_TOKEN)
) else if not "%DEEPSEEK_API_KEY%"=="" (
    echo  [✓] API Key 已设置 (DEEPSEEK_API_KEY)
) else (
    echo  [!] 警告: 未检测到 API Key
    echo      启动后 LLM 将使用 mock 模式
)
echo.

if not "%ANTHROPIC_BASE_URL%"=="" (
    echo  [→] API 地址: %ANTHROPIC_BASE_URL%
) else if not "%DEEPSEEK_BASE_URL%"=="" (
    echo  [→] API 地址: %DEEPSEEK_BASE_URL%
) else (
    echo  [→] API 地址: https://api.deepseek.com (默认)
)
echo.
echo  🌐 启动后打开浏览器访问 http://localhost:3000
echo  📋 按 Ctrl+C 停止服务器
echo.

node JX-Agent_Main.js server
pause
