# REA — Reverse Anything Engineering: DIXI Soluções (Dixi Ponto)

> Engenharia reversa do **negócio, do produto, da tecnologia e da operação** da DIXI, empresa brasileira de controle de ponto.
> Data da pesquisa: 25/11/2026. Fontes públicas (busca, loja online, orçamento em licitação pública, Reclame Aqui, redes sociais).
>
> **Legenda:** ✅ = confirmado em fonte pública · 🔍 = inferência técnica (o que *provavelmente* é, com base em como esse tipo de produto é construído)

---

## 1. Ficha da empresa

| Item | Dado | |
|---|---|---|
| Nome comercial | DIXI / Dixi Ponto / Dixi Soluções | ✅ |
| Razão social | DIXI VEXT Comércio de Equipamentos Eletrônicos e Sistemas Ltda | ✅ |
| Sede / fundação | Curitiba (PR), 2008 | ✅ |
| Tamanho | 11–50 funcionários (ZoomInfo); ~39 funcionários em matéria de ~2020 | ✅ |
| Base instalada | ~15 mil relógios instalados (dado de ~2020) | ✅ |
| Slogan | "Controle de Ponto é Dixi e Ponto Final" | ✅ |
| Site / sistemas | `dixiponto.com.br`, loja `loja.dixiponto.com.br`, sistema web `app.dixiponto.com.br` | ✅ |
| Diferencial declarado | Fabricante própria, vende **direto ao cliente** (sem revenda); um dos primeiros relógios faciais homologados pelo MTE e certificados pelo INMETRO | ✅ |

**Resumo em uma frase:** a DIXI é um **fabricante de hardware de ponto (relógio facial) que virou SaaS**: vende o relógio + assinatura mensal do software de tratamento de ponto em nuvem.

---

## 2. Mapa de produtos

```
                    ┌──────────────────────────────────────────┐
                    │      Software de Gestão de Ponto (SaaS)  │  app.dixiponto.com.br
                    │  tratamento, banco de horas, espelho,    │
                    │  relatórios, AFD/AEJ, exportação folha   │
                    └───────────▲───────────────▲──────────────┘
                                │               │
          ┌─────────────────────┴──┐     ┌──────┴────────────────────┐
          │ Relógio IREP Facial    │     │ Coletor Dixi Facial       │
          │ (REP-C, imprime        │     │ (REP-P, sem impressora,   │
          │  comprovante)          │     │  depende do software)     │
          │ modelos I6 / I7        │     │ até 5.000 faces           │
          │ face (VGA+IR), RFID,   │     └───────────────────────────┘
          │ teclado; até 1.000 faces│
          │ memória flash inviolável│    ┌───────────────────────────┐
          └────────────────────────┘     │ App mobile (opcional)     │
                                         │ ponto c/ foto + GPS       │
          + Relógio biométrico (digital) └───────────────────────────┘
```

| Produto | O que é | Status |
|---|---|---|
| **IREP Facial (I6, I7)** | Relógio REP-C com reconhecimento facial por 2 câmeras (visível + infravermelho = anti-foto/anti-fraude), RFID e teclado; imprime comprovante; memória flash (MRP) inviolável | ✅ |
| **Coletor Dixi Facial (REP-P)** | Terminal facial sem impressora; a validade jurídica vem do software REP-P (Portaria 671) | ✅ |
| **Relógio biométrico** | Linha por impressão digital (legado) | ✅ |
| **Software de Gestão de Ponto** | Web, nuvem, "dispensa instalação"; versão básica até 30 funcionários | ✅ |
| **App de ponto** | Registro pelo celular com foto e geolocalização | ✅ |
| **Planos mensais** | "Relógio + sistema – plano mensal" e "REP-P + Software – plano mensal" na loja | ✅ |

---

## 3. Modelo de negócio (engenharia reversa)

