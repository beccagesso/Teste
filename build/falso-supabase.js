/* Um Supabase de mentira, só com o que o app usa.

   Serve para os testes rodarem sem chave de verdade e sem tocar no
   projeto da Becca. Ele imita as três coisas que importam:

   1. o login do GoTrue (/auth/v1/token);
   2. a leitura e a gravação do PostgREST (/rest/v1/…);
   3. as regras de acesso — sem entrar, não se lê nem se grava nada, e
      cada um só enxerga as próprias linhas.

   Imita também o gatilho que mantém a versão mais nova: um envio com
   atualizado_em menor que o que já está guardado não sobrescreve. É a
   mesma regra do build/supabase.sql. */

const http = require('http');
const crypto = require('crypto');

/* O Postgres carimba com microssegundos. Aqui o carimbo também precisa
   ser sempre crescente: é ele que o app usa para saber o que já baixou. */
let ultimoMicro = 0;
function agora() {
  let micro = Date.now() * 1000;
  if (micro <= ultimoMicro) micro = ultimoMicro + 1;
  ultimoMicro = micro;
  const ms = Math.floor(micro / 1000);
  const resto = String(micro % 1000).padStart(3, '0');
  return new Date(ms).toISOString().replace('Z', '') + resto + '+00:00';
}

const idDoEmail = email =>
  crypto.createHash('sha1').update(String(email).toLowerCase())
    .digest('hex').slice(0, 32)
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');

const COLUNA = {
  orcamentos: 'numero',
  contas: 'chave',
  clientes: 'chave',
  fornecedores: 'chave',
  categorias_financeiras: 'chave',
};

