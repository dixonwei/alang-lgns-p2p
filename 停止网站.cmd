@echo off
chcp 65001 >nul
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8170" ^| findstr "LISTENING"') do taskkill /PID %%a /F >nul 2>&1
echo 网站服务已停止。
timeout /t 2 >nul