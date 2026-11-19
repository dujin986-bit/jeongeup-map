-- 한 번에 실행: 가게 편집 권한 + 공지사항 + 편집 기록
grant usage on schema public to anon, authenticated;
grant select on public.shop_edits to anon, authenticated;
grant insert, update, delete on public.shop_edits to authenticated;

-- 공지사항 (level: urgent=긴급/빨강, normal=일반/파랑)
create table if not exists public.notices (
  id bigint generated always as identity primary key,
  body text not null,
  level text not null default 'normal',
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.notices enable row level security;
drop policy if exists "notices_read" on public.notices;
drop policy if exists "notices_admin_ins" on public.notices;
drop policy if exists "notices_admin_del" on public.notices;
drop policy if exists "notices_admin_upd" on public.notices;
create policy "notices_read" on public.notices for select using (true);
create policy "notices_admin_ins" on public.notices for insert to authenticated with check ((auth.jwt() ->> 'email') = 'dujin986@gmail.com');
create policy "notices_admin_upd" on public.notices for update to authenticated using ((auth.jwt() ->> 'email') = 'dujin986@gmail.com') with check ((auth.jwt() ->> 'email') = 'dujin986@gmail.com');
create policy "notices_admin_del" on public.notices for delete to authenticated using ((auth.jwt() ->> 'email') = 'dujin986@gmail.com');
grant select on public.notices to anon, authenticated;
grant insert, update, delete on public.notices to authenticated;

-- 가게 편집 기록 (고치기 전 모습을 자동 저장 → 관리자 화면에서 되돌리기)
create table if not exists public.shop_edit_log (
  id bigint generated always as identity primary key,
  shop_id text not null,
  name text, category text, lon double precision, lat double precision,
  hidden boolean, is_new boolean,
  action text,
  logged_at timestamptz not null default now()
);
alter table public.shop_edit_log enable row level security;
drop policy if exists "shop_edit_log_admin" on public.shop_edit_log;
create policy "shop_edit_log_admin" on public.shop_edit_log for select to authenticated using ((auth.jwt() ->> 'email') = 'dujin986@gmail.com');
grant select on public.shop_edit_log to authenticated;

create or replace function public.log_shop_edit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.shop_edit_log(shop_id, name, category, lon, lat, hidden, is_new, action)
  values (old.id, old.name, old.category, old.lon, old.lat, old.hidden, old.is_new, tg_op);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists trg_log_shop_edit on public.shop_edits;
create trigger trg_log_shop_edit before update or delete on public.shop_edits for each row execute function public.log_shop_edit();
