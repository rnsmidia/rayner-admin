-- Meta-Prompts: tabelas de aulas e prompts
-- Execute em: https://supabase.com/dashboard/project/innjzuceegsoffadikon/sql/new

CREATE TABLE IF NOT EXISTS meta_classes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  class_date  date NOT NULL,
  description text,
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meta_prompts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id    uuid REFERENCES meta_classes(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text NOT NULL,
  prompt_text text NOT NULL,
  tags        text[] DEFAULT '{}',
  order_index int  DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meta_prompts_class_id_idx ON meta_prompts(class_id);
CREATE INDEX IF NOT EXISTS meta_classes_date_idx ON meta_classes(class_date DESC);
