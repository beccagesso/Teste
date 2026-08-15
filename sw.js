/* Service worker do gerador de orçamentos da Becca Gesso.
   Guarda os arquivos no aparelho para o app abrir sem internet.

   Ao publicar uma versão nova, troque o número em VERSAO — é isso que
   faz o iPhone baixar os arquivos atualizados em vez de usar os antigos. */

const VERSAO = 'becca-orcamentos-v14';

const ARQUIVOS = [
  './',
  './index.html',
  './manifest.json',
  './icone-180.png',
  './icone-512.png',
  './src/app.js',
  './src/core/acesso.js',
  './src/core/cloud.js',
  './src/core/dates.js',
  './src/core/errors.js',
  './src/core/ids.js',
  './src/core/money.js',
  './src/core/storage.js',
  './src/core/sync.js',
  './src/calculations/orcamento.js',
  './src/calculations/financeiro.js',
  './src/domain/index.js',
  './src/domain/clientes.js',
  './src/domain/fornecedores.js',
  './src/domain/categorias.js',
  './src/domain/orcamentos.js',
  './src/domain/contas.js',
  './src/ui/dom.js',
  './src/ui/components.js',
  './src/ui/clientes.js',
];

self.addEventListener('install', evento => {
  evento.waitUntil(
    caches.open(VERSAO)
      .then(cache => cache.addAll(ARQUIVOS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', evento => {
  evento.waitUntil(
    caches.keys()
      .then(nomes => Promise.all(
        nomes.filter(n => n !== VERSAO).map(n => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

/* Tenta a rede primeiro para pegar atualizações; se estiver sem
   internet, entrega a cópia guardada. */
self.addEventListener('fetch', evento => {
  const req = evento.request;
  if(req.method !== 'GET') return;

  /* Só cuida dos arquivos do próprio app. As chamadas para o Supabase
     saem daqui de fora sem passar por este cache — se passassem, uma
     chamada que falhasse receberia de volta o index.html guardado, e o
     app tentaria ler a página inteira como se fosse a resposta do
     banco, sem erro visível. */
  if(new URL(req.url).origin !== self.location.origin) return;

  evento.respondWith(
    fetch(req)
      .then(resposta => {
        if(resposta && resposta.status === 200 && resposta.type === 'basic'){
          const copia = resposta.clone();
          caches.open(VERSAO).then(cache => cache.put(req, copia));
        }
        return resposta;
      })
      .catch(() => caches.match(req).then(
        /* só uma navegação merece cair no index.html; para os outros
           arquivos, faltar é faltar */
        achou => achou || (req.mode === 'navigate'
          ? caches.match('./index.html') : Response.error())
      ))
  );
});
