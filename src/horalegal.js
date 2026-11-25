'use strict';
// Sincronização com a Hora Legal Brasileira (Observatório Nacional / NTP.br).
// Cliente SNTP mínimo (RFC 4330) via UDP 123. Se a rede bloquear, usa o relógio do
// sistema e registra o fato (o offset fica em 0 e "fonte" = 'sistema').
const dgram = require('node:dgram');

const SERVIDORES = ['a.st1.ntp.br', 'b.st1.ntp.br', 'c.st1.ntp.br', 'a.ntp.br'];
const NTP_EPOCH = 2208988800; // segundos entre 1900 e 1970

let estado = { offsetMs: 0, fonte: 'sistema', servidor: null, sincronizadoEm: null, erro: null };

function consultar(servidor, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    const msg = Buffer.alloc(48); msg[0] = 0x1b; // LI=0, VN=3, Mode=3 (cliente)
    const t1 = Date.now();
    const timer = setTimeout(() => { sock.close(); reject(new Error('timeout')); }, timeoutMs);
    sock.once('message', (buf) => {
      clearTimeout(timer); const t4 = Date.now(); sock.close();
      const ler = (off) => (buf.readUInt32BE(off) - NTP_EPOCH) * 1000 + (buf.readUInt32BE(off + 4) * 1000) / 2 ** 32;
      const t2 = ler(32); const t3 = ler(40);
      resolve(((t2 - t1) + (t3 - t4)) / 2);
    });
    sock.once('error', (e) => { clearTimeout(timer); sock.close(); reject(e); });
    sock.send(msg, 123, servidor);
  });
}

async function sincronizar() {
  for (const s of SERVIDORES) {
    try {
      const offsetMs = await consultar(s);
      estado = { offsetMs, fonte: 'ntp', servidor: s, sincronizadoEm: new Date().toISOString(), erro: null };
      return estado;
    } catch (e) { estado.erro = `${s}: ${e.message}`; }
  }
  estado = { ...estado, offsetMs: 0, fonte: 'sistema', servidor: null, sincronizadoEm: new Date().toISOString() };
  return estado;
}

const agora = () => new Date(Date.now() + estado.offsetMs);
const status = () => ({ ...estado });

module.exports = { sincronizar, agora, status };
