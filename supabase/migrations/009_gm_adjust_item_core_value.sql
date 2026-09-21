create or replace function public.gm_adjust_item_core_value(
  p_character_item_id uuid,
  p_delta integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_game_id uuid;
  v_item_id uuid;
  v_value integer;
begin
  if p_delta = 0 or p_delta < -999 or p_delta > 999 then
    raise exception 'invalid delta';
  end if;

  select c.game_id, ci.item_id, i.core_value
    into v_game_id, v_item_id, v_value
  from public.character_items ci
  join public.characters c on c.id = ci.character_id
  join public.items i on i.id = ci.item_id
  where ci.id = p_character_item_id
  for update of i;

  if v_game_id is null then raise exception 'inventory item not found'; end if;
  if not public.is_game_gm(v_game_id) then raise exception 'GM authorization required'; end if;

  v_value := greatest(0, least(999, v_value + p_delta));

  update public.items
  set core_value = v_value
  where id = v_item_id;

  return v_value;
end;
$function$;

revoke all on function public.gm_adjust_item_core_value(uuid,integer) from public;
grant execute on function public.gm_adjust_item_core_value(uuid,integer) to authenticated;
