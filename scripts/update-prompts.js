/**
 * Script pontual: atualiza descrições dos prompts da aula 2026-05-25
 * node scripts/update-prompts.js
 */
const fs = require('fs'), path = require('path');
(function loadEnv(){
  try {
    const raw = fs.readFileSync(path.join(__dirname,'../.env.local'),'utf8');
    for(const line of raw.split('\n')){ const m=line.match(/^([^#=\s][^=]*)=(.*)/); if(m) process.env[m[1].trim()]=m[2].trim().replace(/^["']|["']$/g,''); }
  } catch(_){}
})();

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const UPDATES = [
  {
    name: 'Prompt de Ângulos — Character Reference Sheet 3×2',
    description: `Cria uma imagem do seu personagem em 6 ângulos diferentes (frente, perfil, costas e 3 close-ups do rosto). Use essa imagem para criar o personagem no Google Flow e garantir que o rosto fique idêntico em todas as cenas.

Como usar:
→ Abra o ChatGPT ou o Gemini
→ Cole este prompt e escolha UMA das opções abaixo:
→ Opção A — anexe uma foto de referência (rosto real, ilustração ou imagem de inspiração)
→ Opção B — descreva o personagem em texto (ex: "homem de 40 anos, cabelo grisalho, terno escuro, expressão séria")
→ A IA gera o reference sheet com os 6 ângulos — use essa imagem no People do Google Flow`,
    tags: ['personagem', 'reference-sheet', 'google-flow', 'chatgpt', 'gemini', 'imagem'],
  },
  {
    name: 'Prompt de Voz — Audio Director para Google Flow',
    description: `Após criar o personagem no Google Flow, use este prompt para descobrir qual voz do Flow combina com a aparência dele. A IA analisa a imagem e já entrega a configuração completa, pronta para colar no campo "Edit Voice".

Como usar:
→ Abra o ChatGPT ou o Gemini
→ Anexe a imagem do personagem que você acabou de criar + cole este prompt
→ A IA indica a voz ideal e entrega a configuração completa
→ Cole o resultado diretamente no campo "Edit Voice" do Google Flow`,
    tags: ['voz', 'personagem', 'google-flow', 'chatgpt', 'gemini', 'áudio'],
  },
];

(async function(){
  for(const u of UPDATES){
    const { data, error } = await supabase
      .from('meta_prompts')
      .update({ description: u.description, tags: u.tags })
      .eq('name', u.name)
      .select('id, name');
    if(error) console.error('❌', u.name, error.message);
    else if(!data?.length) console.warn('⚠️  Não encontrado:', u.name);
    else console.log('✅', data[0].name);
  }
  console.log('\nDone.');
})();
