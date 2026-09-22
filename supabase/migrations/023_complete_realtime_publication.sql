-- Ensure every game-state table that can change the UI is published to Supabase Realtime.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='items'
  ) then
    alter publication supabase_realtime add table public.items;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='skills'
  ) then
    alter publication supabase_realtime add table public.skills;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='dungeon_events'
  ) then
    alter publication supabase_realtime add table public.dungeon_events;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='games'
  ) then
    alter publication supabase_realtime add table public.games;
  end if;
end $$;
