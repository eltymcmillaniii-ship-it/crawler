create or replace function public.gm_delete_player(p_character_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_game_id uuid;
  v_user_id uuid;
  v_role text;
begin
  select c.game_id, c.user_id
    into v_game_id, v_user_id
  from public.characters c
  where c.id = p_character_id
  for update;

  if v_game_id is null then
    raise exception 'character not found';
  end if;

  if not public.is_game_gm(v_game_id) then
    raise exception 'GM authorization required';
  end if;

  select gm.role
    into v_role
  from public.game_members gm
  where gm.game_id = v_game_id
    and gm.user_id = v_user_id;

  if v_role = 'gm' then
    raise exception 'cannot delete a GM';
  end if;

  delete from public.characters
  where id = p_character_id;

  delete from public.game_members
  where game_id = v_game_id
    and user_id = v_user_id
    and role = 'player';
end;
$function$;

revoke all on function public.gm_delete_player(uuid) from public;
grant execute on function public.gm_delete_player(uuid) to authenticated;
