@echo off
title PharmaGuard - Real-Time Pharmacy Expiry Tracking System
echo ========================================================
echo   PharmaGuard Real-Time Pharmacy Expiry Management
echo ========================================================
echo Starting server on http://localhost:3000...
echo.

where agy-node >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    agy-node server.js
) else (
    where node >nul 2>&1
    if %ERRORLEVEL% EQU 0 (
        node server.js
    ) else (
        echo [ERROR] Neither 'agy-node' nor 'node' was found in your PATH.
        echo Please ensure Node.js is installed.
        pause
    )
)
