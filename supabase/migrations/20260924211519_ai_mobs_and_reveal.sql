-- AI-generated mobs/bosses plus a capability-token player reveal screen.
alter table public.encounter_enemies
  add column level integer not null default 1 check (level between 1 and 99),
  add column enemy_kind text not null default 'mob' check (enemy_kind in ('mob','boss')),
  add column abilities jsonb not null default '[]'::jsonb check (jsonb_typeof(abilities)='array' and jsonb_array_length(abilities)<=6),
  add column entrance text not null default '' check (length(entrance)<=600),
  add column image_prompt text not null default '' check (length(image_prompt)<=3000),
  add column image_path text,
  add column image_status text not null default 'none' check (image_status in ('none','generating','ready','error')),
  add column image_error text not null default '',
  add column image_job uuid,
  add column image_started_at timestamptz;

create table public.encounter_displays (
  game_id uuid primary key references public.games(id) on delete cascade,
  display_token uuid not null unique default gen_random_uuid(),
  enemy_id uuid references public.encounter_enemies(id) on delete set null,
  reveal_id uuid not null default gen_random_uuid()
);

alter table public.encounter_displays enable row level security;
revoke all on public.encounter_displays from anon;
grant select,insert,update,delete on public.encounter_displays to authenticated;
create policy display_gm_access on public.encounter_displays
  for all to authenticated
  using ((select auth.uid()) is not null and public.is_game_gm(game_id))
  with check ((select auth.uid()) is not null and public.is_game_gm(game_id));

create function public.gm_reveal_enemy(p_game_id uuid,p_enemy_id uuid)
returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  if not public.is_game_gm(p_game_id) then raise exception 'GM access required'; end if;
  if p_enemy_id is not null and not exists (
    select 1 from public.encounter_enemies where id=p_enemy_id and game_id=p_game_id
      and image_status='ready' and image_path is not null
  ) then raise exception 'Wait for the enemy image before revealing'; end if;
  insert into public.encounter_displays(game_id,enemy_id) values(p_game_id,p_enemy_id)
  on conflict(game_id) do update set enemy_id=excluded.enemy_id,reveal_id=gen_random_uuid();
end;
$$;
revoke all on function public.gm_reveal_enemy(uuid,uuid) from public,anon;
grant execute on function public.gm_reveal_enemy(uuid,uuid) to authenticated;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('enemy-art','enemy-art',false,10485760,array['image/webp','image/png','image/jpeg'])
on conflict (id) do nothing;
