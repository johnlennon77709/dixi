'use strict';
// Banco multi-tenant (seção 7.1 item 1 do REA).
// Tabelas: empresas, estabelecimentos, funcionarios, escalas, marcacoes (append-only,
// NSR sequencial por REP, hash encadeado), ajustes (tratamento separado da marcação
// original), dispositivos.
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

function abrir(arquivo) {
  const file = arquivo || process.env.DIXI_DB || path.join(__dirname, '..', 'data', 'dixi.db');
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  migrar(db);
  return db;
}

function migrar(db) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS empresas (
    id INTEGER PRIMARY KEY,
    cnpj TEXT NOT NULL UNIQUE,
    razao_social TEXT NOT NULL,
    usa_banco_horas INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    email TEXT NOT NULL UNIQUE,
    senha_hash TEXT NOT NULL,
    nome TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS estabelecimentos (
    id INTEGER PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    nome TEXT NOT NULL,
    cnpj_cei TEXT,
    endereco TEXT,
    latitude REAL, longitude REAL,
    raio_metros INTEGER NOT NULL DEFAULT 200,
    uf TEXT NOT NULL DEFAULT 'PR'
  );
  -- tipo: 'fixa' | '12x36' | 'flexivel'
  -- fixa: dias = JSON {"1":{"entrada":"08:00","saida":"17:00","intervalo":60}, ...} (0=domingo)
  -- 12x36: inicio_ciclo (data de um dia trabalhado), entrada, horas 12, intervalo
  -- flexivel: carga_minutos por dia útil (seg-sex por padrão), intervalo
  CREATE TABLE IF NOT EXISTS escalas (
    id INTEGER PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    nome TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('fixa','12x36','flexivel')),
    config TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS funcionarios (
    id INTEGER PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    estabelecimento_id INTEGER REFERENCES estabelecimentos(id),
    escala_id INTEGER REFERENCES escalas(id),
    nome TEXT NOT NULL,
    cpf TEXT NOT NULL,
    pis TEXT,
    matricula TEXT,
    pin_hash TEXT,
    face_descritor TEXT,           -- embedding facial (vetor), nunca a foto bruta (LGPD)
    consentimento_biometria TEXT,  -- data/hora do aceite do termo de biometria
    admissao TEXT,
    ativo INTEGER NOT NULL DEFAULT 1,
    UNIQUE (empresa_id, cpf)
  );
  CREATE TABLE IF NOT EXISTS dispositivos (
    id INTEGER PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    estabelecimento_id INTEGER REFERENCES estabelecimentos(id),
    nome TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('app','quiosque','web')),
    token TEXT NOT NULL UNIQUE,
    numero_coletor INTEGER NOT NULL,
    ultimo_contato TEXT
  );
  -- REP-P: NSR sequencial por REP (aqui o REP-P é a empresa no servidor).
  CREATE TABLE IF NOT EXISTS rep_sequencia (
    empresa_id INTEGER PRIMARY KEY REFERENCES empresas(id),
    ultimo_nsr INTEGER NOT NULL DEFAULT 0,
    ultimo_hash TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS marcacoes (
    id INTEGER PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    funcionario_id INTEGER NOT NULL REFERENCES funcionarios(id),
    dispositivo_id INTEGER REFERENCES dispositivos(id),
    nsr INTEGER NOT NULL,
    data_hora TEXT NOT NULL,         -- momento da marcação (ISO com fuso -03:00)
    data_hora_gravacao TEXT NOT NULL,-- momento em que chegou ao REP-P
    online INTEGER NOT NULL,         -- 1 online, 0 offline (sincronizada depois)
    latitude REAL, longitude REAL, precisao REAL,
    metodo TEXT NOT NULL,            -- facial | pin | web
    foto_hash TEXT,                  -- hash SHA-256 da foto de evidência
    id_local TEXT,                   -- id gerado offline no aparelho (idempotência)
    hash TEXT NOT NULL,              -- SHA-256 encadeado (registro + hash anterior)
    hash_anterior TEXT NOT NULL,
    UNIQUE (empresa_id, nsr),
    UNIQUE (empresa_id, id_local)
  );
  CREATE TRIGGER IF NOT EXISTS marcacoes_sem_update BEFORE UPDATE ON marcacoes
    BEGIN SELECT RAISE(ABORT, 'marcacoes sao imutaveis (Portaria 671)'); END;
  CREATE TRIGGER IF NOT EXISTS marcacoes_sem_delete BEFORE DELETE ON marcacoes
    BEGIN SELECT RAISE(ABORT, 'marcacoes sao imutaveis (Portaria 671)'); END;
  -- Tratamento: inclusão/desconsideração de marcações e abonos, sem tocar na original.
  CREATE TABLE IF NOT EXISTS ajustes (
    id INTEGER PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    funcionario_id INTEGER NOT NULL REFERENCES funcionarios(id),
    tipo TEXT NOT NULL CHECK (tipo IN ('inclusao','desconsiderar','abono')),
    data TEXT NOT NULL,            -- AAAA-MM-DD
    hora TEXT,                     -- HH:MM (inclusao)
    marcacao_id INTEGER REFERENCES marcacoes(id), -- desconsiderar
    minutos INTEGER,               -- abono
    motivo TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','aprovado','rejeitado')),
    solicitado_por TEXT NOT NULL,
    decidido_por TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS feriados (
    id INTEGER PRIMARY KEY,
    empresa_id INTEGER REFERENCES empresas(id), -- NULL = nacional
    data TEXT NOT NULL,
    nome TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS eventos_rep (
    id INTEGER PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    data_hora TEXT NOT NULL,
    tipo TEXT NOT NULL,   -- ajuste_relogio | sincronizacao | etc
    detalhe TEXT
  );
  `);
}

module.exports = { abrir };
