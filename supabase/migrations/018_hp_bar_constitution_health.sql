-- HP bar health model.
-- Max HP = 4 x (base Constitution + Constitution bonuses from equipped items).

alter table public.items
add column if not exists constitution_bonus integer not null default 0;

alter table public.items
drop constraint if exists items_constitution_bonus_check;

alter table public.items
add constraint items_constitution_bonus_check
check (constitution_bonus >= 0 and constitution_bonus <= 999);

alter table public.characters
drop constraint if exists characters_max_health_check;

alter table public.characters
add constraint characters_max_health_check check (max_health >= 0);

update public.items
set effect = 'Restore 1 HP.'
where lower(trim(name)) = 'minor healing potion'
  and item_type = 'Consumable';

update public.loot_boxes
set preset_reward = jsonb_set(
  preset_reward,
  '{effect}',
  to_jsonb('Restore 1 HP.'::text),
  true
)
where preset_reward is not null
  and lower(trim(preset_reward->>'name')) = 'minor healing potion';

create or replace function public.recalculate_character_health(p_character_id uuid)
returns public.characters
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_char public.characters;
  v_base_constitution integer;
  v_gear_constitution integer;
  v_total_constitution integer;
  v_new_max integer;
  v_missing_hp integer;
begin
  select * into v_char
  from public.characters
  where id = p_character_id
  for update;

  if not found then raise exception 'character not found'; end if;

  v_base_constitution := greatest(0, coalesce((v_char.stats->>'Constitution')::integer, 0));

  select coalesce(sum(i.constitution_bonus),0)::integer
    into v_gear_constitution
  from public.character_items ci
  join public.items i on i.id=ci.item_id
  where ci.character_id=p_character_id
    and ci.equipped_slot is not null;

  v_total_constitution := greatest(0, v_base_constitution + v_gear_constitution);
  v_new_max := v_total_constitution * 4;
  v_missing_hp := greatest(0, v_char.max_health - v_char.current_health);

  update public.characters
  set max_health = v_new_max,
      current_health = greatest(0, least(v_new_max, v_new_max - v_missing_hp))
  where id=p_character_id
  returning * into v_char;

  return v_char;
end;
$function$;

revoke all on function public.recalculate_character_health(uuid) from public, anon, authenticated;

