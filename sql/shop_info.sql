-- 가게 정보 제보(인스타·블로그·전화·영업시간): 손님이 보내면 관리자 확인함에 쌓이고, 승인하면 shop_edits 칸에 들어가 지도에 보임
-- 1) 받는 표
create table if not exists public.shop_info_req (
  id bigint generated always as identity primary key,
  shop_id text not null, shop_name text,
  insta text, blog text, phone text, hours text,
  status text not null default 'pending',
  voter text,
  created_at timestamptz not null default now()
);
alter table public.shop_info_req enable row level security;
-- 2) 권한: 누구나 보내기만 / 읽기·승인·삭제는 관리자만
drop policy if exists "sir_insert" on public.shop_info_req;
drop policy if exists "sir_admin_sel" on public.shop_info_req;
drop policy if exists "sir_admin_upd" on public.shop_info_req;
drop policy if exists "sir_admin_del" on public.shop_info_req;
create policy "sir_insert" on public.shop_info_req for insert to anon, authenticated
  with check (status = 'pending' and length(shop_id) <= 80 and length(coalesce(insta,'')) <= 120 and length(coalesce(blog,'')) <= 160 and length(coalesce(phone,'')) <= 20 and length(coalesce(hours,'')) <= 80);
create policy "sir_admin_sel" on public.shop_info_req for select to authenticated using ((auth.jwt() ->> 'email') = 'dujin986@gmail.com');
create policy "sir_admin_upd" on public.shop_info_req for update to authenticated using ((auth.jwt() ->> 'email') = 'dujin986@gmail.com') with check ((auth.jwt() ->> 'email') = 'dujin986@gmail.com');
create policy "sir_admin_del" on public.shop_info_req for delete to authenticated using ((auth.jwt() ->> 'email') = 'dujin986@gmail.com');
grant insert on public.shop_info_req to anon, authenticated;
grant select, update, delete on public.shop_info_req to authenticated;
-- 3) 승인된 값이 들어갈 칸 (지도에 보임)
alter table public.shop_edits add column if not exists insta text;
alter table public.shop_edits add column if not exists blog text;
alter table public.shop_edits add column if not exists phone text;
alter table public.shop_edits add column if not exists hours text;
alter table public.shop_edits add column if not exists info_at timestamptz;
