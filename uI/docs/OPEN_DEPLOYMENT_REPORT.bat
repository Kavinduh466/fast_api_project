@echo off
REM Opens the deployment report in your default browser — use Print > Save as PDF
cd /d "%~dp0"
start "" "%~dp0DEPLOYMENT_REPORT.html"
