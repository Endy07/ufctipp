@echo off
rem UfcTipp: kézi szinkron (dupla katt). Felveszi a következő gálát, frissíti a kártyát, kiírja, mit talált.
cd /d "%~dp0.."
"C:\xampp\php\php.exe" tools\sync.php auto --force
echo.
pause
