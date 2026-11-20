-- 웹푸시 구독자 표 (Supabase SQL Editor에 통째로 붙여넣고 Run)
-- role: 'admin' = 관리자 기기(새 제보 알림), 'guest' = 손님 기기(공지 알림)
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  role text not null default 'guest' check (role in ('admin', 'guest')),
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;

drop policy if exists "push_guest_insert" on public.push_subscriptions;
drop policy if exists "push_admin_all" on public.push_subscriptions;

-- 누구나 손님으로만 등록 가능(읽기·수정·삭제 불가)
create policy "push_guest_insert" on public.push_subscriptions for insert to anon, authenticated
  with check (role = 'guest' and length(endpoint) <= 700 and length(p256dh) <= 200 and length(auth) <= 100);
-- 관리자만 전부 가능
create policy "push_admin_all" on public.push_subscriptions for all to authenticated
  using ((auth.jwt() ->> 'email') = 'dujin986@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'dujin986@gmail.com');

grant insert on public.push_subscriptions to anon, authenticated;
grant select, update, delete on public.push_subscriptions to authenticated;
