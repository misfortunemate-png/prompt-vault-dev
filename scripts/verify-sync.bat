@echo off
rem pv#115 クラウド同期の検査（モックの Worker を使う。実クラウド・本物の秘密には触れない）
cd /d "%~dp0.."
call npm run verify:issues -- pv#115
pause
