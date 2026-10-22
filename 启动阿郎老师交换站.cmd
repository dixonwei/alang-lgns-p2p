@echo off
chcp 65001 >nul
cd /d "%~dp0"
wscript.exe "%~dp0启动服务.vbs"
exit /b