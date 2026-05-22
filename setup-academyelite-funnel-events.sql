-- Tabela: rastrear eventos do funil Elite Dark Academy
create table if not exists academyelite_funnel_events (
  id         bigint generated always as identity primary key,
  session_id text        not null,
  event      text        not null,
  step       int,
  answer     text,
  created_at timestamptz default now()
);

-- Índice para consultas por sessão e por evento
create index if not exists idx_funnel_session  on academyelite_funnel_events (session_id);
create index if not exists idx_funnel_event    on academyelite_funnel_events (event);
create index if not exists idx_funnel_created  on academyelite_funnel_events (created_at desc);

-- RLS — acesso apenas via service key
alter table academyelite_funnel_events enable row level security;
