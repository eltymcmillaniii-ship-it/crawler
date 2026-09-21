create table if not exists public.edge_function_errors (
  id bigint generated always as identity primary key,
  function_name text not null,
  game_id uuid null references public.games(id) on delete cascade,
  error_message text not null,
  created_at timestamptz not null default now()
);

alter table public.edge_function_errors enable row level security;

revoke all on table public.edge_function_errors from anon, authenticated;