| Alavanca | Como funciona |
|---|---|
| **Venda de hardware** | Relógio vendido por ~R$ 5 mil (dado ~2020). Margem de fabricante, sem intermediário. ✅ |
| **Hardware como serviço** | Planos mensais que embutem relógio + software (há relatos de relógio em **comodato**). Transforma CAPEX do cliente em mensalidade. ✅ |
| **SaaS recorrente** | Software cobrado por faixa de funcionários (ex.: "até 30"). É aqui que está o LTV. ✅/🔍 |
| **Lock-in** | O cliente cadastra rostos, escalas e histórico no sistema da Dixi; relógio conversa só com a nuvem Dixi → trocar de fornecedor custa caro. 🔍 |
| **Canal** | Venda direta (site, loja, WhatsApp) + licitações públicas (há orçamento em edital da CESAMA). ✅ |
| **Público** | PMEs (comércio, indústria, construção, saúde), órgãos públicos. 🔍 |

**Unit economics estimadas 🔍** (ordem de grandeza, para modelagem):
- Custo BOM de um terminal facial Android/Linux com IR + RFID + impressora térmica: R$ 800–1.500.
- Preço do relógio: R$ 3–5 mil → margem bruta alta no hardware.
- SaaS: tipicamente R$ 5–12 por funcionário/mês ou faixa fixa (R$ 50–300/mês) no mercado brasileiro.

---

## 4. Arquitetura técnica inferida 🔍

```
 [Relógio IREP / Coletor]  ──(HTTPS/MQTT ou TCP proprietário, NTP/HLB)──►  [Backend Dixi Cloud]
   • Android ou Linux embarcado (SoC ARM tipo Rockchip RV11xx/RK3568)         • API de dispositivos (push de marcações,
   • câmera RGB + IR (liveness)                                                  pull de cadastros/faces/config)
   • modelo facial embarcado (detecção + embedding)                            • Banco relacional (empresas, funcionários,
   • MRP: memória flash append-only com NSR sequencial                           escalas, marcações, NSR)
   • impressora térmica (REP-C)                                                • Motor de cálculo de jornada
   • fila offline → sincroniza quando volta a rede                             • Gerador AFD / AEJ / espelho / comprovante
                                                                                 assinado digitalmente
 [App mobile] ──HTTPS (foto + GPS)──────────────────────────────────────────►  • Exportação p/ folha (TXT/CSV layout
                                                                                 Domínio, Alterdata, Totvs etc.)
 [Web app.dixiponto.com.br] ◄── RH / contador ───────────────────────────────  • Multi-tenant por CNPJ
```

Pontos-chave:
1. **Reconhecimento facial "algoritmo próprio"** ✅ — na prática, quase certamente um modelo de detecção (ex.: RetinaFace/SCRFD) + embedding (ArcFace-like) rodando no próprio terminal, com liveness pela câmera IR. "1.000 faces" vs "5.000 faces" indica busca 1:N local limitada pela memória/CPU do dispositivo. 🔍
2. **Relógio dependente da nuvem** — as reclamações de "relógio desconecta do sistema central" e "falha na central da Dixi" ✅ mostram que o terminal precisa de conexão contínua com o backend para sincronizar marcações e cadastros. Ponto único de falha. 🔍
3. **Migração de plataforma recente** — várias reclamações (2025–2026) sobre "migração desastrosa", acesso cortado e prazo curto ✅ → a Dixi trocou o sistema legado (provavelmente desktop/servidor local) por uma nova plataforma web, e a migração de dados foi problemática. 🔍

---

## 5. Requisitos legais que o produto implementa (Portaria MTP 671/2021)

Qualquer clone precisa disto — é a "barreira de entrada" regulatória:

| Requisito | REP-C (IREP) | REP-P (coletor/app) |
|---|---|---|
| Certificação | INMETRO (hardware) | Registro do software no **INPI** |
| Registro inviolável | MRP em flash, NSR sequencial | Banco imutável/append-only, NSR |
| Hora oficial | Relógio interno + ajuste | Sincronizar com **Hora Legal Brasileira** (Observatório Nacional) |
| Comprovante ao trabalhador | Impresso | Digital (PDF assinado) |
| Arquivos fiscais | **AFD** (Arquivo Fonte de Dados) | AFD + **AEJ** (Arquivo Eletrônico de Jornada) |
| Assinatura | — | Assinatura digital (certificado ICP-Brasil, formato CAdES/.p7s) nos arquivos |
| Programa de tratamento | Atestado técnico + termo de responsabilidade | idem |
| LGPD | Biometria = dado pessoal sensível → base legal, consentimento/termo, retenção, segurança |

