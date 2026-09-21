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
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into c from public.characters where id = p_character_id for update;
  if c.id is null or c.user_id <> auth.uid() then raise exception 'Not authorized'; end if;
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
      max_health = 6 + v_constitution,
      current_health = 6 + v_constitution,
      setup_complete = true
  where id = p_character_id;

  insert into public.skills(character_id,name,rank)
  values(p_character_id,trim(p_starting_skill),1)
  on conflict(character_id,name) do nothing;
end;
$function$;
