-- Tabela de convites Discord gerados para alunos do Academy Elite
create table if not exists discord_invites (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  name          text,
  invite_code   text not null,
  hotmart_order text,
  used          boolean default false,
  created_at    timestamptz default now()
);
