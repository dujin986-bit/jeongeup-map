-- 오늘의 맛집 TOP 3 투표 (하루 한 사람 한 표, 한국시간 기준)
create table if not exists public.food_votes (
  day date not null,
  voter text not null,
  shop_id text not null,
  shop_name text not null,
  created_at timestamptz not null default now(),
  primary key (day, voter)
);
alter table public.food_votes enable row level security;
drop policy if exists "food_votes_read" on public.food_votes;
drop policy if exists "food_votes_insert" on public.food_votes;
create policy "food_votes_read" on public.food_votes for select using (true);
create policy "food_votes_insert" on public.food_votes for insert to anon, authenticated
  with check (day = (now() at time zone 'Asia/Seoul')::date and length(voter) between 8 and 64);
grant select, insert on public.food_votes to anon, authenticated;

create or replace function public.food_top(d date)
returns table (shop_id text, shop_name text, cnt bigint) language sql stable as $$
  select shop_id, max(shop_name), count(*) from public.food_votes where day = d
  group by shop_id order by count(*) desc, max(created_at) asc limit 3;
$$;
grant execute on function public.food_top(date) to anon, authenticated;
