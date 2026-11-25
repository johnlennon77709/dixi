'use strict';
// Exportação para folha de pagamento (seção 7.1 item 6 do REA): CSV genérico, TXT de
// largura fixa no estilo dos importadores de folha (Domínio, Alterdata, Totvs, Senior —
// os códigos de evento/rubrica são configuráveis porque cada escritório usa os seus) e
// XML simplificado de rubricas no formato do evento eSocial S-1200 (opcional).
const T = require('./tempo');

const RUBRICAS_PADRAO = {
  he50: '0150', he100: '0200', adicionalNoturno: '0025', faltas: '0040',
  dsrHe: '0155', intervaloSuprimido: '0160', interjornada: '0165',
};

function linhasFolha(espelhos) {
  return espelhos.map((e) => {
    const t = e.totais;
    return {
      matricula: e.funcionario.matricula || String(e.funcionario.id), cpf: e.funcionario.cpf, nome: e.funcionario.nome,
      he50: t.hePagas50, he100: t.hePagas100, adicionalNoturno: t.noturnoReduzido, faltas: t.faltasDescontadas,
      dsrHe: t.dsrReflexo, intervaloSuprimido: t.intervaloSuprimido, interjornada: t.interjornadaViolada,
      bancoSaldo: t.bancoSaldo,
    };
  });
}

function csv(espelhos) {
  const cab = ['matricula', 'cpf', 'nome', 'he50', 'he100', 'adicional_noturno', 'faltas', 'dsr_he', 'intervalo_suprimido', 'interjornada', 'banco_saldo'];
  const rows = linhasFolha(espelhos).map((l) => [l.matricula, l.cpf, `"${l.nome.replace(/"/g, '""')}"`,
    T.fmt(l.he50), T.fmt(l.he100), T.fmt(l.adicionalNoturno), T.fmt(l.faltas), T.fmt(l.dsrHe),
    T.fmt(l.intervaloSuprimido), T.fmt(l.interjornada), T.fmt(l.bancoSaldo)].join(';'));
  return [cab.join(';'), ...rows].join('\r\n') + '\r\n';
}

// TXT largura fixa: matrícula(10) competência AAAAMM(6) rubrica(4) horas HHHMM(5)
function txtFolha(espelhos, competencia, rubricas = RUBRICAS_PADRAO) {
  const out = [];
  for (const l of linhasFolha(espelhos)) {
    for (const [k, cod] of Object.entries(rubricas)) {
      const min = l[k]; if (!min) continue;
      const hhhmm = String(Math.floor(min / 60)).padStart(3, '0') + String(min % 60).padStart(2, '0');
      out.push(String(l.matricula).padStart(10, '0') + competencia.replace('-', '') + cod + hhhmm);
    }
  }
  return out.join('\r\n') + '\r\n';
}

// eSocial S-1200 (simplificado): apenas os itens de remuneração referentes à jornada,
// em quantidade de horas — o valor é calculado pela folha.
function s1200(espelhos, empresa, competencia, rubricas = RUBRICAS_PADRAO) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const evts = linhasFolha(espelhos).map((l, i) => {
    const itens = Object.entries(rubricas).filter(([k]) => l[k] > 0).map(([k, cod]) =>
      `        <itensRemun><codRubr>${cod}</codRubr><ideTabRubr>PONTO</ideTabRubr><qtdRubr>${(l[k] / 60).toFixed(2)}</qtdRubr></itensRemun>`).join('\n');
    return `  <evtRemun Id="ID1${empresa.cnpj.replace(/\D/g, '').padStart(14, '0')}${competencia.replace('-', '')}${String(i + 1).padStart(5, '0')}">
    <ideEvento><indRetif>1</indRetif><indApuracao>1</indApuracao><perApur>${competencia}</perApur></ideEvento>
    <ideEmpregador><tpInsc>1</tpInsc><nrInsc>${empresa.cnpj.replace(/\D/g, '').slice(0, 8)}</nrInsc></ideEmpregador>
    <ideTrabalhador><cpfTrab>${l.cpf.replace(/\D/g, '')}</cpfTrab></ideTrabalhador>
    <dmDev><ideDmDev>PONTO${competencia.replace('-', '')}</ideDmDev><codCateg>101</codCateg>
      <infoPerApur><ideEstabLot><tpInsc>1</tpInsc><nrInsc>${empresa.cnpj.replace(/\D/g, '')}</nrInsc><codLotacao>PADRAO</codLotacao>
      <remunPerApur><matricula>${esc(l.matricula)}</matricula>
${itens}
      </remunPerApur></ideEstabLot></infoPerApur>
    </dmDev>
  </evtRemun>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!-- Rascunho S-1200 gerado pelo ponto: conferir na folha antes de transmitir -->\n<eSocial xmlns="http://www.esocial.gov.br/schema/evt/evtRemun/v_S_01_02_00">\n${evts.join('\n')}\n</eSocial>\n`;
}

module.exports = { csv, txtFolha, s1200, RUBRICAS_PADRAO };
