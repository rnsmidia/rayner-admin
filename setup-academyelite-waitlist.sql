-- Tabela: Elite Dark Academy VIP Waitlist
create table if not exists academyelite_waitlist (
  id         bigint generated always as identity primary key,
  nome       text not null,
  email      text not null,
  whatsapp   text,
  created_at timestamptz default now()
);

-- Índice único para evitar duplicados de e-mail
create unique index if not exists uq_academyelite_email
  on academyelite_waitlist (lower(email));

-- RLS (Row Level Security) — acesso apenas via service key
alter table academyelite_waitlist enable row level security;
