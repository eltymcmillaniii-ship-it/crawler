alter table public.encounter_displays
  add column idle_image_path text;

alter table public.encounter_displays
  add constraint encounter_displays_idle_image_path_check
  check (
    idle_image_path is null
    or (
      length(idle_image_path) <= 500
      and idle_image_path ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/display/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
    )
  );

create policy "GM can upload encounter wait images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'enemy-art'
  and (storage.foldername(name))[2] = 'display'
  and case
    when coalesce((storage.foldername(name))[1], '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then public.is_game_gm(((storage.foldername(name))[1])::uuid)
    else false
  end
);

create policy "GM can delete encounter wait images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'enemy-art'
  and (storage.foldername(name))[2] = 'display'
  and case
    when coalesce((storage.foldername(name))[1], '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then public.is_game_gm(((storage.foldername(name))[1])::uuid)
    else false
  end
);
