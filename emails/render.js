// emails/render.js — carrega template HTML e substitui {{VARIÁVEIS}}
const fs   = require('fs');
const path = require('path');

/**
 * Renderiza um template de email substituindo {{VARIAVEL}} pelos valores.
 * @param {string} templateId  ex: 'cenadrop/reenvio-chave', 'eda/boas-vindas'
 * @param {object} vars        ex: { PRIMEIRO_NOME: 'João', CHAVE: 'CD-XXXX-XXXX' }
 * @returns {string} HTML renderizado
 */
function renderEmail(templateId, vars = {}) {
  const htmlPath = path.join(__dirname, `${templateId}.html`);
  let html = fs.readFileSync(htmlPath, 'utf8');
  for (const [key, value] of Object.entries(vars)) {
    html = html.replace(
      new RegExp(`\\{\\{${key}\\}\\}`, 'g'),
      () => String(value ?? '')
    );
  }
  return html;
}

module.exports = { renderEmail };
