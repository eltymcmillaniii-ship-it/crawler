-- Replace the single Body slot with separate Shirt and Pants slots.
-- Existing Body equipment is migrated to Shirt.

update public.items set slot='Shirt' where slot='Body';
update public.character_items set equipped_slot='Shirt' where equipped_slot='Body';

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
  if v_requested_slot not in ('Head','Shirt','Pants','Hands','Feet','Weapon 1','Weapon 2','Accessory 1','Accessory 2') then
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
  if v_user_id<>auth.uid() and not public.is_game_gm(v_game_id) then
    raise exception 'Not authorized to equip this item';
  end if;
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

create or replace function public.gm_grant_item(
  p_character_id uuid,
  p_name text,
  p_rarity public.item_rarity default 'B'::public.item_rarity,
  p_item_type text default 'Utility',
  p_slot text default null,
  p_effect text default '',
  p_quirk text default '',
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
  if length(trim(coalesce(p_name,'')))<1 then raise exception 'item name is required'; end if;
  if p_quantity<1 or p_quantity>99 then raise exception 'quantity must be 1-99'; end if;
  if p_core_value<0 or p_core_value>999 then raise exception 'core value must be 0-999'; end if;

  select * into v_char from public.characters where id=p_character_id;
  if not found then raise exception 'character not found'; end if;
  if not public.is_game_gm(v_char.game_id) then raise exception 'GM authorization required'; end if;

  if p_item_type not in ('Weapon','Armor','Accessory','Consumable','Utility','Quest','AI Generated') then
    raise exception 'invalid item type';
  end if;
  if p_slot is not null and p_slot not in ('Head','Shirt','Pants','Hands','Feet','Weapon 1','Weapon 2','Accessory 1','Accessory 2') then
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
  p_strength_bonus integer default 0,
  p_dexterity_bonus integer default 0,
  p_intelligence_bonus integer default 0,
  p_constitution_bonus integer default 0,
  p_charisma_bonus integer default 0
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
  if p_strength_bonus not between 0 and 999
     or p_dexterity_bonus not between 0 and 999
     or p_intelligence_bonus not between 0 and 999
     or p_constitution_bonus not between 0 and 999
     or p_charisma_bonus not between 0 and 999 then
    raise exception 'stat bonuses must be 0-999';
  end if;

  select * into v_char from public.characters where id=p_character_id;
  if not found then raise exception 'character not found'; end if;
  if not public.is_game_gm(v_char.game_id) then raise exception 'GM authorization required'; end if;

  if p_item_type not in ('Weapon','Armor','Accessory','Consumable','Utility','Quest','AI Generated') then raise exception 'invalid item type'; end if;
  if p_slot is not null and p_slot not in ('Head','Shirt','Pants','Hands','Feet','Weapon 1','Weapon 2','Accessory 1','Accessory 2') then
    raise exception 'invalid equipment slot';
  end if;

  insert into public.items(
    game_id,name,rarity,item_type,slot,effect,quirk,core_value,
    strength_bonus,dexterity_bonus,intelligence_bonus,constitution_bonus,charisma_bonus,
    ai_generated
  )
  values(
    v_char.game_id,trim(p_name),p_rarity,p_item_type,p_slot,coalesce(p_effect,''),coalesce(p_quirk,''),p_core_value,
    p_strength_bonus,p_dexterity_bonus,p_intelligence_bonus,p_constitution_bonus,p_charisma_bonus,false
  )
  returning id into v_item_id;

  insert into public.character_items(character_id,item_id,quantity,tradeable)
  values(p_character_id,v_item_id,p_quantity,true)
  returning id into v_character_item_id;

  return v_character_item_id;
end;
$function$;

create or replace function public.complete_loot_box_open(p_box_id uuid,p_user_id uuid,p_reward jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  b public.loot_boxes;
  c public.characters;
  v_item uuid;
  v_character_item uuid;
  v_type text;
  v_slot text;
  v_bonuses jsonb := coalesce(p_reward->'stat_bonuses','{}'::jsonb);
  v_str integer := greatest(0,least(999,coalesce((v_bonuses->>'Strength')::integer,0)));
  v_dex integer := greatest(0,least(999,coalesce((v_bonuses->>'Dexterity')::integer,0)));
  v_int integer := greatest(0,least(999,coalesce((v_bonuses->>'Intelligence')::integer,0)));
  v_con integer := greatest(0,least(999,coalesce((v_bonuses->>'Constitution')::integer,0)));
  v_cha integer := greatest(0,least(999,coalesce((v_bonuses->>'Charisma')::integer,0)));
begin
  select * into b from public.loot_boxes where id=p_box_id for update;
  if b.id is null then raise exception 'Loot box not found'; end if;
  if b.opened_at is not null then raise exception 'Loot box is already open'; end if;

  select * into c from public.characters where id=b.character_id;
  if c.user_id<>p_user_id then raise exception 'Loot box does not belong to this user'; end if;

  v_type := coalesce(nullif(p_reward->>'item_type',''),'AI Generated');
  if v_type not in ('Weapon','Armor','Accessory','Consumable','Utility','Quest','AI Generated') then v_type := 'AI Generated'; end if;
  v_slot := nullif(p_reward->>'slot','');
  if v_slot is not null and v_slot not in ('Head','Shirt','Pants','Hands','Feet','Weapon 1','Weapon 2','Accessory 1','Accessory 2') then v_slot := null; end if;

  insert into public.items(
    game_id,name,rarity,item_type,slot,effect,quirk,
    strength_bonus,dexterity_bonus,intelligence_bonus,constitution_bonus,charisma_bonus,
    ai_generated
  )
  values(
    c.game_id,coalesce(nullif(trim(p_reward->>'name'),''),'Unidentified Dungeon Object'),b.rarity,v_type,v_slot,
    coalesce(p_reward->>'effect',''),coalesce(p_reward->>'quirk',''),
    v_str,v_dex,v_int,v_con,v_cha,true
  )
  returning id into v_item;

  insert into public.character_items(character_id,item_id,quantity)
  values(c.id,v_item,1)
  returning id into v_character_item;

  update public.loot_boxes set opened_at=now() where id=b.id;
  return v_character_item;
end;
$function$;

create or replace function public.apply_dungeon_verdict(p_game_id uuid,p_event_text text,p_verdict jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_event_id uuid;
  v_recipient_text text;
  v_recipient uuid;
  v_kind text := coalesce(p_verdict #>> '{reward,kind}','none');
  v_rarity_text text := coalesce(p_verdict #>> '{reward,rarity}','none');
  v_reward_name text := coalesce(p_verdict #>> '{reward,name}','');
  v_reward_effect text := coalesce(p_verdict #>> '{reward,effect}','');
  v_reward_quirk text := coalesce(p_verdict #>> '{reward,quirk}','');
  v_item_type text := coalesce(nullif(p_verdict #>> '{reward,item_type}',''),'AI Generated');
  v_slot text := nullif(p_verdict #>> '{reward,slot}','');
  v_bonuses jsonb := coalesce(p_verdict #> '{reward,stat_bonuses}','{}'::jsonb);
  v_str integer := greatest(0,least(999,coalesce((v_bonuses->>'Strength')::integer,0)));
  v_dex integer := greatest(0,least(999,coalesce((v_bonuses->>'Dexterity')::integer,0)));
  v_int integer := greatest(0,least(999,coalesce((v_bonuses->>'Intelligence')::integer,0)));
  v_con integer := greatest(0,least(999,coalesce((v_bonuses->>'Constitution')::integer,0)));
  v_cha integer := greatest(0,least(999,coalesce((v_bonuses->>'Charisma')::integer,0)));
  v_item_id uuid;
begin
  if auth.uid() is null or not public.is_game_gm(p_game_id) then raise exception 'GM authorization required'; end if;

  insert into public.dungeon_events(game_id,created_by,event_text,ai_verdict,applied)
  values(p_game_id,auth.uid(),p_event_text,p_verdict,true)
  returning id into v_event_id;

  if v_item_type not in ('Weapon','Armor','Accessory','Consumable','Utility','Quest','AI Generated') then v_item_type := 'AI Generated'; end if;
  if v_slot is not null and v_slot not in ('Head','Shirt','Pants','Hands','Feet','Weapon 1','Weapon 2','Accessory 1','Accessory 2') then v_slot := null; end if;

  if v_kind='item' and v_rarity_text in ('B','S','G') then
    insert into public.items(
      game_id,name,rarity,item_type,slot,effect,quirk,
      strength_bonus,dexterity_bonus,intelligence_bonus,constitution_bonus,charisma_bonus,
      ai_generated
    )
    values(
      p_game_id,coalesce(nullif(v_reward_name,''),'Dungeon Reward'),v_rarity_text::public.item_rarity,
      v_item_type,v_slot,v_reward_effect,v_reward_quirk,
      v_str,v_dex,v_int,v_con,v_cha,true
    )
    returning id into v_item_id;
  end if;

  for v_recipient_text in select value from jsonb_array_elements_text(coalesce(p_verdict->'recipients','[]'::jsonb)) loop
    begin v_recipient:=v_recipient_text::uuid; exception when invalid_text_representation then continue; end;
    if not exists(select 1 from public.characters c where c.id=v_recipient and c.game_id=p_game_id) then continue; end if;

    if jsonb_typeof(p_verdict->'achievement')='object' then
      insert into public.achievements(character_id,title,commentary)
      values(v_recipient,coalesce(nullif(p_verdict #>> '{achievement,title}',''),'New Achievement'),coalesce(p_verdict #>> '{achievement,commentary}',''));
    end if;

    if v_kind='loot_box' and v_rarity_text in ('B','S','G') then
      insert into public.loot_boxes(character_id,name,rarity)
      values(v_recipient,coalesce(nullif(v_reward_name,''),'Dungeon Loot Box'),v_rarity_text::public.item_rarity);
    elsif v_kind='item' and v_item_id is not null then
      insert into public.character_items(character_id,item_id,quantity) values(v_recipient,v_item_id,1);
    elsif v_kind='skill' then
      insert into public.skills(character_id,name,rank)
      values(v_recipient,coalesce(nullif(v_reward_name,''),'Unidentified Skill'),1)
      on conflict(character_id,name) do update set rank=public.skills.rank+1;
    elsif v_kind='perk' then
      update public.characters
      set perks=case when perks @> array[v_reward_name]::text[] then perks else array_append(perks,v_reward_name) end
      where id=v_recipient;
    elsif v_kind='party_reward' and v_rarity_text in ('B','S','G') then
      insert into public.loot_boxes(character_id,name,rarity)
      values(v_recipient,coalesce(nullif(v_reward_name,''),'Party Reward'),v_rarity_text::public.item_rarity);
    end if;
  end loop;

  return v_event_id;
end;
$function$;

create or replace function public.apply_dungeon_command(p_game_id uuid,p_command_text text,p_command jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_event_id uuid;
  v_recipient_text text;
  v_recipient uuid;
  v_kind text := coalesce(p_command #>> '{action,kind}','');
  v_rarity text := coalesce(p_command #>> '{action,rarity}','B');
  v_box_name text := coalesce(nullif(trim(p_command #>> '{action,box_name}'),''),'Dungeon Supply Box');
  v_item jsonb := coalesce(p_command #> '{action,item}','{}'::jsonb);
  v_item_name text := coalesce(nullif(trim(v_item->>'name'),''),'Dungeon Item');
  v_item_type text := coalesce(nullif(trim(v_item->>'item_type'),''),'AI Generated');
  v_item_slot text := nullif(trim(v_item->>'slot'),'');
  v_item_effect text := coalesce(v_item->>'effect','');
  v_item_quirk text := coalesce(v_item->>'quirk','');
  v_bonuses jsonb := coalesce(v_item->'stat_bonuses','{}'::jsonb);
  v_str integer := greatest(0,least(999,coalesce((v_bonuses->>'Strength')::integer,0)));
  v_dex integer := greatest(0,least(999,coalesce((v_bonuses->>'Dexterity')::integer,0)));
  v_int integer := greatest(0,least(999,coalesce((v_bonuses->>'Intelligence')::integer,0)));
  v_con integer := greatest(0,least(999,coalesce((v_bonuses->>'Constitution')::integer,0)));
  v_cha integer := greatest(0,least(999,coalesce((v_bonuses->>'Charisma')::integer,0)));
  v_opening text := coalesce(nullif(trim(p_command #>> '{action,opening_message}'),''),'The Dungeon has issued a direct supply allocation.');
  v_health_delta integer := coalesce((p_command #>> '{action,health_delta}')::integer,0);
  v_full_heal boolean := coalesce((p_command #>> '{action,full_heal}')::boolean,false);
  v_item_id uuid;
  v_log jsonb;
begin
  if auth.uid() is null or not public.is_game_gm(p_game_id) then raise exception 'GM authorization required'; end if;
  if jsonb_typeof(p_command->'recipients')<>'array' then raise exception 'Command requires recipients'; end if;
  if v_kind not in ('loot_box','item','health') then raise exception 'Unsupported command action'; end if;
  if v_rarity not in ('B','S','G') then v_rarity:='B'; end if;
  if v_item_type not in ('Weapon','Armor','Accessory','Consumable','Utility','Quest','AI Generated') then v_item_type:='AI Generated'; end if;
  if v_item_slot is not null and v_item_slot not in ('Head','Shirt','Pants','Hands','Feet','Weapon 1','Weapon 2','Accessory 1','Accessory 2') then v_item_slot:=null; end if;

  if v_kind='item' then
    insert into public.items(
      game_id,name,rarity,item_type,slot,effect,quirk,
      strength_bonus,dexterity_bonus,intelligence_bonus,constitution_bonus,charisma_bonus,
      ai_generated
    )
    values(
      p_game_id,v_item_name,v_rarity::public.item_rarity,v_item_type,v_item_slot,v_item_effect,v_item_quirk,
      v_str,v_dex,v_int,v_con,v_cha,false
    )
    returning id into v_item_id;
  end if;

  for v_recipient_text in select value from jsonb_array_elements_text(p_command->'recipients') loop
    begin v_recipient:=v_recipient_text::uuid; exception when invalid_text_representation then continue; end;
    if not exists(select 1 from public.characters c where c.id=v_recipient and c.game_id=p_game_id) then continue; end if;

    if v_kind='loot_box' then
      insert into public.loot_boxes(character_id,name,rarity,preset_reward)
      values(
        v_recipient,v_box_name,v_rarity::public.item_rarity,
        jsonb_build_object(
          'name',v_item_name,'item_type',v_item_type,'slot',v_item_slot,'effect',v_item_effect,'quirk',v_item_quirk,
          'stat_bonuses',jsonb_build_object(
            'Strength',v_str,'Dexterity',v_dex,'Intelligence',v_int,'Constitution',v_con,'Charisma',v_cha
          ),
          'opening_message',v_opening
        )
      );
    elsif v_kind='item' then
      insert into public.character_items(character_id,item_id,quantity) values(v_recipient,v_item_id,1);
    elsif v_kind='health' then
      if v_full_heal then
        update public.characters set current_health=max_health where id=v_recipient;
      else
        update public.characters set current_health=greatest(0,least(max_health,current_health+v_health_delta)) where id=v_recipient;
      end if;
    end if;
  end loop;

  v_log := jsonb_build_object(
    'should_reward',true,
    'recipients',coalesce(p_command->'recipients','[]'::jsonb),
    'achievement',null,
    'reward',jsonb_build_object(
      'kind',case when v_kind='loot_box' then 'loot_box' when v_kind='item' then 'item' else 'none' end,
      'rarity',case when v_kind in ('loot_box','item') then v_rarity else 'none' end,
      'name',case when v_kind='loot_box' then v_box_name when v_kind='item' then v_item_name else '' end,
      'effect',case when v_kind='health' then
        case when v_full_heal then 'Restore health to maximum.' else concat('Adjust health by ',v_health_delta,' stored health units.') end
        else v_item_effect end,
      'quirk',case when v_kind in ('loot_box','item') then v_item_quirk else '' end,
      'stat_bonuses',jsonb_build_object(
        'Strength',v_str,'Dexterity',v_dex,'Intelligence',v_int,'Constitution',v_con,'Charisma',v_cha
      )
    ),
    'reasoning_for_gm','Direct GM command. No Dungeon judgment was performed.',
    'manual_command',p_command
  );

  insert into public.dungeon_events(game_id,created_by,event_text,ai_verdict,applied)
  values(p_game_id,auth.uid(),p_command_text,v_log,true)
  returning id into v_event_id;

  return v_event_id;
end;
$function$;
