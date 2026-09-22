create or replace function public.migrate_gm_identity(
  p_old_user_id uuid,
  p_new_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_owned integer;
begin
  if p_old_user_id is null or p_new_user_id is null or p_old_user_id = p_new_user_id then
    raise exception 'invalid user migration';
  end if;

  select count(*) into v_owned
  from public.games
  where created_by = p_old_user_id;

  if v_owned < 1 then
    raise exception 'Current user does not own any groups';
  end if;

  update public.games set created_by = p_new_user_id where created_by = p_old_user_id;
  update public.game_members set user_id = p_new_user_id where user_id = p_old_user_id;
  update public.characters set user_id = p_new_user_id where user_id = p_old_user_id;
  update public.dungeon_events set created_by = p_new_user_id where created_by = p_old_user_id;

  return v_owned;
end;
$function$;

revoke all on function public.migrate_gm_identity(uuid,uuid) from public, anon, authenticated;
grant execute on function public.migrate_gm_identity(uuid,uuid) to service_role;
