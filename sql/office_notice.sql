-- 관공서(시청 등) 행사·공지: 누구나 읽기 / 관리자만 쓰기
create table if not exists public.office_notice (
  id bigint generated always as identity primary key,
  office text not null,           -- 정읍시청 / 정읍시보건소 ...
  title text not null,
  body text,
  link text,
  until date,                     -- 이 날이 지나면 자동으로 숨김
  created_at timestamptz not null default now()
);
alter table public.office_notice enable row level security;
drop policy if exists "on_read" on public.office_notice;
drop policy if exists "on_admin_all" on public.office_notice;
create policy "on_read" on public.office_notice for select to anon, authenticated using (true);
create policy "on_admin_all" on public.office_notice for all to authenticated
  using ((auth.jwt() ->> 'email') = 'dujin986@gmail.com') with check ((auth.jwt() ->> 'email') = 'dujin986@gmail.com');
grant select on public.office_notice to anon, authenticated;
grant insert, update, delete on public.office_notice to authenticated;
