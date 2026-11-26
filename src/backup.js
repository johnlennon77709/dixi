'use strict';
// Backup consistente do banco (VACUUM INTO funciona com o sistema rodando).
// Uso: node src/backup.js [pasta]   — mantém os últimos DIXI_BACKUP_DIAS (padrão 30).
const fs = require('node:fs');
const path = require('node:path');
const { abrir } = require('./db');

const pasta = process.argv[2] || path.join(__dirname, '..', 'data', 'backups');
fs.mkdirSync(pasta, { recursive: true, mode: 0o750 });
const carimbo = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const destino = path.join(pasta, `dixi-${carimbo}.db`);
const db = abrir();
db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
db.close();
const manter = Number(process.env.DIXI_BACKUP_DIAS || 30);
const antigos = fs.readdirSync(pasta).filter((f) => /^dixi-.*\.db$/.test(f)).sort().reverse().slice(manter);
for (const f of antigos) fs.unlinkSync(path.join(pasta, f));
console.log(`Backup criado: ${destino} (${(fs.statSync(destino).size / 1024).toFixed(0)} KB). Removidos ${antigos.length} antigos.`);
