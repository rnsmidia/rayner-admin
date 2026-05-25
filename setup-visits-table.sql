-- Rodar uma única vez no Supabase SQL Editor
-- https://supabase.com → seu projeto → SQL Editor → New query → colar e rodar

CREATE TABLE IF NOT EXISTS page_visits (
  id         bigserial PRIMARY KEY,
  video      text        NOT NULL DEFAULT 'direct',
  created_at timestamptz NOT NULL DEFAULT now()
);
