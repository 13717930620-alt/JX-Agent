@echo off
chcp 65001 >nul
title JingxuanAgent v5.2 CLI 命令行模式
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
echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║     🧠 JingxuanAgent v5.2 Ultimate                ║
echo  ║     命令行交互模式                               ║
echo  ║     正在启动...                                 ║
echo  ╚══════════════════════════════════════════════════╝
echo.
echo  💡 输入 .help 查看命令，.quit 退出
echo.

node JingxuanAgent_Main.js interactive
pause
