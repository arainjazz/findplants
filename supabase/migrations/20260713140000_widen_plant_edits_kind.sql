-- Widen plant_edits.kind so ALL kinds the app logs are accepted. The previous
-- CHECK only allowed a subset, so inserts for blog / draft / 小P蛙 edits were
-- silently rejected (the logging calls swallow errors) — which is why "我对博客
-- 文章的修改" never appeared in 修改记录. Add: draft_image, draft_text,
-- draft_reject, ai_page_edit, blog_publish, and the new blog_edit.
ALTER TABLE public.plant_edits DROP CONSTRAINT IF EXISTS plant_edits_kind_check;
ALTER TABLE public.plant_edits ADD CONSTRAINT plant_edits_kind_check
  CHECK (kind = ANY (ARRAY[
    'text','image','revert','create','html_save','branch','merge',
    'tag_create','catalog_create','catalog_append','draft_approve',
    'draft_image','draft_text','draft_reject','ai_page_edit',
    'blog_publish','blog_edit'
  ]));
