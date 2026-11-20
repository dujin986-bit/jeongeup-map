-- 가게 "간판 꾸미기" (색상·표시 이름·홍보 링크·노출 기간) + 관리자 전용 메모
-- 실행 위치: Supabase 대시보드 → SQL Editor → New query → 아래 전체 붙여넣고 Run (여러 번 실행해도 안전)

-- 1) 공개 정보(지도에 보이는 것): 기존 shop_edits 표에 칸만 추가 (읽기 누구나 / 쓰기 관리자만, 기존 정책 그대로)
alter table public.shop_edits add column if not exists brand_color text;
alter table public.shop_edits add column if not exists brand_name  text;
alter table public.shop_edits add column if not exists brand_link  text;
alter table public.shop_edits add column if not exists brand_from  date;
alter table public.shop_edits add column if not exists brand_until date;

-- 2) 관리자 전용 메모(계약자·금액·연락처 등): 일반 사용자는 읽을 수도 없음
create table if not exists public.shop_brand_memo (
  id text primary key,
  memo text,
  updated_at timestamptz not null default now()
);
alter table public.shop_brand_memo enable row level security;
drop policy if exists "brand_memo_admin_all" on public.shop_brand_memo;
create policy "brand_memo_admin_all" on public.shop_brand_memo
  for all to authenticated
  using ((auth.jwt() ->> 'email') = 'dujin986@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'dujin986@gmail.com');
grant select, insert, update, delete on public.shop_brand_memo to authenticated;
