@echo off
chcp 65001 >nul
title Sistema de Ponto DIXI-MVP (com endereco na internet)
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  O Node.js nao esta instalado. Baixe a versao LTS em https://nodejs.org e abra este arquivo de novo.
  start https://nodejs.org
  pause
  exit /b
)

echo.
echo  ATENCAO: este modo cria um endereco https publico (trycloudflare.com) para o sistema.
echo  Qualquer pessoa com o endereco consegue ver a tela de login. Crie sua propria conta
echo  com senha forte ("Criar empresa"); a conta de demonstracao fica bloqueada por la.
echo.
pause

if not exist cloudflared.exe (
  echo Baixando o cloudflared da Cloudflare, aguarde...
  curl -L -o cloudflared.exe https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
)
if not exist node_modules (
  echo Instalando dependencias, aguarde...
  call npm install
)
if not exist data\dixi.db (
  echo Criando empresa de demonstracao...
  call npm run seed
)
set DIXI_TUNEL=1
set DIXI_ABRIR=1
call npm start
pause
