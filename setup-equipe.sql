-- Painel Equipe — Demandas & Produtividade
-- Execute em: https://supabase.com/dashboard/project/innjzuceegsoffadikon/sql/new

create table if not exists equipe_tarefas (
  id           uuid primary key default gen_random_uuid(),
  titulo       text not null,
  descricao    text,                              -- o que fazer + critério de conclusão
  responsaveis text[] not null default '{}',      -- ['rayner','marcos','jaqueline'] (1+)
  status       text not null default 'a_fazer',   -- a_fazer | em_andamento | aguardando | concluido
  prioridade   text not null default 'media',     -- alta | media | baixa
  prazo        date,
  area         text,                              -- Financeiro/Operacional/Atendimento/livre
  bloqueio     text,                              -- texto livre opcional (o que trava a tarefa)
  criado_por   text,                              -- nome do admin que criou
  ordem        int  default 0,                    -- ordenação dentro da coluna do Kanban
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  concluido_em timestamptz                        -- setado ao virar "concluido" (p/ tempo médio)
);

create index if not exists equipe_tarefas_status_idx on equipe_tarefas(status);
create index if not exists equipe_tarefas_prazo_idx  on equipe_tarefas(prazo);
create index if not exists equipe_tarefas_resp_idx   on equipe_tarefas using gin(responsaveis);
