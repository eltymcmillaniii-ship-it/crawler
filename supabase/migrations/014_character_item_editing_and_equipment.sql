create or replace function public.rename_character(
  p_character_id uuid,
  p_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_game_id uuid;
  v_user_id uuid;
  v_name text := trim(coalesce(p_name,''));
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if length(v_name) < 1 or length(v_name) > 50 then raise exception 'Crawler name must be between 1 and 50 characters'; end if;

  select game_id,user_id into v_game_id,v_user_id
  from public.characters
  where id=p_character_id;

  if v_game_id is null then raise exception 'Crawler not found'; end if;
  if v_user_id <> auth.uid() and not public.is_game_gm(v_game_id) then raise exception 'Not authorized to rename this crawler'; end if;

  update public.characters set name=v_name where id=p_character_id;
end;
$function$;

revoke all on function public.rename_character(uuid,text) from public, anon;
grant execute on function public.rename_character(uuid,text) to authenticated;

create or replace function public.gm_rename_item(
  p_character_item_id uuid,
  p_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_item_id uuid;
  v_game_id uuid;
  v_name text := trim(coalesce(p_name,''));
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if length(v_name) < 1 or length(v_name) > 100 then raise exception 'Item name must be between 1 and 100 characters'; end if;

  select ci.item_id,c.game_id into v_item_id,v_game_id
  from public.character_items ci
  join public.characters c on c.id=ci.character_id
  where ci.id=p_character_item_id;

  if v_item_id is null or v_game_id is null then raise exception 'Item not found'; end if;
  if not public.is_game_gm(v_game_id) then raise exception 'GM authorization required'; end if;

  update public.items set name=v_name where id=v_item_id and game_id=v_game_id;
end;
$function$;

revoke all on function public.gm_rename_item(uuid,text) from public, anon;
grant execute on function public.gm_rename_item(uuid,text) to authenticated;

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

  if v_requested_slot not in ('Head','Body','Hands','Feet','Weapon 1','Weapon 2','Accessory 1','Accessory 2') then
    raise exception 'Invalid equipment slot';
  end if;

  select ci.character_id,c.user_id,c.game_id,i.slot
    into v_character_id,v_user_id,v_game_id,v_item_slot
  from public.character_items ci
  join public.characters c on c.id=ci.character_id
  join public.items i on i.id=ci.item_id
  where ci.id=p_character_item_id
  for update of ci;

  if v_character_id is null then raise exception 'Item not found'; end if;
  if v_user_id <> auth.uid() and not public.is_game_gm(v_game_id) then raise exception 'Not authorized to equip this item'; end if;
  if v_item_slot is null then raise exception 'This item cannot be equipped'; end if;

  if v_item_slot in ('Weapon 1','Weapon 2') then
    if v_requested_slot not in ('Weapon 1','Weapon 2') then raise exception 'Weapon must use a weapon slot'; end if;
  elsif v_item_slot in ('Accessory 1','Accessory 2') then
    if v_requested_slot not in ('Accessory 1','Accessory 2') then raise exception 'Accessory must use an accessory slot'; end if;
  elsif v_requested_slot <> v_item_slot then
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
end;
$function$;

revoke all on function public.equip_character_item(uuid,text) from public, anon;
grant execute on function public.equip_character_item(uuid,text) to authenticated;

create or replace function public.unequip_character_item(
  p_character_item_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user_id uuid;
  v_game_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select c.user_id,c.game_id into v_user_id,v_game_id
  from public.character_items ci
  join public.characters c on c.id=ci.character_id
  where ci.id=p_character_item_id;

  if v_game_id is null then raise exception 'Item not found'; end if;
  if v_user_id <> auth.uid() and not public.is_game_gm(v_game_id) then raise exception 'Not authorized to unequip this item'; end if;

  update public.character_items set equipped_slot=null where id=p_character_item_id;
end;
$function$;

revoke all on function public.unequip_character_item(uuid) from public, anon;
grant execute on function public.unequip_character_item(uuid) to authenticated;

drop policy if exists items_game_member_select on public.items;
create policy items_game_member_select
on public.items
for select
to authenticated
using (
  exists (
    select 1
    from public.game_members m
    where m.game_id = items.game_id
      and m.user_id = auth.uid()
  )
);
