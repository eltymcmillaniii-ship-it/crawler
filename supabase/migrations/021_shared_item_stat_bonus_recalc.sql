create or replace function public.gm_adjust_item_stat_bonus(
  p_character_item_id uuid,
  p_stat text,
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
  v_equipped_character_id uuid;
begin
  if p_delta=0 or p_delta < -999 or p_delta > 999 then raise exception 'invalid delta'; end if;
  if p_stat not in ('Strength','Dexterity','Intelligence','Constitution','Charisma') then raise exception 'invalid stat'; end if;

  select c.game_id,ci.item_id into v_game_id,v_item_id
  from public.character_items ci
  join public.characters c on c.id=ci.character_id
  where ci.id=p_character_item_id;

  if v_game_id is null then raise exception 'inventory item not found'; end if;
  if not public.is_game_gm(v_game_id) then raise exception 'GM authorization required'; end if;

  if p_stat='Strength' then
    update public.items set strength_bonus=greatest(0,least(999,strength_bonus+p_delta)) where id=v_item_id returning strength_bonus into v_value;
  elsif p_stat='Dexterity' then
    update public.items set dexterity_bonus=greatest(0,least(999,dexterity_bonus+p_delta)) where id=v_item_id returning dexterity_bonus into v_value;
  elsif p_stat='Intelligence' then
    update public.items set intelligence_bonus=greatest(0,least(999,intelligence_bonus+p_delta)) where id=v_item_id returning intelligence_bonus into v_value;
  elsif p_stat='Constitution' then
    update public.items set constitution_bonus=greatest(0,least(999,constitution_bonus+p_delta)) where id=v_item_id returning constitution_bonus into v_value;

    for v_equipped_character_id in
      select distinct ci.character_id
      from public.character_items ci
      where ci.item_id=v_item_id and ci.equipped_slot is not null
    loop
      perform public.recalculate_character_health(v_equipped_character_id);
    end loop;
  else
    update public.items set charisma_bonus=greatest(0,least(999,charisma_bonus+p_delta)) where id=v_item_id returning charisma_bonus into v_value;
  end if;

  return v_value;
end;
$function$;

revoke all on function public.gm_adjust_item_stat_bonus(uuid,text,integer) from public, anon;
grant execute on function public.gm_adjust_item_stat_bonus(uuid,text,integer) to authenticated;
