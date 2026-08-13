/* Service worker do gerador de orçamentos da Becca Gesso.
   Guarda os arquivos no aparelho para o app abrir sem internet.

   Ao publicar uma versão nova, troque o número em VERSAO — é isso que
   faz o iPhone baixar os arquivos atualizados em vez de usar os antigos. */

const VERSAO = 'becca-orcamentos-v8';

const ARQUIVOS = [
  './',
  './index.html',
  './manifest.json',
  './icone-180.png',
  './icone-512.png',
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
        achou => achou || caches.match('./index.html')
      ))
  );
});
