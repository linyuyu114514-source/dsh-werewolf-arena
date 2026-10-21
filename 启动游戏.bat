@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"
title 大肥鱼狼人杀

set "PORT=8787"
if not "%~1"=="" set "PORT=%~1"

echo.
echo   ==========================================
echo      大肥鱼狼人杀
echo   ==========================================
echo.

rem ---------- 找 DeepSeek Harness 的安装目录 ----------
set "DSHHOME="
if defined WW_DSH_HOME if exist "%WW_DSH_HOME%\DeepSeek Harness.exe" set "DSHHOME=%WW_DSH_HOME%"
if not defined DSHHOME if exist "%LOCALAPPDATA%\Programs\DeepSeek Harness\DeepSeek Harness.exe" set "DSHHOME=%LOCALAPPDATA%\Programs\DeepSeek Harness"
if not defined DSHHOME if exist "%ProgramFiles%\DeepSeek Harness\DeepSeek Harness.exe" set "DSHHOME=%ProgramFiles%\DeepSeek Harness"
if not defined DSHHOME for %%d in (C D E F G) do (
  if not defined DSHHOME if exist "%%d:\DeepSeek Harness\DeepSeek Harness.exe" set "DSHHOME=%%d:\DeepSeek Harness"
)
if defined DSHHOME echo   DeepSeek Harness: !DSHHOME!

rem ---------- 找 Node：随包 node -^> 系统 node -^> Harness 自带的 Electron ----------
set "NODE="
if defined WW_NODE if exist "%WW_NODE%" set "NODE=%WW_NODE%"
if not defined NODE if defined DSHHOME if exist "!DSHHOME!\resources\runtime\primary-runtime\dependencies\node\bin\node.exe" set "NODE=!DSHHOME!\resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
if not defined NODE for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE set "NODE=%%i"

set "ELECTRON=0"
if not defined NODE if defined DSHHOME if exist "!DSHHOME!\DeepSeek Harness.exe" (
  set "NODE=!DSHHOME!\DeepSeek Harness.exe"
  set "ELECTRON=1"
)

if not defined NODE (
  echo   [x] 找不到 Node.js，也找不到 DeepSeek Harness。
  echo       请先安装 DeepSeek Harness 桌面版，或者装一个 Node.js。
  echo.
  pause
  exit /b 1
)

rem ---------- 端口已经有人用了？ ----------
netstat -ano | findstr /c:":%PORT% " | findstr /i "LISTENING" >nul
if not errorlevel 1 (
  echo   [!] 端口 %PORT% 已经在用了，游戏可能已经开着。
  echo       直接帮你打开浏览器。
  echo.
  start "" "http://127.0.0.1:%PORT%/"
  ping -n 4 127.0.0.1 >nul
  exit /b 0
)

set "WW_PORT=%PORT%"

echo   服务地址：http://127.0.0.1:%PORT%/
echo   浏览器会自动打开，关掉这个窗口就停止。
echo.

rem ---------- 等两秒再开浏览器，免得它比服务先到 ----------
if not "%WW_NO_OPEN%"=="1" start "" /min cmd /c "ping -n 3 127.0.0.1 >nul & start http://127.0.0.1:%PORT%/"

if "%ELECTRON%"=="1" (
  set "ELECTRON_RUN_AS_NODE=1"
  "!NODE!" "server\index.mjs"
) else (
  "!NODE!" "server\index.mjs"
)

echo.
echo   服务已停止。
pause
