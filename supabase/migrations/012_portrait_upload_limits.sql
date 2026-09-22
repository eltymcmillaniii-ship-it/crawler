update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg']::text[]
where id = 'character-portraits';
