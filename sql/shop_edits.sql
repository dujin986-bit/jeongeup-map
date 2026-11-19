-- 가게 수정 내용을 저장하는 표 (이름 수정, 위치 이동, 없어진 가게 숨기기, 새 가게)
-- 읽기는 누구나, 쓰기는 관리자(dujin986@gmail.com)만 가능
create table if not exists public.shop_edits (
  id text primary key,
  name text,
  category text,
  lon double precision,
  lat double precision,
  hidden boolean not null default false,
  is_new boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.shop_edits enable row level security;

create policy "shop_edits_read" on public.shop_edits
  for select using (true);

create policy "shop_edits_admin_insert" on public.shop_edits
  for insert to authenticated
  with check ((auth.jwt() ->> 'email') = 'dujin986@gmail.com');

create policy "shop_edits_admin_update" on public.shop_edits
  for update to authenticated
  using ((auth.jwt() ->> 'email') = 'dujin986@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'dujin986@gmail.com');

create policy "shop_edits_admin_delete" on public.shop_edits
  for delete to authenticated
  using ((auth.jwt() ->> 'email') = 'dujin986@gmail.com');
