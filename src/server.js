'use strict';
const [maior, menor] = process.versions.node.split('.').map(Number);
if (maior < 22 || (maior === 22 && menor < 13)) {
  console.error(`\nSeu Node.js é a versão ${process.versions.node}. Este sistema precisa da 22.13 ou mais nova.`);
  console.error('Baixe a versão LTS em https://nodejs.org, instale e rode de novo.\n');
  process.exit(1);
}
const { abrir } = require('./db');
const { iniciar } = require('./app');

const porta = Number(process.env.PORT || 3000);
const db = abrir();
iniciar(db, porta).then(() => {
  console.log(`DIXI-MVP rodando em http://localhost:${porta}`);
  console.log(`  Painel do RH ........ http://localhost:${porta}/`);
  console.log(`  App de ponto (REP-P)  http://localhost:${porta}/ponto.html`);
  // Abre o navegador só depois que o servidor já está ouvindo (evita "página não encontrada").
  if (process.env.DIXI_ABRIR) {
    const { exec } = require('node:child_process');
    const url = `http://localhost:${porta}/`;
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`;
    exec(cmd, () => {});
  }
}).catch((e) => { console.error('Falha ao iniciar:', e.message); process.exit(1); });

process.on('uncaughtException', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`\nA porta ${porta} já está em uso. Feche a outra janela do sistema (ou reinicie o PC) e tente de novo.\n`);
  else console.error(e);
  process.exit(1);
});
