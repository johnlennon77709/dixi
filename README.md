# DIXI-MVP — Sistema de Ponto Eletrônico (REP-P)

MVP funcional construído a partir do plano da **seção 7.1 do [REA da DIXI](REA-DIXI.md)**.

## Hospedar com domínio próprio

Para colocar no ar em `https://seudominio.com.br` (Docker + HTTPS automático + backup diário), siga o **[DEPLOY.md](DEPLOY.md)**. Num VPS Ubuntu, a instalação é um comando: `bash deploy/instalar.sh`.

## Como rodar no seu computador

Requer **Node.js 22.13+** (usa o SQLite embutido do Node).

```bash
npm install
npm run seed     # cria uma empresa de demonstração com 1 mês de marcações
npm start        # http://localhost:3000
npm test         # 18 testes (regras da CLT, NSR/hash, AFD, assinatura)
```

| O quê | Onde | Acesso demo |
|---|---|---|
| Painel do RH | http://localhost:3000/ | `admin@demo.com` / `demo123` |
| App de ponto em modo quiosque (tablet, facial) | http://localhost:3000/ponto.html?token=demo-quiosque | PIN de todos: `1234` |
| App de ponto no celular (GPS + cerca virtual) | http://localhost:3000/ponto.html?token=demo-app | CPF `529.982.247-25`, PIN `1234` |

## PWA (app instalável)

O sistema tem **dois apps instaláveis** que compartilham o mesmo servidor:

| App | Endereço | Offline |
|---|---|---|
| **Bater ponto** | `/ponto.html` | Abre sem internet, faz reconhecimento facial local e guarda as marcações numa fila que é enviada quando a conexão volta |
| **Painel RH** | `/` | Abre sem internet e mostra os últimos dados vistos (somente leitura, com aviso na tela). Ao sair, a cópia local é apagada |

Para instalar, use o botão **Instalar app** (ou o menu do navegador → *Instalar app* / *Adicionar à tela inicial*). No PC funciona direto em `http://localhost:3000`. O service worker (`public/sw.js`) guarda as telas, os ícones e os modelos de reconhecimento facial (~13 MB) em cache.

### Instalar no celular: use o INICIAR-COM-INTERNET.bat

O celular **só instala PWA com certificado HTTPS válido**. O certificado gerado pelo PC (modo Wi-Fi abaixo) permite abrir o site, mas não instalar o app nem usar o modo offline. Por isso existe o **`INICIAR-COM-INTERNET.bat`**:

- ele baixa o `cloudflared` e cria um endereço `https://xxxx.trycloudflare.com` com certificado válido (gratuito, sem conta);
- funciona em qualquer rede, inclusive 4G, enquanto o PC estiver ligado;
- o endereço muda a cada reinício, e o QR code atualizado aparece na aba **📱 Celular**;
- **segurança:** o endereço é público. Crie sua própria conta com senha forte, porque a conta de demonstração é bloqueada por esse endereço.

Para algo definitivo, publique o sistema num servidor com domínio próprio e HTTPS.

## Versão para celular (Wi-Fi, sem instalar)

O PC funciona como servidor e o celular acessa pela **mesma rede Wi-Fi**:

1. Rode o sistema no PC (`INICIAR.bat` ou `npm start`). Se o Windows perguntar sobre o Firewall, clique em **Permitir** (rede privada).
2. No painel do RH, abra a aba **📱 Celular** e escaneie o QR code com a câmera do celular.
3. O celular vai avisar que a conexão não é particular. Isso acontece porque o certificado HTTPS é gerado pelo próprio PC. Toque em **Avançado → Continuar**.
4. Permita câmera e localização. Para usar como app, toque em **Adicionar à tela inicial** (no iPhone: Compartilhar → Adicionar à Tela de Início).

O servidor HTTPS da rede local usa a porta `3443` (`PORT_HTTPS`). O HTTPS é obrigatório porque os navegadores só liberam câmera e GPS em conexões seguras. Para acessar de fora da rede local, publique o sistema num servidor com domínio e HTTPS (ex.: Caddy, Nginx, Cloudflare Tunnel).

## O que o REA pedia × o que foi implementado

