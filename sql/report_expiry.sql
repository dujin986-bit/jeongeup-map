-- 제보 만료 시각(관리자가 연장/즉시 만료). 비어 있으면(null) 분류별 기본 시간으로 계산한다.
alter table public.reports add column if not exists expires_at timestamptz;

-- 관리자(dujin986@gmail.com)만 expires_at 을 정할 수 있게 한다.
-- (손님이 제보하면서 만료 시각을 멋대로 넣어 오래 남기는 것을 막는다)
create or replace function public.reports_expiry_guard() returns trigger language plpgsql as $$
begin
  if (auth.jwt() ->> 'email') is distinct from 'dujin986@gmail.com' then
    if tg_op = 'INSERT' then new.expires_at := null;
    else new.expires_at := old.expires_at; end if;
  end if;
  return new;
end $$;

drop trigger if exists reports_expiry_guard on public.reports;
create trigger reports_expiry_guard before insert or update on public.reports
  for each row execute function public.reports_expiry_guard();

-- 관리자 로그인 계정이 수정할 수 있도록 (이미 테이블 단위로 허용돼 있으면 영향 없음)
grant update (expires_at) on public.reports to authenticated;
