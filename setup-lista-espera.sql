-- Tabela: Lista de Desistência EDA
-- Rodar no Supabase SQL Editor uma única vez

CREATE TABLE IF NOT EXISTS academyelite_lista_espera (
  id         uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  nome       text          NOT NULL,
  email      text          NOT NULL,
  whatsapp   text,
  q1         text,
  q2         text,
  q3         text,
  status     text          DEFAULT 'pendente',
  created_at timestamptz   DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_le_email   ON academyelite_lista_espera(email);
CREATE INDEX IF NOT EXISTS idx_le_created ON academyelite_lista_espera(created_at DESC);
