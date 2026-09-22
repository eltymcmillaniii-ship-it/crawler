update public.loot_boxes
set name=case rarity
  when 'B'::public.item_rarity then 'Bronze Box of Questionable Contents'
  when 'S'::public.item_rarity then 'Silver Box of Suspicious Promise'
  when 'G'::public.item_rarity then 'Gold Box of Unreasonable Expectations'
end
where opened_at is null
  and preset_reward is not null;

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid)
    into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='apply_dungeon_command'
    and pg_get_function_identity_arguments(p.oid)='p_game_id uuid, p_command_text text, p_command jsonb';

  v_def := replace(
    v_def,
    'v_recipient,
        v_box_name,
        v_rarity::public.item_rarity,',
    'v_recipient,
        case v_rarity
          when ''B'' then ''Bronze Box of Questionable Contents''
          when ''S'' then ''Silver Box of Suspicious Promise''
          else ''Gold Box of Unreasonable Expectations''
        end,
        v_rarity::public.item_rarity,'
  );

  execute v_def;
end $$;