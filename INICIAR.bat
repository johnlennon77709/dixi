@echo off
chcp 65001 >nul
title Sistema de Ponto DIXI-MVP
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  O Node.js nao esta instalado.
  echo  Baixe a versao LTS em https://nodejs.org , instale e abra este arquivo de novo.
  echo.
  start https://nodejs.org
  pause
  exit /b
)

if not exist node_modules (
  echo Instalando dependencias, aguarde...
  call npm install
)

if not exist data\dixi.db (
  echo Criando empresa de demonstracao...
  call npm run seed
)

echo.
echo  ==========================================================
echo   Sistema rodando! NAO feche esta janela.
echo   Painel do RH:  http://localhost:3000   (admin@demo.com / demo123)
echo   Bater ponto:   http://localhost:3000/ponto.html?token=demo-quiosque   (PIN 1234)
echo   O navegador abre sozinho. Se nao abrir, digite o endereco acima.
echo  ==========================================================
echo.
set DIXI_ABRIR=1
call npm start
pause