---

## 6. Análise SWOT (a partir da engenharia reversa)

**Forças:** fabricante própria (controle de custo e de produto); 15+ anos de mercado; homologações MTE/INMETRO; base instalada grande; vende tanto hardware quanto SaaS; presença em licitações.

**Fraquezas (evidências no Reclame Aqui ✅):** suporte lento (20–30 min no WhatsApp); relógios desconectando da central; migração de sistema mal comunicada, com prazo curto e perda de acesso; divergências nas marcações gerando retrabalho no RH.

**Oportunidades:** REP-P puro (app + tablet) barateia a entrada; integrações com folha/eSocial; módulos de controle de acesso; IA para detecção de inconsistências.

**Ameaças:** concorrentes 100% software com marketing forte (Pontotel, Sólides/Tangerino, Ahgora, Senior, Control iD com hardware barato); comoditização do relógio facial (equipamentos a partir de R$ 300 no varejo); reputação de suporte.

---

## 7. Como construir um concorrente (blueprint)

### 7.1 MVP (3–4 meses, time de 3–4 devs)
1. **Backend multi-tenant** — Node.js (NestJS) ou Python (FastAPI) + PostgreSQL. Tabelas: `empresas`, `estabelecimentos`, `funcionarios`, `escalas`, `marcacoes` (append-only, `nsr` sequencial por REP, hash encadeado), `ajustes` (tratamento separado da marcação original), `dispositivos`.
2. **Motor de jornada** — escalas fixas/12x36/flexíveis, tolerâncias (art. 58 CLT), hora extra 50/100%, adicional noturno com hora reduzida, intervalo intrajornada, interjornada, DSR, banco de horas.
3. **Arquivos fiscais** — gerador de AFD e AEJ no layout da Portaria 671 + assinatura CAdES com certificado A1; comprovante PDF.
4. **REP-P mobile** — app Flutter/React Native: foto + liveness, GPS/cerca virtual, **modo offline** com fila local e NSR reservado, sincronização de hora com servidor (que consulta NTP do Observatório Nacional: `a.st1.ntp.br`).
5. **Modo quiosque** — o mesmo app em tablet Android barato, com reconhecimento facial 1:N local (ex.: ML Kit/MediaPipe para detecção + modelo MobileFaceNet/ArcFace em TFLite).
6. **Painel web** — espelho de ponto, aprovação de ajustes, relatórios, exportação para folha (layouts Domínio, Alterdata, Totvs, Senior), integração eSocial S-1200 opcional.
7. **Compliance** — registro do software no INPI, atestado técnico, política LGPD de biometria (armazenar só embeddings criptografados, nunca a foto bruta quando possível).

### 7.2 Como atacar as fraquezas da Dixi
- **Offline-first de verdade:** terminal/app nunca "cai" — marcações sempre gravadas localmente e sincronizadas depois (resolve a queixa nº 1).
- **Hardware agnóstico:** aceitar tablets comuns e relógios de terceiros (Control iD, Henry, Dimep via AFD/API) → sem lock-in, migração fácil.
- **Ferramenta de importação:** importar AFD/histórico de outros sistemas em minutos (a dor da "migração desastrosa").
- **Suporte rápido:** chat in-app com SLA, base de conhecimento e assistente de IA para RH.
- **Preço transparente** por funcionário no site.

### 7.3 Estimativa de stack/custos
| Componente | Sugestão |
|---|---|
| Backend | NestJS/FastAPI, PostgreSQL, Redis, filas (BullMQ/Celery) |
| Infra | AWS/GCP região São Paulo (LGPD), backups, S3 com Object Lock p/ arquivos fiscais |
| Mobile/quiosque | Flutter + TFLite |
| Web | Next.js/React |
| Assinatura | certificado ICP-Brasil A1 + lib CAdES (ex.: BouncyCastle / `node-forge`) |
| Custo infra inicial | ~US$ 200–600/mês até alguns milhares de funcionários |

---

## 8. Lacunas / próximos passos
- O site oficial (`dixiponto.com.br`) não estava acessível a partir do ambiente desta pesquisa; preços atuais, lista completa de integrações e detalhes do app não foram confirmados.
- Para fechar o REA: baixar o APK do app da Dixi (análise de endpoints/SDKs), ver o manual do IREP (protocolo de comunicação), obter um orçamento oficial, e checar CNPJ/registro INPI do software.

