/**
 * Script para inserir uma nova aula no Meta-Prompts.
 * Edite o objeto AULA abaixo e rode:
 *   node scripts/insert-meta-class.js
 * (Execute sempre a partir da raiz do servidor)
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Carrega .env.local
(function loadEnv() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
      if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch (_) {}
})();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── DADOS DA AULA ─────────────────────────────────────────────────────────────
// Edite aqui antes de rodar o script.
const AULA = {
  date:        '2026-05-25',
  title:       'CenaDrop Flow v7.6 — Personagem Consistente + Automação em Lote',
  description: 'Como criar um personagem visual consistente no Google Flow (reference sheet + voz) e automatizar a geração de 80 cenas em lote com o CenaDrop v7.6. Inclui os dois prompts usados ao vivo.',
  prompts: [
    {
      name:        'Prompt de Ângulos — Character Reference Sheet 3×2',
      description: 'Use no Gemini ou Flow Image enviando a foto base do personagem. Gera um reference sheet 3×2 com 6 ângulos (frente, perfil, costas, close frontal, close perfil, close sorrindo). Use o resultado para criar o personagem no People do Google Flow — esse entityId garante consistência em todas as cenas.',
      prompt: `Use the attached image as the main reference for the character's identity, face, body, hair, expression, clothing, accessories, material textures, and visual style.

Create a professional character reference sheet in a 3x2 layout, with six separate panels, in a cinematic character sheet / reference sheet style.

Keep the same character in every panel, preserving:
- the same facial features;
- the same hair;
- the same skin tone;
- the same apparent age;
- the same body type;
- the same clothing;
- the same accessories;
- the same lighting;
- the same visual atmosphere;
- the same cinematic quality as the reference image.

Mandatory layout: 3 columns by 2 rows.

PANEL 1 — TOP LEFT:
Full-body front view of the character, standing, facing forward, with a natural and confident posture.

PANEL 2 — TOP CENTER:
Full-body side profile view of the character, highlighting the silhouette, clothing, and body shape.

PANEL 3 — TOP RIGHT:
Full-body back view of the character, showing the hair, shoulders, back of the outfit, and costume details.

PANEL 4 — BOTTOM LEFT:
Close-up face portrait from the front, serious/neutral expression, strong cinematic gaze.

PANEL 5 — BOTTOM CENTER:
Close-up face portrait from the side/profile, clearly showing the nose, jawline, hair, beard, or facial features.

PANEL 6 — BOTTOM RIGHT:
Close-up face portrait from the front, now smiling naturally, while keeping the same character identity.

Visual style:
Photorealistic, cinematic, high definition, soft dramatic lighting, elegant shadows, realistic skin and clothing textures, Hollywood movie poster quality.

Background:
Clean neutral studio background, no distractions, consistent lighting across all panels.

Important rules:
- Do not add text.
- Do not add names.
- Do not create another character.
- Do not change the main outfit.
- Do not drastically change the face.
- Do not deform hands, eyes, or body proportions.
- Do not use a cluttered background.
- Maintain absolute consistency between all angles.
- High-quality result, sharp focus, best quality, professional character reference sheet.`,
      tags:  ['personagem', 'reference-sheet', 'google-flow', 'imagem'],
      order: 0,
    },
    {
      name:        'Prompt de Voz — Audio Director para Google Flow',
      description: 'Use no Gemini enviando a imagem do personagem criado. A IA analisa o perfil visual (idade, arquétipo, postura, atmosfera) e entrega a configuração completa pronta para colar no campo "Edit Voice" do Google Flow: voz base da lista oficial, nome interno, direção de performance e frase de teste.',
      prompt: `You act as an Audio Director and AI Voice Casting Specialist for cinematic productions and documentaries.

I will send an image of a character. Your task is to analyze the character's visual profile — apparent age, archetype, posture, emotion, clothing, and cinematic atmosphere — and create a complete configuration for the Google Flow "Edit Voice" tool, choosing the best voice base and directing the vocal performance.

Use ONLY the voices from this official table as the "Voice base":

* Achird (M, friendly, mid)
* Algenib (M, gravelly, low)
* Algieba (M, easy-going, mid-low)
* Alnilam (M, firm, mid-low)
* Aoede (F, breezy, mid)
* Autonoe (F, bright, mid)
* Callirrhoe (F, easy-going, mid)
* Charon (M, informative, lower)
* Despina (F, smooth, mid)
* Enceladus (M, breathy, lower)
* Erinome (F, clear, mid)
* Fenrir (M, excitable, younger)
* Gacrux (F, mature, mid)
* Iapetus (M, clear, mid-low)
* Kore (F, firm, mid)
* Laomedeia (F, upbeat, mid-high)
* Leda (F, youthful, mid-high)
* Orus (M, firm, mid-low)
* Puck (M, upbeat, mid)
* Pulcherrima (Gender-neutral, forward, mid-high)
* Rasalgethi (M, informative, mid)
* Sadachbia (M, lively, low)
* Sadaltager (M, knowledgeable, mid)
* Schedar (M, even, mid-low)
* Sulafat (F, warm, mid)
* Umbriel (M, smooth, lower)
* Vindemiatrix (F, gentle, mid)
* Zephyr (F, bright, mid-high)
* Zubenelgenubi (M, casual, mid-low)

Forneça a sua resposta EXATAMENTE no formato abaixo:

### 1. Análise de Casting
[Escreva 2 a 3 linhas justificando por que esse perfil visual pede o tom de voz escolhido. Considere idade aparente, arquétipo, postura, expressão, figurino e atmosfera cinematográfica.]

### 2. Configuração "Editar voz" (Google Flow)
* **Voz base:** [Escolha APENAS UM nome da tabela oficial]
* **Nome:** [Crie um nome interno para o projeto. Ex: Rajan_Investigador, Rosa_Acolhimento, Vitor_NarradorSombrio]
* **Performance da voz:** [Descreva detalhadamente como o tom deve soar. Instrua sobre emoção predominante, ritmo da fala, textura vocal, intensidade, pausas respiratórias, nível de formalidade e estilo cinematográfico/documental.]
* **Exemplo de diálogo:** [Escreva uma frase de teste que combine com o personagem. ATENÇÃO: limite MÁXIMO de 120 caracteres, incluindo espaços.]`,
      tags:  ['voz', 'personagem', 'google-flow', 'áudio'],
      order: 1,
    },
  ],
};
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n📚 Inserindo aula: "${AULA.title}" (${AULA.date})`);

  const { data: cls, error: e1 } = await supabase
    .from('meta_classes')
    .insert({ title: AULA.title, class_date: AULA.date, description: AULA.description })
    .select()
    .single();

  if (e1) { console.error('❌ Erro ao criar aula:', e1.message); process.exit(1); }
  console.log(`✅ Aula criada — id: ${cls.id}`);

  for (const p of AULA.prompts) {
    const { error: e2 } = await supabase.from('meta_prompts').insert({
      class_id:   cls.id,
      name:       p.name,
      description: p.description,
      prompt_text: p.prompt,
      tags:        p.tags || [],
      order_index: p.order ?? 0,
    });
    if (e2) console.error(`  ❌ Erro no prompt "${p.name}":`, e2.message);
    else    console.log(`  ⚡ Prompt inserido: ${p.name}`);
  }

  console.log(`\n🔗 Acesse: https://raynern.com.br/meta-prompts#${cls.id}\n`);
}

main();
