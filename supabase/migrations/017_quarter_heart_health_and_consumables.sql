-- Health is now stored as integer quarter-heart units.
-- Existing character health values were whole hearts, so convert them once.
update public.characters
set current_health = current_health * 4,
    max_health = max_health * 4;

update public.items
set effect = 'Restore 1 health quadrant (¼ heart).'
where lower(trim(name)) = 'minor healing potion'
  and item_type = 'Consumable';

update public.loot_boxes
set preset_reward = jsonb_set(
  preset_reward,
  '{effect}',
  to_jsonb('Restore 1 health quadrant (¼ heart).'::text),
  true
)
where preset_reward is not null
  and lower(trim(preset_reward->>'name')) = 'minor healing potion';

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
  v_health_quarters int;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into c
  from public.characters
  where id = p_character_id
  for update;

  if c.id is null or c.user_id <> auth.uid() then
    raise exception 'Not authorized';
  end if;

  if c.setup_complete then
    raise exception 'Crawler setup is already complete';
  end if;

  if length(trim(p_name)) < 1 or length(trim(p_name)) > 50 then
    raise exception 'Crawler name must be 1-50 characters';
  end if;

  if length(trim(p_background)) < 1 or length(trim(p_background)) > 80 then
    raise exception 'Class must be 1-80 characters';
  end if;

  if length(trim(p_starting_skill)) < 1 or length(trim(p_starting_skill)) > 60 then
    raise exception 'Starting skill must be 1-60 characters';
  end if;

  begin
    v_strength := (p_stats->>'Strength')::int;
    v_dexterity := (p_stats->>'Dexterity')::int;
    v_intelligence := (p_stats->>'Intelligence')::int;
    v_constitution := (p_stats->>'Constitution')::int;
    v_charisma := (p_stats->>'Charisma')::int;
  exception when others then
    raise exception 'Invalid stat allocation';
  end;

  if v_strength < 0
     or v_dexterity < 0
     or v_intelligence < 0
     or v_constitution < 0
     or v_charisma < 0 then
    raise exception 'Starting stats cannot be negative';
  end if;

  v_total := v_strength + v_dexterity + v_intelligence + v_constitution + v_charisma;

  if v_total <> 8 then
    raise exception 'Distribute exactly 8 starting stat points';
  end if;

  v_health_quarters := (6 + v_constitution) * 4;

  update public.characters
  set name = trim(p_name),
      background = trim(p_background),
      stats = jsonb_build_object(
        'Strength', v_strength,
        'Dexterity', v_dexterity,
        'Intelligence', v_intelligence,
        'Constitution', v_constitution,
        'Charisma', v_charisma
      ),
      max_health = v_health_quarters,
      current_health = v_health_quarters,
      setup_complete = true
  where id = p_character_id;

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
  v_health_delta integer;
  v_new_max_health integer;
begin
  if p_delta = 0 then raise exception 'delta cannot be zero'; end if;

  select * into v_char from public.characters where id = p_character_id for update;
  if not found then raise exception 'character not found'; end if;
  if not public.is_game_gm(v_char.game_id) then raise exception 'GM authorization required'; end if;
  if p_stat not in ('Strength','Dexterity','Intelligence','Constitution','Charisma') then
    raise exception 'invalid stat';
  end if;

  v_current := coalesce((v_char.stats ->> p_stat)::integer, 0);
  v_new := v_current + p_delta;

  if v_new < 0 then raise exception 'stats cannot be negative'; end if;

  if p_stat='Constitution' then
    v_health_delta := p_delta * 4;
    v_new_max_health := greatest(4, v_char.max_health + v_health_delta);
  else
    v_health_delta := 0;
    v_new_max_health := v_char.max_health;
  end if;

  update public.characters
  set stats = jsonb_set(stats, array[p_stat], to_jsonb(v_new), true),
      max_health = v_new_max_health,
      current_health = case
        when p_stat='Constitution' then greatest(0, least(v_new_max_health, current_health + v_health_delta))
        else current_health
      end
  where id = p_character_id
  returning * into v_char;

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
  select * into v_char from public.characters where id = p_character_id for update;
  if not found then raise exception 'character not found'; end if;
  if v_char.user_id <> auth.uid() and not public.is_game_gm(v_char.game_id) then
    raise exception 'not authorized';
  end if;
  if v_char.unspent_stat_points < 1 then raise exception 'no unspent stat points'; end if;
  if p_stat not in ('Strength','Dexterity','Intelligence','Constitution','Charisma') then
    raise exception 'invalid stat';
  end if;

  v_current := coalesce((v_char.stats ->> p_stat)::integer, 0);

  update public.characters
  set stats = jsonb_set(stats, array[p_stat], to_jsonb(v_current + 1), true),
      unspent_stat_points = unspent_stat_points - 1,
      max_health = case when p_stat='Constitution' then max_health + 4 else max_health end,
      current_health = case when p_stat='Constitution' then current_health + 4 else current_health end
  where id = p_character_id
  returning * into v_char;

  return v_char;
end;
$function$;

create or replace function public.gm_adjust_health(
  p_character_id uuid,
  p_quarters integer
)
returns public.characters
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_char public.characters;
begin
  if p_quarters = 0 then raise exception 'health adjustment cannot be zero'; end if;

  select * into v_char
  from public.characters
  where id = p_character_id
  for update;

  if not found then raise exception 'character not found'; end if;
  if not public.is_game_gm(v_char.game_id) then raise exception 'GM authorization required'; end if;

  update public.characters
  set current_health = greatest(0, least(max_health, current_health + p_quarters))
  where id = p_character_id
  returning * into v_char;

  return v_char;
end;
$function$;

revoke all on function public.gm_adjust_health(uuid,integer) from public, anon;
grant execute on function public.gm_adjust_health(uuid,integer) to authenticated;

create or replace function public.use_character_item(
  p_character_item_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_character_item public.character_items;
  v_char public.characters;
  v_item public.items;
  v_heal_quarters integer := 0;
  v_actual_heal integer := 0;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into v_character_item
  from public.character_items
  where id = p_character_item_id
  for update;

  if not found then raise exception 'Item not found'; end if;

  select * into v_char
  from public.characters
  where id = v_character_item.character_id
  for update;

  if not found or v_char.user_id <> auth.uid() then
    raise exception 'Not authorized to use this item';
  end if;

  select * into v_item
  from public.items
  where id = v_character_item.item_id;

  if not found then raise exception 'Item definition not found'; end if;
  if v_item.item_type <> 'Consumable' then raise exception 'This item is not consumable'; end if;

  if (
    lower(v_item.name) like '%healing%'
    or lower(v_item.name) like '%heal%'
  ) and (
    lower(coalesce(v_item.effect,'')) like '%health%'
    or lower(coalesce(v_item.effect,'')) like '%heal%'
  ) then
    v_heal_quarters := 1;
  else
    raise exception 'This consumable does not have an automated use effect yet';
  end if;

  if v_char.current_health >= v_char.max_health then
    raise exception 'You are already at full health';
  end if;

  v_actual_heal := least(v_heal_quarters, v_char.max_health - v_char.current_health);

  update public.characters
  set current_health = current_health + v_actual_heal
  where id = v_char.id;

  if v_character_item.quantity <= 1 then
    delete from public.character_items
    where id = v_character_item.id;
  else
    update public.character_items
    set quantity = quantity - 1
    where id = v_character_item.id;
  end if;

  return v_actual_heal;
end;
$function$;

revoke all on function public.use_character_item(uuid) from public, anon;
grant execute on function public.use_character_item(uuid) to authenticated;
