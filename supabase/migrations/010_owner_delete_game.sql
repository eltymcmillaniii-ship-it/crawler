create or replace function public.delete_game(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_created_by uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select created_by
    into v_created_by
  from public.games
  where id = p_game_id
  for update;

  if v_created_by is null then
    raise exception 'game not found';
  end if;

  if v_created_by <> auth.uid() then
    raise exception 'Only the group owner can delete this game';
  end if;

  delete from public.games
  where id = p_game_id;
end;
$function$;

revoke all on function public.delete_game(uuid) from public;
grant execute on function public.delete_game(uuid) to authenticated;
