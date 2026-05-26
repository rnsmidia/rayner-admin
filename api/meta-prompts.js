const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');

  const { data: classes, error } = await supabase
    .from('meta_classes')
    .select(`
      id, title, class_date, description, created_at,
      meta_prompts (
        id, name, description, prompt_text, tags, order_index
      )
    `)
    .order('class_date', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  classes.forEach(c => {
    c.meta_prompts = (c.meta_prompts || []).sort((a, b) => a.order_index - b.order_index);
  });

  return res.status(200).json(classes);
};
