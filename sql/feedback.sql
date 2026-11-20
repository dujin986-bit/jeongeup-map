-- "🛠 고쳐줘" 의견함 + 욕설 필터(제보·의견 모두) + 하루 보내기 횟수 제한
-- 실행 위치: Supabase 대시보드 → SQL Editor → New query → 아래 전체 붙여넣고 Run (여러 번 실행해도 안전)

-- 1) 의견함 표: 손님은 "보내기"만 가능, 읽기·처리·삭제는 관리자만
create table if not exists public.feedback (
  id bigint generated always as identity primary key,
  kind text not null default 'etc' check (kind in ('bug', 'idea', 'etc')),
  body text not null,
  contact text,
  voter text not null,
  status text not null default 'new' check (status in ('new', 'done')),
  created_at timestamptz not null default now()
);
alter table public.feedback enable row level security;
drop policy if exists "feedback_insert" on public.feedback;
drop policy if exists "feedback_admin_all" on public.feedback;
create policy "feedback_insert" on public.feedback for insert to anon, authenticated
  with check (length(body) between 2 and 300 and length(voter) between 8 and 64 and status = 'new' and coalesce(length(contact), 0) <= 60);
create policy "feedback_admin_all" on public.feedback for all to authenticated
  using ((auth.jwt() ->> 'email') = 'dujin986@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'dujin986@gmail.com');
grant insert on public.feedback to anon, authenticated;
grant select, update, delete on public.feedback to authenticated;

-- 2) 욕설 판별 함수: 새 욕이 보이면 아래 words 목록에 '단어', 를 한 줄 추가하고 이 파일을 다시 Run
--    (띄어쓰기는 그대로 두고 기호·숫자만 걷어 내서 비교 → "출시 발표" 같은 정상 문장은 통과)
create or replace function public.has_badword(t text) returns boolean language plpgsql immutable as $$
declare
  a text; b text; w text;
  words text[] := array[
    '시발','씨발','씹새','씹창','씹년','병신','븅신','지랄','좆','존나','개새끼','개세끼','느금마','니애미','미친놈','미친년','썅','쌍년','쌍놈','창녀',
    'ㅅㅂ','ㅆㅂ','ㅂㅅ','ㅈㄹ','fuck','shit','bitch'
  ];
begin
  a := regexp_replace(lower(coalesce(t, '')), '[^0-9a-z가-힣ㄱ-ㅎ ]', '', 'g');   -- 기호 제거
  b := regexp_replace(a, '[0-9]', '', 'g');                                          -- 숫자 섞어 돌려 쓴 경우 (씨1발)
  foreach w in array words loop
    if position(w in a) > 0 or position(w in b) > 0 then return true; end if;
  end loop;
  return false;
end $$;

-- 3) 의견: 욕설 막기 + 한 사람이 하루 10건까지
create or replace function public.feedback_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.has_badword(new.body) or public.has_badword(new.contact) then raise exception 'badword'; end if;
  if (select count(*) from public.feedback where voter = new.voter and created_at > now() - interval '1 day') >= 10 then raise exception 'ratelimit'; end if;
  return new;
end $$;
drop trigger if exists feedback_guard on public.feedback;
create trigger feedback_guard before insert on public.feedback for each row execute function public.feedback_guard();

-- 4) 제보: 제목·내용에 욕설이 있으면 막기
create or replace function public.reports_badword_guard() returns trigger language plpgsql as $$
begin
  if public.has_badword(new.title) or public.has_badword(new.description) then raise exception 'badword'; end if;
  return new;
end $$;
drop trigger if exists reports_badword_guard on public.reports;
create trigger reports_badword_guard before insert on public.reports for each row execute function public.reports_badword_guard();
