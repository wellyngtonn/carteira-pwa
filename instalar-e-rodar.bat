@echo off
chcp 65001 >nul
title Carteira PWA - PostgreSQL Setup

echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║     CARTEIRA PWA  -  Node.js + PostgreSQL        ║
echo  ╚══════════════════════════════════════════════════╝
echo.

:: Verifica Node.js
node -v >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
  echo  [ERRO] Node.js nao encontrado!
  echo  Baixe em: https://nodejs.org
  pause & exit /b 1
)
echo  [OK] Node.js: & node -v

:: Verifica se .env existe
IF NOT EXIST ".env" (
  echo.
  echo  [AVISO] Arquivo .env nao encontrado!
  echo  Crie o arquivo .env com as credenciais do PostgreSQL.
  echo  Exemplo:
  echo    DB_HOST=localhost
  echo    DB_PORT=5432
  echo    DB_NAME=carteira
  echo    DB_USER=postgres
  echo    DB_PASSWORD=sua_senha
  echo.
  pause & exit /b 1
)
echo  [OK] .env encontrado

:: Cria banco de dados se nao existir (requer psql no PATH)
psql --version >nul 2>&1
IF %ERRORLEVEL% EQU 0 (
  echo  [INFO] Tentando criar banco 'carteira' se nao existir...
  FOR /F "tokens=2 delims==" %%i IN ('findstr DB_USER .env') DO SET PG_USER=%%i
  FOR /F "tokens=2 delims==" %%i IN ('findstr DB_NAME .env') DO SET PG_DB=%%i
  psql -U %PG_USER% -c "CREATE DATABASE %PG_DB%;" 2>nul
  echo  [OK] Banco verificado
) ELSE (
  echo  [INFO] psql nao encontrado no PATH - certifique-se que o banco '%DB_NAME%' existe manualmente.
)

echo.
echo  [1/2] Instalando dependencias...
call npm install
IF %ERRORLEVEL% NEQ 0 ( echo  [ERRO] npm install falhou. & pause & exit /b 1 )

echo.
echo  [2/2] Iniciando servidor...
echo.
echo  ╔══════════════════════════════════════════════════════════╗
echo  ║  Acesse:  http://localhost:3000/carteira-pwa.html        ║
echo  ║  Parar:   Ctrl+C ou feche esta janela                    ║
echo  ╚══════════════════════════════════════════════════════════╝
echo.

start /b cmd /c "timeout /t 2 >nul && start http://localhost:3000/carteira-pwa.html"
node server.js
pause