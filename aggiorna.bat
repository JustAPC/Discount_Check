@echo off
REM Doppio clic da Esplora risorse: lancia aggiorna.ps1 senza toccare la
REM ExecutionPolicy di sistema (il bypass vale solo per questo processo).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0aggiorna.ps1"
