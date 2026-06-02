/**
 * GET /api/yt-comment-bot  (chamado pelo cron Vercel a cada 10 min)
 * Varre comentários de vídeos configurados, responde automaticamente
 * quando a palavra-chave é detectada.
 */
const { createClient } = require('@supabase/supabase-js');

async function getAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.YOUTUBE_COMMENT_BOT_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`OAuth falhou: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function fetchComments(videoId, apiKey) {
  const url = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoId}&maxResults=100&order=time&key=${process.env.YOUTUBE_COMMENT_BOT_API_KEY || apiKey}`;
  const res  = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(`YT API: ${data.error.message}`);
  return data.items || [];
}

async function replyToComment(commentId, text, accessToken) {
  const res = await fetch('https://www.googleapis.com/youtube/v3/comments?part=snippet', {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      snippet: { parentId: commentId, textOriginal: text },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Erro ao responder comentário');
  return data;
}

async function runBotCheck(supabase, accessToken) {
  const { data: triggers, error } = await supabase
    .from('yt_comment_triggers')
    .select('*')
    .eq('active', true);

  if (error) throw new Error(`Supabase: ${error.message}`);
  if (!triggers?.length) return { skipped: true, reason: 'Nenhum gatilho ativo' };

  const results = [];

  for (const trigger of triggers) {
    let replied = 0;
    const errors = [];

    try {
      const items = await fetchComments(trigger.video_id, process.env.YOUTUBE_API_KEY);

      for (const item of items) {
        const topComment = item.snippet?.topLevelComment;
        if (!topComment) continue;

        const commentId = topComment.id;
        const text      = (topComment.snippet?.textOriginal || topComment.snippet?.textDisplay || '').toLowerCase();
        const author    = topComment.snippet?.authorDisplayName || '';
        const original  = topComment.snippet?.textOriginal || topComment.snippet?.textDisplay || '';

        if (!text.includes(trigger.keyword.toLowerCase())) continue;

        // Verifica se já respondemos este comentário
        const { data: existing } = await supabase
          .from('yt_comment_replies')
          .select('id')
          .eq('comment_id', commentId)
          .maybeSingle();

        if (existing) continue;

        // Responde
        try {
          await replyToComment(commentId, trigger.reply_message, accessToken);
          await supabase.from('yt_comment_replies').insert({
            comment_id:   commentId,
            video_id:     trigger.video_id,
            trigger_id:   trigger.id,
            author_name:  author,
            comment_text: original.slice(0, 500),
            replied_at:   new Date().toISOString(),
          });
          replied++;
        } catch (err) {
          errors.push({ commentId, error: err.message });
        }
      }
    } catch (err) {
      errors.push({ trigger: trigger.id, error: err.message });
    }

    // Atualiza last_checked_at
    await supabase
      .from('yt_comment_triggers')
      .update({ last_checked_at: new Date().toISOString() })
      .eq('id', trigger.id);

    results.push({
      trigger_id: trigger.id,
      keyword:    trigger.keyword,
      video_id:   trigger.video_id,
      replied,
      errors,
    });
  }

  return results;
}

// Exporta a função para uso direto pelo admin.js
module.exports.runBotCheck = runBotCheck;
module.exports.getAccessToken = getAccessToken;

// Handler HTTP (cron Vercel)
module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const cronSecret = process.env.CRON_SECRET;
  const provided   = req.headers['authorization']?.replace('Bearer ', '') || req.query.secret;
  if (cronSecret && provided !== cronSecret) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  if (!process.env.YOUTUBE_COMMENT_BOT_REFRESH_TOKEN) {
    return res.status(200).json({ ok: false, error: 'Bot não configurado — authorize via /api/yt-auth' });
  }

  try {
    const supabase     = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const accessToken  = await getAccessToken();
    const results      = await runBotCheck(supabase, accessToken);
    return res.status(200).json({ ok: true, ran_at: new Date().toISOString(), results });
  } catch (err) {
    console.error('❌ yt-comment-bot error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};

// Re-exporta após module.exports ser sobrescrito
module.exports.runBotCheck   = runBotCheck;
module.exports.getAccessToken = getAccessToken;
