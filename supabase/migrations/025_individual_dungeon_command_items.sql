-- Allow Dungeon Command to generate a distinct item for each recipient.
create or replace function public.apply_dungeon_command(
  p_game_id uuid,
  p_command_text text,
  p_command jsonb
)
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
  v_distribution text := coalesce(p_command #>> '{action,distribution}','shared');
  v_rarity text := coalesce(p_command #>> '{action,rarity}','B');
  v_box_name text := coalesce(nullif(trim(p_command #>> '{action,box_name}'),''),'Dungeon Supply Box');
  v_shared_item jsonb := coalesce(p_command #> '{action,item}','{}'::jsonb);
  v_individual_items jsonb := coalesce(p_command #> '{action,individual_items}','[]'::jsonb);
  v_selected_item jsonb;
  v_item_name text;
  v_item_type text;
  v_item_slot text;
  v_item_effect text;
  v_item_quirk text;
  v_bonuses jsonb;
  v_str integer;
  v_dex integer;
  v_int integer;
  v_con integer;
  v_cha integer;
  v_opening text := coalesce(nullif(trim(p_command #>> '{action,opening_message}'),''),'The Dungeon has issued a direct supply allocation.');
  v_health_delta integer := coalesce((p_command #>> '{action,health_delta}')::integer,0);
  v_full_heal boolean := coalesce((p_command #>> '{action,full_heal}')::boolean,false);
  v_item_id uuid;
  v_log jsonb;
begin
  if auth.uid() is null or not public.is_game_gm(p_game_id) then raise exception 'GM authorization required'; end if;
  if jsonb_typeof(p_command->'recipients')<>'array' then raise exception 'Command requires recipients'; end if;
  if v_kind not in ('loot_box','item','health') then raise exception 'Unsupported command action'; end if;
  if v_distribution not in ('shared','individual') then v_distribution := 'shared'; end if;
  if v_rarity not in ('B','S','G') then v_rarity := 'B'; end if;

  for v_recipient_text in select value from jsonb_array_elements_text(p_command->'recipients') loop
    begin v_recipient := v_recipient_text::uuid; exception when invalid_text_representation then continue; end;

    if not exists(select 1 from public.characters c where c.id=v_recipient and c.game_id=p_game_id) then continue; end if;

    if v_kind in ('item','loot_box') then
      v_selected_item := v_shared_item;

      if v_distribution='individual' then
        select entry->'item' into v_selected_item
        from jsonb_array_elements(v_individual_items) entry
        where entry->>'recipient_id'=v_recipient_text
        limit 1;

        if v_selected_item is null then
          raise exception 'Missing individual item for recipient %',v_recipient_text;
        end if;
      end if;

      v_item_name := coalesce(nullif(trim(v_selected_item->>'name'),''),'Dungeon Item');
      v_item_type := coalesce(nullif(trim(v_selected_item->>'item_type'),''),'AI Generated');
      v_item_slot := nullif(trim(v_selected_item->>'slot'),'');
      v_item_effect := coalesce(v_selected_item->>'effect','');
      v_item_quirk := coalesce(v_selected_item->>'quirk','');
      v_bonuses := coalesce(v_selected_item->'stat_bonuses','{}'::jsonb);
      v_str := greatest(0,least(999,coalesce((v_bonuses->>'Strength')::integer,0)));
      v_dex := greatest(0,least(999,coalesce((v_bonuses->>'Dexterity')::integer,0)));
      v_int := greatest(0,least(999,coalesce((v_bonuses->>'Intelligence')::integer,0)));
      v_con := greatest(0,least(999,coalesce((v_bonuses->>'Constitution')::integer,0)));
      v_cha := greatest(0,least(999,coalesce((v_bonuses->>'Charisma')::integer,0)));

      if v_item_type not in ('Weapon','Armor','Accessory','Consumable','Utility','Quest','AI Generated') then v_item_type := 'AI Generated'; end if;
      if v_item_slot is not null and v_item_slot not in ('Head','Shirt','Pants','Hands','Feet','Weapon 1','Weapon 2','Accessory 1','Accessory 2') then v_item_slot := null; end if;
    end if;

    if v_kind='loot_box' then
      insert into public.loot_boxes(character_id,name,rarity,preset_reward)
      values(
        v_recipient,
        case when v_distribution='individual' then concat(v_box_name,' // ',v_item_name) else v_box_name end,
        v_rarity::public.item_rarity,
        jsonb_build_object(
          'name',v_item_name,'item_type',v_item_type,'slot',v_item_slot,'effect',v_item_effect,'quirk',v_item_quirk,
          'stat_bonuses',jsonb_build_object(
            'Strength',v_str,'Dexterity',v_dex,'Intelligence',v_int,'Constitution',v_con,'Charisma',v_cha
          ),
          'opening_message',v_opening
        )
      );
    elsif v_kind='item' then
      insert into public.items(
        game_id,name,rarity,item_type,slot,effect,quirk,
        strength_bonus,dexterity_bonus,intelligence_bonus,constitution_bonus,charisma_bonus,ai_generated
      )
      values(
        p_game_id,v_item_name,v_rarity::public.item_rarity,v_item_type,v_item_slot,v_item_effect,v_item_quirk,
        v_str,v_dex,v_int,v_con,v_cha,true
      )
      returning id into v_item_id;

      insert into public.character_items(character_id,item_id,quantity) values(v_recipient,v_item_id,1);
    elsif v_kind='health' then
      if v_full_heal then
        update public.characters set current_health=max_health where id=v_recipient;
      else
        update public.characters
        set current_health=greatest(0,least(max_health,current_health+v_health_delta))
        where id=v_recipient;
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
      'name',case
        when v_distribution='individual' and v_kind in ('loot_box','item') then 'Individual Dungeon Rewards'
        when v_kind='loot_box' then v_box_name
        when v_kind='item' then coalesce(v_shared_item->>'name','Dungeon Item')
        else ''
      end,
      'effect',case
        when v_kind='health' then case when v_full_heal then 'Restore health to maximum.' else concat('Adjust health by ',v_health_delta,' stored health units.') end
        when v_distribution='individual' then 'Each recipient received a distinct Dungeon-generated item.'
        else coalesce(v_shared_item->>'effect','')
      end,
      'quirk',case
        when v_distribution='individual' then 'The Dungeon actually bothered to personalize these. Try to look grateful.'
        else coalesce(v_shared_item->>'quirk','')
      end,
      'stat_bonuses',case
        when v_distribution='individual' then jsonb_build_object('Strength',0,'Dexterity',0,'Intelligence',0,'Constitution',0,'Charisma',0)
        else coalesce(v_shared_item->'stat_bonuses',jsonb_build_object('Strength',0,'Dexterity',0,'Intelligence',0,'Constitution',0,'Charisma',0))
      end
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
