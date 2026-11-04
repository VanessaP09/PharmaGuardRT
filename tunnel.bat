@echo off
title PharmaGuard - Public Cloudflare Tunnel
echo ========================================================
echo   Launching Public Tunnel for PharmaGuard
echo ========================================================
echo Routing traffic from http://localhost:3000 to public internet...
echo.

"C:\Users\User\AppData\Local\Programs\cloudflared\cloudflared.exe" tunnel --url http://localhost:3000
pause
