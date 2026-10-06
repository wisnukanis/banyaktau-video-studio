@echo off
title BanyakTau - Video Studio Scheduler
cd /d "%~dp0"
echo ====================================================
echo  Menjalankan Scheduler Otomasi Video Asal (FB Dunialuas)
echo ====================================================
echo Jadwal aktif: 08:00, 13:00, 19:00 WIB
echo Jangan tutup jendela ini agar jadwal tetap berjalan.
echo.
node src/scheduler.js
pause