function criar(opcoes) {
  const o = opcoes || {};
  const usuarios = o.usuarios || { 'becca@exemplo.com': 'gesso2026' };
  const chaveValida = o.chave || 'sb_publishable_deMentira123456789';

  const estado = {
    linhas: { orcamentos: [], contas: [], clientes: [], fornecedores: [], categorias_financeiras: [] },
    /* o teste mexe nestes para simular casos difíceis */
    tokensVencidos: new Set(),
    quedaNaProxima: null,
    chamadas: [],
  };

  const cabecalhosCors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers':
      'authorization, apikey, content-type, prefer, x-client-info',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Expose-Headers': 'content-range',
    'Access-Control-Max-Age': '86400',
  };

  function responder(res, codigo, corpo) {
    const texto = corpo === undefined ? '' : JSON.stringify(corpo);
    res.writeHead(codigo, Object.assign({
      'Content-Type': 'application/json',
    }, cabecalhosCors));
    res.end(texto);
  }

  /* Três respostas diferentes, como no PostgREST de verdade:
       - sem cabeçalho de entrada  -> anônimo (a RLS simplesmente não
         mostra nada, e a leitura volta vazia em vez de dar erro);
       - com entrada estragada     -> 401, que é o sinal para renovar;
       - com entrada boa           -> o dono. */
  function quemE(req) {
    const auth = req.headers['authorization'] || '';
    if (!auth.trim()) return { anonimo: true };
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (!token.startsWith('tok-')) return { invalido: true };
    if (estado.tokensVencidos.has(token)) return { invalido: true };
    const email = token.slice(4);
    if (!(email in usuarios)) return { invalido: true };
    return { id: idDoEmail(email), email };
  }

  const servidor = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cabecalhosCors);
      return res.end();
    }

    let bruto = '';
    req.on('data', p => { bruto += p; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      estado.chamadas.push(`${req.method} ${url.pathname}`);

      if (estado.quedaNaProxima) {
        const q = estado.quedaNaProxima;
        estado.quedaNaProxima = null;
        return responder(res, q.codigo || 500, { message: q.mensagem || 'caiu' });
      }

      /* a chave do projeto é sempre exigida */
      if ((req.headers['apikey'] || '') !== chaveValida) {
        return responder(res, 401, { message: 'No API key found in request' });
      }

      let corpo = null;
      try { corpo = bruto ? JSON.parse(bruto) : null; } catch (e) { corpo = null; }

      // ---------- login ----------
      if (url.pathname === '/auth/v1/token') {
        const tipo = url.searchParams.get('grant_type');

        if (tipo === 'password') {
          const email = String((corpo && corpo.email) || '').toLowerCase();
          const senha = (corpo && corpo.password) || '';
          if (!(email in usuarios) || usuarios[email] !== senha) {
            return responder(res, 400, {
              error: 'invalid_grant',
              error_description: 'Invalid login credentials',
            });
          }
          return responder(res, 200, {
            access_token: 'tok-' + email,
            refresh_token: 'ref-' + email,
            expires_in: 3600,
            token_type: 'bearer',
            user: { id: idDoEmail(email), email },
          });
        }

        if (tipo === 'refresh_token') {
          const r = String((corpo && corpo.refresh_token) || '');
          if (!r.startsWith('ref-')) {
            return responder(res, 400, { error: 'invalid_grant' });
          }
          const email = r.slice(4);
          if (!(email in usuarios)) return responder(res, 400, { error: 'invalid_grant' });
          /* renovar destrava o token que o teste tinha vencido */
          estado.tokensVencidos.delete('tok-' + email);
          return responder(res, 200, {
            access_token: 'tok-' + email,
            refresh_token: 'ref-' + email,
            expires_in: 3600,
            user: { id: idDoEmail(email), email },
          });
        }

        return responder(res, 400, { error: 'unsupported_grant_type' });
      }

      // ---------- tabelas ----------
      const m = url.pathname.match(
        /^\/rest\/v1\/(orcamentos|contas|clientes|fornecedores|categorias_financeiras)$/);
      if (!m) return responder(res, 404, { message: 'não existe' });

      const tabela = m[1];
      const coluna = COLUNA[tabela];
      const dono = quemE(req);

      if (dono.invalido) {
        return responder(res, 401, {
          message: 'JWT expired', code: 'PGRST301',
        });
      }

      /* Anônimo: a política é `to authenticated`, então nenhuma linha
         casa. Ler devolve lista vazia; gravar bate na política. */
      if (dono.anonimo) {
        if (req.method === 'GET') return responder(res, 200, []);
        return responder(res, 403, {
          message: 'new row violates row-level security policy',
          code: '42501',
        });
      }

      if (req.method === 'GET') {
        let linhas = estado.linhas[tabela].filter(l => l.dono === dono.id);
        const filtro = url.searchParams.get('gravado_em');
        if (filtro && filtro.startsWith('gte.')) {
          const desde = filtro.slice(4);
          linhas = linhas.filter(l => l.gravado_em >= desde);
        }
        linhas.sort((a, b) => a.gravado_em.localeCompare(b.gravado_em));
        const limite = Number(url.searchParams.get('limit') || 1000);
        return responder(res, 200, linhas.slice(0, limite));
      }

      if (req.method === 'POST') {
        const entrando = Array.isArray(corpo) ? corpo : [corpo];
        for (const linha of entrando) {
          if (!linha) continue;
          /* with check (dono = auth.uid()) */
          if (linha.dono !== dono.id) {
            return responder(res, 403, {
              message: 'new row violates row-level security policy',
              code: '42501',
            });
          }
          const ja = estado.linhas[tabela].find(
            l => l.dono === linha.dono && l[coluna] === linha[coluna]);
          if (!ja) {
            estado.linhas[tabela].push(Object.assign({}, linha, {
              id: crypto.randomUUID(),
              gravado_em: agora(),
            }));
          } else if (Number(linha.atualizado_em) < Number(ja.atualizado_em)) {
            /* o gatilho manter_o_mais_novo: quem chegou é mais velho,
               então o que já estava aqui fica como está */
          } else {
            Object.assign(ja, linha, { gravado_em: agora() });
          }
        }
        const prefer = req.headers['prefer'] || '';
        if (prefer.includes('return=minimal')) {
          res.writeHead(201, cabecalhosCors);
          return res.end();
        }
        return responder(res, 201, entrando);
      }

      return responder(res, 405, { message: 'método não suportado' });
    });
  });

  return { servidor, estado, chaveValida, usuarios, idDoEmail };
}

module.exports = { criar, idDoEmail };
