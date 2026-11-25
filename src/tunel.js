'use strict';
// Túnel HTTPS opcional (Cloudflare Quick Tunnel, gratuito e sem conta).
// Gera um endereço https://<aleatório>.trycloudflare.com com certificado VÁLIDO, que é o que
// os celulares exigem para instalar o PWA e usar o modo offline. Funciona também no 4G.
// Ative com DIXI_TUNEL=1 (o INICIAR-COM-INTERNET.bat faz isso e baixa o cloudflared).
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

let url = null;
const ouvintes = [];

function binario() {
  const raiz = path.join(__dirname, '..');
  const opcoes = [process.env.DIXI_CLOUDFLARED, path.join(raiz, 'cloudflared.exe'), path.join(raiz, 'cloudflared')].filter(Boolean);
  return opcoes.find((p) => fs.existsSync(p)) || 'cloudflared';
}

function iniciar(porta) {
  const proc = spawn(binario(), ['tunnel', '--no-autoupdate', '--url', `http://localhost:${porta}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  const ler = (buf) => {
    const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !url) { url = m[0]; ouvintes.splice(0).forEach((f) => f(url)); }
  };
  proc.stdout.on('data', ler); proc.stderr.on('data', ler);
  proc.on('error', (e) => console.error(`\nNão foi possível iniciar o túnel (cloudflared): ${e.message}\nUse o INICIAR-COM-INTERNET.bat, que baixa o cloudflared automaticamente.\n`));
  proc.on('exit', () => { url = null; });
  process.on('exit', () => proc.kill());
  return proc;
}

const quandoPronto = (f) => (url ? f(url) : ouvintes.push(f));
const endereco = () => url;

module.exports = { iniciar, quandoPronto, endereco };
