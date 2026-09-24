-- One persistent active encounter per game. Enemy health uses displayed HP,
-- including quarter points (player health internally uses a different unit).
create table public.encounter_enemies (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  max_hp numeric not null check (max_hp between 0.25 and 999 and mod(max_hp,0.25)=0),
  current_hp numeric not null check (current_hp >= 0 and current_hp <= max_hp and mod(current_hp,0.25)=0),
  notes text not null default '' check (length(notes)<=500),
  created_at timestamptz not null default now()
);
create index encounter_enemies_game_idx on public.encounter_enemies(game_id,created_at);
alter table public.encounter_enemies enable row level security;
revoke all on public.encounter_enemies from anon;
grant select,insert,update,delete on public.encounter_enemies to authenticated;
create policy encounter_gm_access on public.encounter_enemies
  for all to authenticated
  using ((select auth.uid()) is not null and public.is_game_gm(game_id))
  with check ((select auth.uid()) is not null and public.is_game_gm(game_id));

-- Delta updates execute atomically under RLS, preventing lost damage updates
-- when two GM devices control the same encounter.
create function public.gm_adjust_enemy_hp(p_enemy_id uuid,p_delta numeric)
returns public.encounter_enemies
language plpgsql security invoker set search_path = ''
as $$
declare v_enemy public.encounter_enemies;
begin
  if p_delta is null or p_delta not between -999 and 999 or mod(p_delta,0.25)<>0 then
    raise exception 'HP adjustment must be between -999 and 999 in quarter points';
  end if;
  update public.encounter_enemies
  set current_hp=greatest(0,least(max_hp,current_hp+p_delta))
  where id=p_enemy_id returning * into v_enemy;
  if not found then raise exception 'Enemy not found or GM access required'; end if;
  return v_enemy;
end;
$$;
revoke all on function public.gm_adjust_enemy_hp(uuid,numeric) from public,anon;
grant execute on function public.gm_adjust_enemy_hp(uuid,numeric) to authenticated;
alter publication supabase_realtime add table public.encounter_enemies;
