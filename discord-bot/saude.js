/**
 * Endereço de saúde dos bots (Railway expõe pela porta PORT).
 * GET /saude → 200 se EDA e CenaDrop estão conectados ao Discord; 503 se algum caiu.
 * Um monitor externo (UptimeRobot) chama isso a cada 5 min e avisa o Rayner se falhar —
 * cobre bot travado, Railway fora do ar e cobrança do Railway falhando.
 */
const http = require('http');

module.exports = function saude(clientes) {
  const porta = process.env.PORT || 3000;
  http.createServer((req, res) => {
    const estado = Object.fromEntries(Object.entries(clientes).filter(([, c]) => c).map(([nome, c]) => [nome, {
      online: !!c?.isReady?.(),
      ping_ms: c?.ws?.ping ?? null,
    }]));
    const ok = Object.values(estado).every((e) => e.online);
    res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok, bots: estado, hora: new Date().toISOString() }));
  }).listen(porta, () => console.log(`[Saúde] ouvindo na porta ${porta} (/saude)`));
};
