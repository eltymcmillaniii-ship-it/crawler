alter table public.loot_boxes
add column if not exists box_type text not null default 'standard';

alter table public.loot_boxes
drop constraint if exists loot_boxes_box_type_check;

alter table public.loot_boxes
add constraint loot_boxes_box_type_check
check (box_type in ('standard','healing','mystery','boss'));

create or replace function public.gm_quick_loot(
  p_game_id uuid,
  p_character_ids uuid[],
  p_box_type text,
  p_rarity public.item_rarity default null
)
returns uuid[]
language plpgsql
security definer
set search_path=public
as $function$
declare
  v_ids uuid[] := '{}';
  v_character_id uuid;
  v_character public.characters;
  v_floor integer := 1;
  v_rarity public.item_rarity;
  v_name text;
  v_roll double precision;
  v_progress integer;
  v_box_id uuid;
begin
  if auth.uid() is null or not public.is_game_gm(p_game_id) then
    raise exception 'GM authorization required';
  end if;

  if p_character_ids is null or cardinality(p_character_ids)=0 then
    raise exception 'Choose at least one crawler';
  end if;

  if cardinality(p_character_ids)>50 then
    raise exception 'Too many recipients';
  end if;

  if p_box_type not in ('standard','healing','mystery','boss') then
    raise exception 'Invalid quick loot box type';
  end if;

  select greatest(1,coalesce(floor_number,1))
    into v_floor
  from public.games
  where id=p_game_id;

  for v_character_id in select distinct unnest(p_character_ids) loop
    select * into v_character
    from public.characters
    where id=v_character_id and game_id=p_game_id;

    if not found then
      raise exception 'Crawler % is not in this game',v_character_id;
    end if;

    if p_box_type='boss' then
      v_rarity := 'G'::public.item_rarity;
      v_name := 'Boss Box of Excessive Expectations';
    elsif p_box_type='healing' then
      v_rarity := coalesce(p_rarity,'B'::public.item_rarity);
      v_name := case v_rarity
        when 'B'::public.item_rarity then 'Bronze Box of Questionable Medical Oversight'
        when 'S'::public.item_rarity then 'Silver Box of Suspicious Medical Oversight'
        else 'Gold Box of Alarmingly Expensive Medical Oversight'
      end;
    elsif p_box_type='mystery' then
      v_roll := random();
      v_progress := greatest(1,v_floor + coalesce(v_character.level,1));

      if v_roll < least(0.18,0.02+(v_progress*0.006)) then
        v_rarity := 'G'::public.item_rarity;
      elsif v_roll < least(0.62,0.24+(v_progress*0.016)) then
        v_rarity := 'S'::public.item_rarity;
      else
        v_rarity := 'B'::public.item_rarity;
      end if;

      v_name := case v_rarity
        when 'B'::public.item_rarity then 'Bronze Mystery Box of Administrative Ambiguity'
        when 'S'::public.item_rarity then 'Silver Mystery Box of Administrative Ambiguity'
        else 'Gold Mystery Box of Administrative Ambiguity'
      end;
    else
      if p_rarity is null then
        raise exception 'Standard quick loot requires a rarity';
      end if;
      v_rarity := p_rarity;
      v_name := case v_rarity
        when 'B'::public.item_rarity then 'Bronze Box of Questionable Contents'
        when 'S'::public.item_rarity then 'Silver Box of Suspicious Promise'
        else 'Gold Box of Unreasonable Expectations'
      end;
    end if;

    insert into public.loot_boxes(character_id,name,rarity,box_type)
    values(v_character_id,v_name,v_rarity,p_box_type)
    returning id into v_box_id;

    v_ids := array_append(v_ids,v_box_id);
  end loop;

  return v_ids;
end;
$function$;

revoke all on function public.gm_quick_loot(uuid,uuid[],text,public.item_rarity) from public,anon;
grant execute on function public.gm_quick_loot(uuid,uuid[],text,public.item_rarity) to authenticated;

create or replace function public.gm_undo_quick_loot(
  p_game_id uuid,
  p_box_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path=public
as $function$
declare
  v_expected integer;
  v_eligible integer;
  v_deleted integer;
begin
  if auth.uid() is null or not public.is_game_gm(p_game_id) then
    raise exception 'GM authorization required';
  end if;

  v_expected := cardinality(p_box_ids);
  if v_expected is null or v_expected=0 then return 0; end if;

  select count(*)
    into v_eligible
  from public.loot_boxes lb
  join public.characters c on c.id=lb.character_id
  where lb.id=any(p_box_ids)
    and c.game_id=p_game_id
    and lb.opened_at is null
    and lb.created_at > now()-interval '60 seconds';

  if v_eligible<>v_expected then
    raise exception 'Undo window expired or one of those boxes has already been opened';
  end if;

  delete from public.loot_boxes lb
  using public.characters c
  where lb.id=any(p_box_ids)
    and lb.character_id=c.id
    and c.game_id=p_game_id
    and lb.opened_at is null
    and lb.created_at > now()-interval '60 seconds';

  get diagnostics v_deleted=row_count;
  return v_deleted;
end;
$function$;

revoke all on function public.gm_undo_quick_loot(uuid,uuid[]) from public,anon;
grant execute on function public.gm_undo_quick_loot(uuid,uuid[]) to authenticated;
