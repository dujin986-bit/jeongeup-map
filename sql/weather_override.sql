-- 관리자 수동 날씨 (모든 사용자 화면에 적용, 시간이 지나면 자동으로 실시간 날씨로 복귀)
create table if not exists public.weather_override (
  id int primary key,
  kind text,
  expires_at timestamptz
);
alter table public.weather_override enable row level security;
drop policy if exists "wxo_read" on public.weather_override;
drop policy if exists "wxo_admin_ins" on public.weather_override;
drop policy if exists "wxo_admin_upd" on public.weather_override;
drop policy if exists "wxo_admin_del" on public.weather_override;
create policy "wxo_read" on public.weather_override for select using (true);
create policy "wxo_admin_ins" on public.weather_override for insert to authenticated with check ((auth.jwt() ->> 'email') = 'dujin986@gmail.com');
create policy "wxo_admin_upd" on public.weather_override for update to authenticated using ((auth.jwt() ->> 'email') = 'dujin986@gmail.com') with check ((auth.jwt() ->> 'email') = 'dujin986@gmail.com');
create policy "wxo_admin_del" on public.weather_override for delete to authenticated using ((auth.jwt() ->> 'email') = 'dujin986@gmail.com');
grant select on public.weather_override to anon, authenticated;
grant insert, update, delete on public.weather_override to authenticated;
