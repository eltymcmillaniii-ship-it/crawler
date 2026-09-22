create or replace function public.list_party_members(p_game_id uuid)
returns table (
  id uuid,
  name text,
  class_name text,
  portrait_url text,
  level integer
)
language sql
security definer
set search_path = public
as $function$
  select c.id, c.name, c.background as class_name, c.portrait_url, c.level
  from public.characters c
  where c.game_id = p_game_id
    and exists (
      select 1
      from public.game_members gm
      where gm.game_id = p_game_id
        and gm.user_id = auth.uid()
    )
  order by c.created_at, c.name;
$function$;

revoke all on function public.list_party_members(uuid) from public, anon;
grant execute on function public.list_party_members(uuid) to authenticated;