create or replace function public.complete_character_setup(
  p_character_id uuid,
  p_name text,
  p_background text,
  p_stats jsonb,
  p_starting_skill text
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  c public.characters;
  v_strength int;
  v_dexterity int;
  v_intelligence int;
  v_constitution int;
  v_charisma int;
  v_total int;
  v_health int;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into c from public.characters where id=p_character_id for update;
  if c.id is null or c.user_id<>auth.uid() then raise exception 'Not authorized'; end if;
  if c.setup_complete then raise exception 'Crawler setup is already complete'; end if;

  if length(trim(p_name)) < 1 or length(trim(p_name)) > 50 then raise exception 'Crawler name must be 1-50 characters'; end if;
  if length(trim(p_background)) < 1 or length(trim(p_background)) > 80 then raise exception 'Class must be 1-80 characters'; end if;
  if length(trim(p_starting_skill)) < 1 or length(trim(p_starting_skill)) > 60 then raise exception 'Starting skill must be 1-60 characters'; end if;

  begin
    v_strength := (p_stats->>'Strength')::int;
    v_dexterity := (p_stats->>'Dexterity')::int;
    v_intelligence := (p_stats->>'Intelligence')::int;
    v_constitution := (p_stats->>'Constitution')::int;
    v_charisma := (p_stats->>'Charisma')::int;
  exception when others then
    raise exception 'Invalid stat allocation';
  end;

  if v_strength < 0 or v_dexterity < 0 or v_intelligence < 0 or v_constitution < 0 or v_charisma < 0 then
    raise exception 'Starting stats cannot be negative';
  end if;

  v_total := v_strength + v_dexterity + v_intelligence + v_constitution + v_charisma;
  if v_total <> 8 then raise exception 'Distribute exactly 8 starting stat points'; end if;

  v_health := v_constitution * 4;

  update public.characters
  set name=trim(p_name),
      background=trim(p_background),
      stats=jsonb_build_object(
        'Strength',v_strength,
        'Dexterity',v_dexterity,
        'Intelligence',v_intelligence,
        'Constitution',v_constitution,
        'Charisma',v_charisma
      ),
      max_health=v_health,
      current_health=v_health,
      setup_complete=true
  where id=p_character_id;

  insert into public.skills(character_id,name,rank)
  values(p_character_id,trim(p_starting_skill),1)
  on conflict(character_id,name) do nothing;
end;
$function$;

create or replace function public.gm_adjust_stat(
  p_character_id uuid,
  p_stat text,
  p_delta integer
)
returns public.characters
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_char public.characters;
  v_current integer;
  v_new integer;
begin
  if p_delta=0 then raise exception 'delta cannot be zero'; end if;

  select * into v_char from public.characters where id=p_character_id for update;
  if not found then raise exception 'character not found'; end if;
  if not public.is_game_gm(v_char.game_id) then raise exception 'GM authorization required'; end if;
  if p_stat not in ('Strength','Dexterity','Intelligence','Constitution','Charisma') then raise exception 'invalid stat'; end if;

  v_current := coalesce((v_char.stats->>p_stat)::integer,0);
  v_new := v_current + p_delta;
  if v_new < 0 then raise exception 'stats cannot be negative'; end if;

  update public.characters
  set stats=jsonb_set(stats,array[p_stat],to_jsonb(v_new),true)
  where id=p_character_id;

  if p_stat='Constitution' then
    select * into v_char from public.recalculate_character_health(p_character_id);
  else
    select * into v_char from public.characters where id=p_character_id;
  end if;

  return v_char;
end;
$function$;

create or replace function public.spend_stat_point(
  p_character_id uuid,
  p_stat text
)
returns public.characters
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_char public.characters;
  v_current integer;
begin
  select * into v_char from public.characters where id=p_character_id for update;
  if not found then raise exception 'character not found'; end if;
  if v_char.user_id<>auth.uid() and not public.is_game_gm(v_char.game_id) then raise exception 'not authorized'; end if;
  if v_char.unspent_stat_points<1 then raise exception 'no unspent stat points'; end if;
  if p_stat not in ('Strength','Dexterity','Intelligence','Constitution','Charisma') then raise exception 'invalid stat'; end if;

  v_current := coalesce((v_char.stats->>p_stat)::integer,0);

  update public.characters
  set stats=jsonb_set(stats,array[p_stat],to_jsonb(v_current+1),true),
      unspent_stat_points=unspent_stat_points-1
  where id=p_character_id;

  if p_stat='Constitution' then
    select * into v_char from public.recalculate_character_health(p_character_id);
  else
    select * into v_char from public.characters where id=p_character_id;
  end if;

  return v_char;
end;
$function$;

create or replace function public.gm_grant_item(
  p_character_id uuid,
  p_name text,
  p_rarity public.item_rarity default 'B'::public.item_rarity,
  p_item_type text default 'Utility',
  p_slot text default null,
  p_effect text default '',
  p_quirk text default '',
  p_core_value integer default 0,
  p_quantity integer default 1,
  p_constitution_bonus integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_char public.characters;
  v_item_id uuid;
  v_character_item_id uuid;
begin
  if length(trim(coalesce(p_name,'')))<1 then raise exception 'item name is required'; end if;
  if p_quantity<1 or p_quantity>99 then raise exception 'quantity must be 1-99'; end if;
  if p_core_value<0 or p_core_value>999 then raise exception 'core value must be 0-999'; end if;
  if p_constitution_bonus<0 or p_constitution_bonus>999 then raise exception 'constitution bonus must be 0-999'; end if;

  select * into v_char from public.characters where id=p_character_id;
  if not found then raise exception 'character not found'; end if;
  if not public.is_game_gm(v_char.game_id) then raise exception 'GM authorization required'; end if;

  if p_item_type not in ('Weapon','Armor','Accessory','Consumable','Utility','Quest','AI Generated') then raise exception 'invalid item type'; end if;
  if p_slot is not null and p_slot not in ('Head','Body','Hands','Feet','Weapon 1','Weapon 2','Accessory 1','Accessory 2') then raise exception 'invalid equipment slot'; end if;

  insert into public.items(game_id,name,rarity,item_type,slot,effect,quirk,core_value,constitution_bonus,ai_generated)
  values(v_char.game_id,trim(p_name),p_rarity,p_item_type,p_slot,coalesce(p_effect,''),coalesce(p_quirk,''),p_core_value,p_constitution_bonus,false)
  returning id into v_item_id;

  insert into public.character_items(character_id,item_id,quantity,tradeable)
  values(p_character_id,v_item_id,p_quantity,true)
  returning id into v_character_item_id;

  return v_character_item_id;
end;
$function$;

create or replace function public.gm_adjust_item_constitution_bonus(
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
  v_character_id uuid;
begin
  if p_delta=0 or p_delta < -999 or p_delta > 999 then raise exception 'invalid delta'; end if;

  select c.game_id,ci.item_id,i.constitution_bonus
    into v_game_id,v_item_id,v_value
  from public.character_items ci
  join public.characters c on c.id=ci.character_id
  join public.items i on i.id=ci.item_id
  where ci.id=p_character_item_id
  for update of i;

  if v_game_id is null then raise exception 'inventory item not found'; end if;
  if not public.is_game_gm(v_game_id) then raise exception 'GM authorization required'; end if;

  v_value := greatest(0,least(999,v_value+p_delta));

  update public.items set constitution_bonus=v_value where id=v_item_id;

  for v_character_id in
    select distinct ci.character_id
    from public.character_items ci
    where ci.item_id=v_item_id and ci.equipped_slot is not null
  loop
    perform public.recalculate_character_health(v_character_id);
  end loop;

  return v_value;
end;
$function$;

revoke all on function public.gm_adjust_item_constitution_bonus(uuid,integer) from public, anon;
grant execute on function public.gm_adjust_item_constitution_bonus(uuid,integer) to authenticated;

create or replace function public.equip_character_item(
  p_character_item_id uuid,
  p_slot text
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_character_id uuid;
  v_user_id uuid;
  v_game_id uuid;
  v_item_slot text;
  v_requested_slot text := trim(coalesce(p_slot,''));
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if v_requested_slot not in ('Head','Body','Hands','Feet','Weapon 1','Weapon 2','Accessory 1','Accessory 2') then raise exception 'Invalid equipment slot'; end if;

  select ci.character_id,c.user_id,c.game_id,i.slot
    into v_character_id,v_user_id,v_game_id,v_item_slot
  from public.character_items ci
  join public.characters c on c.id=ci.character_id
  join public.items i on i.id=ci.item_id
  where ci.id=p_character_item_id
  for update of ci;

  if v_character_id is null then raise exception 'Item not found'; end if;
  if v_user_id<>auth.uid() and not public.is_game_gm(v_game_id) then raise exception 'Not authorized to equip this item'; end if;
  if v_item_slot is null then raise exception 'This item cannot be equipped'; end if;

  if v_item_slot in ('Weapon 1','Weapon 2') then
    if v_requested_slot not in ('Weapon 1','Weapon 2') then raise exception 'Weapon must use a weapon slot'; end if;
  elsif v_item_slot in ('Accessory 1','Accessory 2') then
    if v_requested_slot not in ('Accessory 1','Accessory 2') then raise exception 'Accessory must use an accessory slot'; end if;
  elsif v_requested_slot<>v_item_slot then
    raise exception 'Item cannot be equipped in that slot';
  end if;

  update public.character_items
  set equipped_slot=null
  where character_id=v_character_id
    and equipped_slot=v_requested_slot
    and id<>p_character_item_id;

  update public.character_items
  set equipped_slot=v_requested_slot
  where id=p_character_item_id;

  perform public.recalculate_character_health(v_character_id);
end;
$function$;

create or replace function public.unequip_character_item(
  p_character_item_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_character_id uuid;
  v_user_id uuid;
  v_game_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select ci.character_id,c.user_id,c.game_id
    into v_character_id,v_user_id,v_game_id
  from public.character_items ci
  join public.characters c on c.id=ci.character_id
  where ci.id=p_character_item_id;

  if v_game_id is null then raise exception 'Item not found'; end if;
  if v_user_id<>auth.uid() and not public.is_game_gm(v_game_id) then raise exception 'Not authorized to unequip this item'; end if;

  update public.character_items set equipped_slot=null where id=p_character_item_id;
  perform public.recalculate_character_health(v_character_id);
end;
$function$;

create or replace function public.gm_remove_character_item(p_character_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_game_id uuid;
  v_character_id uuid;
begin
  select c.game_id,ci.character_id into v_game_id,v_character_id
  from public.character_items ci
  join public.characters c on c.id=ci.character_id
  where ci.id=p_character_item_id;

  if v_game_id is null then raise exception 'inventory item not found'; end if;
  if not public.is_game_gm(v_game_id) then raise exception 'GM authorization required'; end if;

  delete from public.character_items where id=p_character_item_id;
  perform public.recalculate_character_health(v_character_id);
end;
$function$;

create or replace function public.gm_adjust_item_quantity(
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
  v_character_id uuid;
  v_qty integer;
begin
  if p_delta=0 or p_delta < -99 or p_delta > 99 then raise exception 'invalid delta'; end if;

  select c.game_id,ci.character_id,ci.quantity into v_game_id,v_character_id,v_qty
  from public.character_items ci
  join public.characters c on c.id=ci.character_id
  where ci.id=p_character_item_id
  for update;

  if v_game_id is null then raise exception 'inventory item not found'; end if;
  if not public.is_game_gm(v_game_id) then raise exception 'GM authorization required'; end if;

  v_qty := v_qty+p_delta;
  if v_qty<=0 then
    delete from public.character_items where id=p_character_item_id;
    perform public.recalculate_character_health(v_character_id);
    return 0;
  end if;

  update public.character_items set quantity=v_qty where id=p_character_item_id;
  return v_qty;
end;
$function$;

create or replace function public.use_character_item(p_character_item_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_character_item public.character_items;
  v_char public.characters;
  v_item public.items;
  v_heal_hp integer := 0;
  v_actual_heal integer := 0;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into v_character_item
  from public.character_items
  where id=p_character_item_id
  for update;

  if not found then raise exception 'Item not found'; end if;

  select * into v_char
  from public.characters
  where id=v_character_item.character_id
  for update;

  if not found or v_char.user_id<>auth.uid() then raise exception 'Not authorized to use this item'; end if;

  select * into v_item from public.items where id=v_character_item.item_id;
  if not found then raise exception 'Item definition not found'; end if;
  if v_item.item_type<>'Consumable' then raise exception 'This item is not consumable'; end if;

  if lower(v_item.name) like '%healing%' or lower(v_item.name) like '%heal%' then
    v_heal_hp := 1;
  else
    raise exception 'This consumable does not have an automated use effect yet';
  end if;

  if v_char.current_health>=v_char.max_health then raise exception 'You are already at full health'; end if;

  v_actual_heal := least(v_heal_hp,v_char.max_health-v_char.current_health);

  update public.characters
  set current_health=current_health+v_actual_heal
  where id=v_char.id;

  if v_character_item.quantity<=1 then
    delete from public.character_items where id=v_character_item.id;
  else
    update public.character_items
    set quantity=quantity-1
    where id=v_character_item.id;
  end if;

  return v_actual_heal;
end;
$function$;

do $$
declare v_id uuid;
begin
  for v_id in select id from public.characters loop
    perform public.recalculate_character_health(v_id);
  end loop;
end $$;