| Item do REA (7.1) | Implementação |
|---|---|
| **1. Backend multi-tenant** (empresas, estabelecimentos, funcionários, escalas, marcações append-only com NSR e hash encadeado, ajustes, dispositivos) | `src/db.js`, `src/rep.js`: SQLite. Triggers bloqueiam UPDATE/DELETE em marcações, cada empresa tem NSR sequencial e o SHA-256 é encadeado com o registro anterior. Auditoria da cadeia em `/api/auditoria`. |
| **2. Motor de jornada** (fixa, 12x36, flexível, tolerância art. 58, HE 50/100%, adicional noturno com hora reduzida, intrajornada, interjornada, DSR, banco de horas) | `src/jornada.js`. A 12x36 noturna atribui a saída das 07h ao dia em que a jornada começou. |
| **3. Arquivos fiscais** (AFD, AEJ, assinatura CAdES com A1, comprovante PDF) | `src/fiscal.js`: AFD (registros 1, 7 e 9), AEJ (01–08, 99), `.p7s` CAdES destacada que o `openssl cms -verify` valida, comprovante em PDF. |
| **4. REP-P mobile** (foto, prova de vida, GPS e cerca virtual, offline com fila local, hora sincronizada) | `public/ponto.html`: PWA instalável. Tem fila offline idempotente (`idLocal`), cerca virtual validada no servidor, selfie de evidência (só o hash da foto é enviado) e hora sincronizada com o servidor. |
| **5. Modo quiosque** com reconhecimento facial 1:N local | Mesmo app com `face-api` (detecção, embedding de 128 dimensões e prova de vida por piscada). Os modelos são servidos pelo próprio servidor e ficam em cache para uso offline. |
| **6. Painel web** (espelho, aprovação de ajustes, relatórios, exportação para folha, eSocial S-1200 opcional) | `public/index.html`: espelho com KPIs, tratamento (incluir, desconsiderar, abonar) com aprovação, export CSV, TXT de largura fixa com rubricas configuráveis e rascunho XML do S-1200. |
| **7. Compliance** (INPI, atestado técnico, LGPD de biometria) | Biometria só com aceite do termo, guardada apenas como vetor numérico (sem foto) e removível. O registro no INPI e o atestado técnico são processos fora do código (veja abaixo). |
| Hora Legal Brasileira | `src/horalegal.js`: cliente SNTP para `*.ntp.br`. Se a rede bloquear, usa o relógio do sistema e mostra isso na Auditoria. |

## Antes de usar em produção

O código funciona, mas a validade jurídica depende de coisas que só a empresa pode providenciar:

1. **Registrar o software no INPI** e definir `DIXI_REGISTRO_INPI` (17 dígitos). Ele aparece no AFD, no AEJ e no comprovante.
2. **Certificado A1 ICP-Brasil**: `DIXI_CERT_PFX=/caminho/cert.pfx DIXI_CERT_SENHA=...`. Sem ele é usado um certificado de **teste**, sem valor legal.
3. **Validar AFD e AEJ** no validador oficial do Ministério do Trabalho. Os leiautes seguem a Portaria 671, mas precisam dessa conferência.
4. **Atestado técnico e termo de responsabilidade** do programa de tratamento de ponto.
5. **Rubricas da folha**: ajuste os códigos em `src/exportacao.js` para os do seu escritório contábil. O S-1200 é um rascunho para a folha completar, não um evento pronto para transmitir.
6. **HTTPS e backup**. O banco fica em `data/dixi.db`. Defina também `DIXI_SEGREDO` (chave dos tokens).

## Diferenças em relação ao REA

- **App em PWA, não em Flutter**: o REA sugeria Flutter. Optei por um PWA para rodar em qualquer celular ou tablet sem publicar em loja. As funções previstas (câmera, GPS, offline, quiosque) estão todas lá.
- **Prova de vida por piscada**: o REA cita câmera infravermelha, que tablets e celulares comuns não têm. A piscada substitui a IR, mas é menos resistente a fraude que um hardware dedicado.
- **Linguagem do backend**: o REA sugeria NestJS/FastAPI, PostgreSQL e Redis. O MVP usa Node puro e SQLite para rodar com um único `npm start`. O esquema migra direto para PostgreSQL.
- **Confiança no dispositivo**: no reconhecimento facial, quem compara os rostos é o próprio aparelho (necessário para funcionar offline), e o servidor confia no dispositivo autenticado pelo token.
