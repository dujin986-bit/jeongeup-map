-- 🔥 오늘의 찐맛집 판정: 가게별 하루 1표(🔥 또 갈 거임 / 👴 토박이 단골 / 😅 한 번으로 족함), 한국시간 자정 초기화
-- 기존 food_votes(하루 한 사람 한 표)를 "가게별 한 표"로 넓히고, 투표는 검증하는 함수로만 받는다.

alter table public.food_votes add column if not exists choice text not null default 'again';
alter table public.food_votes drop constraint if exists food_votes_choice_check;
alter table public.food_votes add constraint food_votes_choice_check check (choice in ('again','local','meh'));

-- 한 사람이 하루에 가게마다 한 번 (기존: 하루 전체 한 번)
alter table public.food_votes drop constraint if exists food_votes_pkey;
alter table public.food_votes add primary key (day, voter, shop_id);

-- 직접 쓰기는 막고(함수로만), 읽기는 기기 식별자(voter) 칸을 뺀 나머지만 허용
drop policy if exists "food_votes_insert" on public.food_votes;
revoke insert, update, delete on public.food_votes from anon, authenticated;
revoke select on public.food_votes from anon, authenticated;
grant select (day, shop_id, shop_name, choice, created_at) on public.food_votes to anon, authenticated;

-- 판정하기 (같은 날 같은 가게는 바꿀 수 있음, 하루 30곳까지)
create or replace function public.food_judge(p_shop_id text, p_shop_name text, p_voter text, p_choice text)
returns void language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Seoul')::date; n int;
begin
  if p_choice not in ('again','local','meh') then raise exception 'badchoice'; end if;
  if length(coalesce(p_voter,'')) < 8 or length(p_voter) > 64 then raise exception 'badvoter'; end if;
  if length(coalesce(p_shop_id,'')) < 1 or length(p_shop_id) > 80 then raise exception 'badshop'; end if;
  select count(*) into n from public.food_votes where day = d and voter = p_voter and shop_id <> p_shop_id;
  if n >= 30 then raise exception 'ratelimit'; end if;
  insert into public.food_votes(day, voter, shop_id, shop_name, choice)
  values (d, p_voter, p_shop_id, left(coalesce(p_shop_name,''), 60), p_choice)
  on conflict (day, voter, shop_id) do update set choice = excluded.choice, created_at = now();
end $$;
grant execute on function public.food_judge(text, text, text, text) to anon, authenticated;

-- 오늘 가게별 판정 수
create or replace function public.food_verdict(d date)
returns table (shop_id text, shop_name text, n_again bigint, n_local bigint, n_meh bigint)
language sql stable as $$
  select shop_id, max(shop_name),
    count(*) filter (where choice = 'again'),
    count(*) filter (where choice = 'local'),
    count(*) filter (where choice = 'meh')
  from public.food_votes where day = d
  group by shop_id order by count(*) desc limit 200;
$$;
grant execute on function public.food_verdict(date) to anon, authenticated;

-- 오늘의 맛집 TOP 3 / 룰렛은 좋은 판정(🔥·👴)만 점수로 센다
create or replace function public.food_top(d date)
returns table (shop_id text, shop_name text, cnt bigint) language sql stable as $$
  select shop_id, max(shop_name), count(*) from public.food_votes
  where day = d and choice in ('again','local')
  group by shop_id order by count(*) desc, max(created_at) asc limit 3;
$$;
grant execute on function public.food_top(date) to anon, authenticated;
