alter table public.characters
  add column if not exists recovery_code text;

create or replace function public.generate_crawler_recovery_code()
returns text
language plpgsql
volatile
set search_path = public
as $function$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := decode(md5(gen_random_uuid()::text || clock_timestamp()::text || random()::text), 'hex');
  v_raw text := '';
  i integer;
begin
  for i in 0..7 loop
    v_raw := v_raw || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  return substr(v_raw,1,4) || '-' || substr(v_raw,5,4);
end;
$function$;

revoke all on function public.generate_crawler_recovery_code() from public, anon, authenticated;

create unique index if not exists characters_recovery_code_key
  on public.characters(recovery_code)
  where recovery_code is not null;

do $$
declare
  r record;
  v_code text;
begin
  for r in select id from public.characters where recovery_code is null loop
    loop
      v_code := public.generate_crawler_recovery_code();
      exit when not exists(select 1 from public.characters where recovery_code = v_code);
    end loop;
    update public.characters set recovery_code = v_code where id = r.id;
  end loop;
end $$;

alter table public.characters
  alter column recovery_code set not null;

create or replace function public.ensure_character_recovery_code()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  v_code text;
begin
  if new.recovery_code is null or trim(new.recovery_code) = '' then
    loop
      v_code := public.generate_crawler_recovery_code();
      exit when not exists(select 1 from public.characters where recovery_code = v_code);
    end loop;
    new.recovery_code := v_code;
  end if;
  return new;
end;
$function$;

drop trigger if exists characters_recovery_code_trigger on public.characters;
create trigger characters_recovery_code_trigger
before insert on public.characters
for each row execute function public.ensure_character_recovery_code();

revoke all on function public.ensure_character_recovery_code() from public, anon, authenticated;

create or replace function public.recover_crawler(
  p_join_code text,
  p_recovery_code text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_game_id uuid;
  v_character_id uuid;
  v_old_user_id uuid;
  v_existing_character_id uuid;
  v_normalized_code text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  v_normalized_code := upper(regexp_replace(coalesce(p_recovery_code,''), '[^A-Z0-9]', '', 'g'));
  if length(v_normalized_code) <> 8 then
    raise exception 'Invalid crawler recovery code';
  end if;

  select id into v_game_id
  from public.games
  where join_code = upper(trim(p_join_code));

  if v_game_id is null then
    raise exception 'Invalid game join code';
  end if;

  select c.id, c.user_id
    into v_character_id, v_old_user_id
  from public.characters c
  where c.game_id = v_game_id
    and upper(regexp_replace(c.recovery_code, '[^A-Z0-9]', '', 'g')) = v_normalized_code
  for update;

  if v_character_id is null then
    raise exception 'Crawler recovery code not found for this game';
  end if;

  if v_old_user_id = auth.uid() then
    return v_character_id;
  end if;

  select id into v_existing_character_id
  from public.characters
  where game_id = v_game_id
    and user_id = auth.uid()
    and id <> v_character_id
  limit 1;

  if v_existing_character_id is not null then
    raise exception 'This device already controls a different crawler in this game';
  end if;

  insert into public.game_members(game_id,user_id,role)
  values(v_game_id,auth.uid(),'player')
  on conflict(game_id,user_id) do nothing;

  update public.characters
  set user_id = auth.uid()
  where id = v_character_id;

  delete from public.game_members
  where game_id = v_game_id
    and user_id = v_old_user_id
    and role = 'player';

  return v_character_id;
end;
$function$;

revoke all on function public.recover_crawler(text,text) from public, anon;
grant execute on function public.recover_crawler(text,text) to authenticated;

create or replace function public.gm_regenerate_recovery_code(
  p_character_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_game_id uuid;
  v_code text;
begin
  select game_id into v_game_id
  from public.characters
  where id = p_character_id
  for update;

  if v_game_id is null then
    raise exception 'character not found';
  end if;

  if not public.is_game_gm(v_game_id) then
    raise exception 'GM authorization required';
  end if;

  loop
    v_code := public.generate_crawler_recovery_code();
    exit when not exists(select 1 from public.characters where recovery_code = v_code);
  end loop;

  update public.characters
  set recovery_code = v_code
  where id = p_character_id;

  return v_code;
end;
$function$;

revoke all on function public.gm_regenerate_recovery_code(uuid) from public, anon;
grant execute on function public.gm_regenerate_recovery_code(uuid) to authenticated;
