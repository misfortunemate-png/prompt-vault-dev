@echo off
rem pv#115: 秘密（PV_VAULT_KEY・CLOUD_TOKEN）を置いた後の実 Worker 接続と鍵の確認。読み取りだけで、何も送らない
cd /d "%~dp0.."
node scripts\sync-auth-check.mjs
pause
