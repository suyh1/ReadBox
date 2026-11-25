@echo off
setlocal
chcp 65001 >nul
title ReadBox
pushd "%~dp0" || (
    echo 无法进入 ReadBox 项目目录。
    pause
    exit /b 1
)

where node.exe >nul 2>&1 || goto :need_node
where npm.cmd >nul 2>&1 || goto :need_node
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major === 24 && minor >= 12 ? 0 : 1)" || goto :need_node

for %%T in (electron vite vue-tsc) do if not exist "node_modules\.bin\%%T.cmd" goto :install
goto :launch

:install
echo 正在安装项目依赖，首次运行可能需要几分钟……
call npm.cmd ci --include=dev
if errorlevel 1 goto :failed

:launch
echo 正在从源码构建并打开 ReadBox……
set "ELECTRON_RUN_AS_NODE="
call npm.cmd run desktop
if errorlevel 1 goto :failed
popd
exit /b 0

:need_node
echo 请安装带 npm 的 Node.js 24（24.12 或更高的 24.x 版本），然后重新双击此脚本。
goto :error

:failed
echo ReadBox 启动失败，请查看上方输出。

:error
popd
pause
exit /b 1