---

## Fontes
- [Dixi – Controle de Ponto Eletrônico (site)](https://dixiponto.com.br/)
- [Dixi – Sobre a Dixi](https://dixiponto.com.br/sobre-a-dixi/)
- [Dixi – Produtos](https://dixiponto.com.br/produtos)
- [Relógio de Ponto Facial — Dixi](https://dixiponto.com.br/relogio-ponto-facial/)
- [Relógio Ponto Facial IREP](https://dixiponto.com.br/relogio-irep-facial/)
- [Relógio de Ponto Dixi](https://dixiponto.com.br/relogio-ponto/)
- [Relógio Ponto Biométrico](https://www.dixiponto.com.br/relogio-ponto-biometrico.php/)
- [Loja – IREP Facial Portaria 671](https://loja.dixiponto.com.br/relogio-de-ponto-reconhecimento-facial-irep-facial)
- [Loja – Relógio facial + sistema (plano mensal)](https://loja.dixiponto.com.br/g1m0lujzj-relogio-de-ponto-facial-plano-mensal)
- [Loja – REP-P + Software (plano mensal)](https://loja.dixiponto.com.br/relogio-de-ponto-reconhecimento-facial-rep-p-software-plano-mensal)
- [Orçamento Dixi em edital CESAMA (PDF)](https://www.cesama.com.br/site/uploads/arquivos_editais/2720/170534458747796847571.pdf)
- [Gazeta do Povo – Empresa quer faturar R$ 10 milhões com relógio facial](https://www.gazetadopovo.com.br/vozes/parana-sa/empresa-quer-faturar-r-10-milhoes-com-relogio-de-ponto-com-reconhecimento-facial/)
- [Kennedy em Dia – Novo relógio de ponto eletrônico](https://kennedyemdia.com.br/noticia/14353/novo-relogio-de-ponto-eletronico-ajuda-na-retomada-das-atividades-das-empresas)
- [LinkedIn DIXI PONTO](https://br.linkedin.com/company/dixiponto) · [Facebook](https://www.facebook.com/dixiponto/) · [YouTube](https://www.youtube.com/@dixiponto) · [ZoomInfo](https://www.zoominfo.com/c/dixi-ponto/482584150)
- Reclame Aqui: [divergências e suporte](https://www.reclameaqui.com.br/dixi-solucoes/divergencias-no-sistema-de-ponto-eletronico-suporte-ineficiente-e-retrabalho_ojU2oa8NWgxXkSki/) · [migração desastrosa](https://www.reclameaqui.com.br/dixi-solucoes/migracao-desastrosa_DWr4CEmCb5NeNfAC/) · [acesso cortado](https://www.reclameaqui.com.br/dixi-solucoes/problemas-com-o-sistema-de-controle-de-ponto-dixxi-acesso-cortado-migracao-falha-e-suporte-ineficaz_9LaaGuGT2GGvQ4Hv/) · [facial desconecta](https://www.reclameaqui.com.br/dixi-solucoes/sistema-de-ponto-facial-da-dix-desconecta-constantemente-e-suporte-tecnico-e-demorado_W-2nNKrnz192-SEg/) · [relógio com problema](https://www.reclameaqui.com.br/dixi-solucoes/suporte-ruim-e-problemas-com-o-relogio-ponto_jAypHGTiWakpP8mX/) · [migração sem aviso](https://www.reclameaqui.com.br/dixi-solucoes/insatisfacao-com-migracao-de-sistema-de-controle-de-ponto-falta-de-aviso-prazo-curto-e-suporte-ineficiente_T5bjWOkp7Uur6YYt/)
- Contexto regulatório: [Sólides – REP-P](https://solides.com.br/blog/rep-p/) · [Senior – REPs e Portaria 671](https://documentacao.senior.com.br/seniorxplatform/manual-do-usuario/ronda/integracoes-com-dispositivos/registradores-eletronicos-de-ponto-e-portaria-671.htm) · [Alterdata – Ponto eletrônico](https://www.alterdata.com.br/contabil/ponto-eletronico)
