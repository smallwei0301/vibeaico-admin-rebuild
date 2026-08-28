-- Follow-up for TEST environments where 0039 was applied before the bucket
-- constraints and explicit cleanup-table ACL revoke were added.

update storage.buckets
set name = 'keyword-reply-images',
    public = true,
    file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg','image/png']::text[]
where id = 'keyword-reply-images';

revoke all on table public.keyword_reply_image_cleanup from anon, authenticated;
