alter table public.items
  add column if not exists core_value integer not null default 0;

alter table public.items
  drop constraint if exists items_core_value_check;

alter table public.items
  add constraint items_core_value_check check (core_value >= 0);

alter table public.skills
  drop constraint if exists skills_rank_check;

alter table public.skills
  add constraint skills_rank_check check (rank >= 1);

drop function if exists public.gm_grant_item(uuid,text,public.item_rarity,text,text,text,text,integer);

create or replace function public.gm_grant_item(
  p_character_id uuid,
  p_name text,
  p_rarity public.item_rarity default 'B'::public.item_rarity,
  p_item_type text default 'Utility'::text,
  p_slot text default null::text,
  p_effect text default ''::text,
  p_quirk text default ''::text,
  p_core_value integer default 0,
  p_quantity integer default 1
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
  if length(trim(coalesce(p_name,''))) < 1 then raise exception 'item name is required'; end if;
  if p_quantity < 1 or p_quantity > 99 then raise exception 'quantity must be 1-99'; end if;
  if p_core_value < 0 or p_core_value > 999 then raise exception 'core value must be 0-999'; end if;

  select * into v_char from public.characters where id=p_character_id;
  if not found then raise exception 'character not found'; end if;
  if not public.is_game_gm(v_char.game_id) then raise exception 'GM authorization required'; end if;

  if p_item_type not in ('Weapon','Armor','Accessory','Consumable','Utility','Quest','AI Generated') then
    raise exception 'invalid item type';
  end if;

  if p_slot is not null and p_slot not in ('Head','Body','Hands','Feet','Weapon 1','Weapon 2','Accessory 1','Accessory 2') then
    raise exception 'invalid equipment slot';
  end if;

  insert into public.items(game_id,name,rarity,item_type,slot,effect,quirk,core_value,ai_generated)
  values(v_char.game_id,trim(p_name),p_rarity,p_item_type,p_slot,coalesce(p_effect,''),coalesce(p_quirk,''),p_core_value,false)
  returning id into v_item_id;

  insert into public.character_items(character_id,item_id,quantity,tradeable)
  values(p_character_id,v_item_id,p_quantity,true)
  returning id into v_character_item_id;

  return v_character_item_id;
end;
$function$;

create or replace function public.gm_set_skill(
  p_character_id uuid,
  p_name text,
  p_rank integer
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_game_id uuid;
begin
  select game_id into v_game_id
  from public.characters
  where id=p_character_id;

  if v_game_id is null then raise exception 'character not found'; end if;
  if not public.is_game_gm(v_game_id) then raise exception 'GM authorization required'; end if;
  if length(trim(coalesce(p_name,''))) < 1 then raise exception 'skill name is required'; end if;
  if p_rank < 0 or p_rank > 999 then raise exception 'skill level must be 0-999'; end if;

  if p_rank = 0 then
    delete from public.skills
    where character_id=p_character_id and lower(name)=lower(trim(p_name));
    return;
  end if;

  insert into public.skills(character_id,name,rank)
  values(p_character_id,trim(p_name),p_rank)
  on conflict(character_id,name)
  do update set rank=excluded.rank;
end;
$function$;

create or replace function public.gm_adjust_skill(
  p_character_id uuid,
  p_name text,
  p_delta integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_game_id uuid;
  v_rank integer;
  v_skill_name text;
begin
  if p_delta = 0 or p_delta < -99 or p_delta > 99 then raise exception 'invalid delta'; end if;

  select game_id into v_game_id
  from public.characters
  where id=p_character_id;

  if v_game_id is null then raise exception 'character not found'; end if;
  if not public.is_game_gm(v_game_id) then raise exception 'GM authorization required'; end if;

  select name, rank into v_skill_name, v_rank
  from public.skills
  where character_id=p_character_id and lower(name)=lower(trim(p_name))
  for update;

  if v_skill_name is null then raise exception 'skill not found'; end if;

  v_rank := v_rank + p_delta;
  if v_rank <= 0 then
    delete from public.skills
    where character_id=p_character_id and name=v_skill_name;
    return 0;
  end if;

  if v_rank > 999 then raise exception 'skill level must be 999 or lower'; end if;

  update public.skills
  set rank=v_rank
  where character_id=p_character_id and name=v_skill_name;

  return v_rank;
end;
$function$;

revoke all on function public.gm_grant_item(uuid,text,public.item_rarity,text,text,text,text,integer,integer) from public;
grant execute on function public.gm_grant_item(uuid,text,public.item_rarity,text,text,text,text,integer,integer) to authenticated;

revoke all on function public.gm_set_skill(uuid,text,integer) from public;
grant execute on function public.gm_set_skill(uuid,text,integer) to authenticated;

revoke all on function public.gm_adjust_skill(uuid,text,integer) from public;
grant execute on function public.gm_adjust_skill(uuid,text,integer) to authenticated;
