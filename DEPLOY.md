# Hospedar o sistema num servidor com domínio

O resultado final é o sistema em `https://ponto.suaempresa.com.br`, com certificado HTTPS automático e gratuito, funcionando em qualquer rede (Wi-Fi ou 4G) e instalável como app no celular e no PC.

```
celular / PC  ──HTTPS──►  Caddy (certificado Let's Encrypt)  ──►  app Node.js  ──►  SQLite (volume + backup diário)
```

## O que você precisa

| Item | Onde conseguir | Custo aproximado |
|---|---|---|
| **Domínio** | Registro.br (`.com.br`), Hostinger, GoDaddy, Cloudflare | R$ 40/ano (.com.br) |
| **Servidor VPS** com Ubuntu 22.04 ou 24.04, 1 vCPU e 1 GB de RAM | Hostinger VPS, Contabo, DigitalOcean, Vultr, Magalu Cloud, Oracle Cloud (camada grátis) | R$ 25–60/mês |

Hospedagem compartilhada (de sites PHP) **não serve**: o sistema precisa de um VPS em que você seja administrador (root).

> **LGPD:** o sistema guarda dados pessoais e biometria. Prefira um servidor no Brasil (região São Paulo) ou confira se o contrato do provedor cobre transferência internacional.

## Passo a passo

### 1. Contrate o VPS
Escolha **Ubuntu 24.04**. Anote o **IP** do servidor (ex.: `203.0.113.10`) e a senha de root (ou a chave SSH).

### 2. Aponte o domínio para o servidor
No painel onde você registrou o domínio, abra a zona de DNS e crie:

| Tipo | Nome | Valor |
|---|---|---|
| A | `ponto` (ou `@` para usar o domínio raiz) | IP do servidor |

O DNS pode levar de alguns minutos a algumas horas para valer. Confira em https://dnschecker.org.

### 3. Entre no servidor
No Windows, abra o **PowerShell** e digite:
```bash
ssh root@IP_DO_SERVIDOR
```

### 4. Baixe o sistema e rode o instalador
```bash
apt-get update && apt-get install -y git
git clone -b claude/dixi-reverse-engineering-0cmcwd https://github.com/johnlennon77709/dixi.git /opt/dixi
cd /opt/dixi
bash deploy/instalar.sh
```
O instalador pergunta o **domínio** e um **e-mail**, e cuida do resto:
- instala o Docker;
- gera a chave secreta;
- confere se o DNS aponta para o servidor;
- abre o firewall;
- sobe o sistema com HTTPS;
- agenda o backup diário.

> Se o repositório for **privado**, o `git clone` vai pedir login. Use seu usuário do GitHub e um *token* (GitHub → Settings → Developer settings → Personal access tokens) no lugar da senha.

### 5. Crie sua conta
Abra `https://SEU_DOMINIO` e clique em **Criar empresa**. **A primeira conta criada é a administradora**, e depois disso o cadastro público fecha automaticamente. Para vender como SaaS, com várias empresas se cadastrando sozinhas, coloque `DIXI_CADASTRO_ABERTO=1` no `.env`.

### 6. Configure e instale nos celulares
1. Cadastre **escalas**, **funcionários** (com PIN) e um **dispositivo** do tipo "App no celular".
2. Na aba **📱 Celular**, o funcionário escaneia o QR code e toca em **Instalar app**.
3. Para o reconhecimento facial num tablet, crie um dispositivo do tipo "Quiosque" e cadastre o rosto de cada funcionário na aba Funcionários.

## Dia a dia

| Tarefa | Comando (dentro de `/opt/dixi`) |
|---|---|
| Ver se está rodando | `docker compose ps` |
| Ver logs | `docker compose logs -f app` |
| Reiniciar | `docker compose restart app` |
| Atualizar para a versão nova (faz backup antes) | `bash deploy/atualizar.sh` |
| Backup manual | `docker compose exec app node src/backup.js` |
| Restaurar um backup | `bash deploy/restaurar.sh /var/backups/dixi/dixi-....db` |

Os backups diários rodam às 03:17, ficam em `/var/backups/dixi` e são mantidos por 30 dias (`DIXI_BACKUP_DIAS`). **Copie-os também para fora do servidor** (Google Drive, outro servidor) com alguma frequência, porque se o VPS for perdido os backups vão junto.

## Segurança já configurada

- HTTPS obrigatório, com certificado renovado automaticamente pelo Caddy, e cabeçalhos de segurança (HSTS, anti-iframe, permissões de câmera e GPS só para o próprio site).
- **Conta de demonstração bloqueada** e empresa demo não é criada em produção.
- Senha mínima de 10 caracteres e **bloqueio após 10 tentativas de login erradas** em 15 minutos.
- O sistema roda como usuário sem privilégios dentro do container. O banco fica num volume separado, e a porta 3000 não fica exposta na internet (só o Caddy acessa).
- A chave secreta fica no `.env`, que só o root lê e que não vai para o Git.

## Validade jurídica (Portaria 671)

Preencha no `.env` (e rode `docker compose up -d` depois de editar):
- `DIXI_REGISTRO_INPI`: número de registro do software no INPI;
- certificado **A1 ICP-Brasil**: coloque o `.pfx` em `/opt/dixi/certificado/` e preencha `DIXI_CERT_PFX=/app/certificado/NOME.pfx` e `DIXI_CERT_SENHA`;
- `DIXI_CNPJ_DESENV` e `DIXI_EMAIL_DESENV`: dados de quem desenvolve o software.

Valide os arquivos AFD e AEJ gerados no validador oficial do Ministério do Trabalho antes do uso em fiscalização.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Site não abre e `docker compose logs caddy` mostra erro de certificado | O DNS ainda não aponta para o servidor, ou as portas 80/443 estão bloqueadas no painel do provedor (algumas nuvens, como a Oracle, têm firewall próprio) |
| "Muitas tentativas de login" | Proteção contra força bruta. Espere 15 minutos |
| Não aparece "Criar empresa" | Já existe uma empresa (cadastro fechado). Entre com a conta administradora |
| Câmera ou GPS não funcionam | Precisa ser pelo endereço `https://` do domínio, com a permissão aceita no navegador |
