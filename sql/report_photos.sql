-- 제보 사진 첨부: reports에 사진 주소 칸 + 사진 저장소(report-photos)
alter table public.reports add column if not exists photo_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-photos', 'report-photos', true, 1500000, array['image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = 1500000, allowed_mime_types = array['image/jpeg'];

drop policy if exists "report_photos_upload" on storage.objects;
drop policy if exists "report_photos_read" on storage.objects;
drop policy if exists "report_photos_admin_delete" on storage.objects;
create policy "report_photos_upload" on storage.objects for insert to anon, authenticated with check (bucket_id = 'report-photos');
create policy "report_photos_read" on storage.objects for select to anon, authenticated using (bucket_id = 'report-photos');
create policy "report_photos_admin_delete" on storage.objects for delete to authenticated using (bucket_id = 'report-photos' and (auth.jwt() ->> 'email') = 'dujin986@gmail.com');
