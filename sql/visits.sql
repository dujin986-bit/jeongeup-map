-- 방문자 수 (하루에 폰 1대 = 1명, 개인정보 없음). 조각 1~3을 하나씩 실행하세요.

-- 조각 1
create table if not exists public.visit_log (
  day date not null default ((now() at time zone 'Asia/Seoul')::date),
  vid text not null,
  primary key (day, vid)
);
alter table public.visit_log enable row level security;

-- 조각 2
create or replace function public.log_visit(p_vid text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if length(p_vid) between 8 and 64 then
    insert into public.visit_log(vid) values (p_vid) on conflict do nothing;
  end if;
end $$;
grant execute on function public.log_visit(text) to anon, authenticated;

-- 조각 3
create or replace function public.visit_stats() returns table(day date, n bigint)
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'email', '') <> 'dujin986@gmail.com' then return; end if;
  return query select v.day, count(*) from public.visit_log v
    where v.day >= ((now() at time zone 'Asia/Seoul')::date - 6) group by v.day order by v.day desc;
end $$;
grant execute on function public.visit_stats() to authenticated;
