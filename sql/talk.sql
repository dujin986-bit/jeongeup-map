-- 🗣 얘기방(chat) + ❓ 지금 정읍(ask/reply) : 실시간 글 + 욕설 필터 + 도배 막기 + 신고 3번이면 자동 숨김
-- 실행 위치: Supabase 대시보드 → SQL Editor → New query → 아래 전체 붙여넣고 Run (여러 번 실행해도 안전)
-- 먼저 sql/feedback.sql 이 실행되어 있어야 해요 (has_badword 함수를 같이 씀)

-- 1) 글 표 : kind = chat(얘기방 한 줄) / ask(질문) / reply(질문에 대한 답)
create table if not exists public.talk_posts (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('chat', 'ask', 'reply')),
  parent_id bigint references public.talk_posts(id) on delete cascade,
  body text not null,
  nick text not null,
  voter text not null,
  likes int not null default 0,
  flags int not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists talk_posts_kind_created on public.talk_posts (kind, created_at desc);
create index if not exists talk_posts_parent on public.talk_posts (parent_id);
alter table public.talk_posts enable row level security;

drop policy if exists "talk_select" on public.talk_posts;
drop policy if exists "talk_insert" on public.talk_posts;
drop policy if exists "talk_admin_all" on public.talk_posts;
-- 누구나 숨겨지지 않은 글만 읽기
create policy "talk_select" on public.talk_posts for select to anon, authenticated using (hidden = false);
-- 누구나 새 글 쓰기 (길이·종류 확인, 숫자 칸은 0으로만)
create policy "talk_insert" on public.talk_posts for insert to anon, authenticated
  with check (
    length(body) between 1 and 200 and length(nick) between 2 and 20 and length(voter) between 8 and 64
    and likes = 0 and flags = 0 and hidden = false
    and ((kind in ('chat', 'ask') and parent_id is null) or (kind = 'reply' and parent_id is not null))
  );
-- 관리자만 전부 가능 (숨긴 글 보기·복원·삭제)
create policy "talk_admin_all" on public.talk_posts for all to authenticated
  using ((auth.jwt() ->> 'email') = 'dujin986@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'dujin986@gmail.com');
grant select, insert on public.talk_posts to anon, authenticated;
grant update, delete on public.talk_posts to authenticated;

-- 2) 새 글 검사: 욕설 막기 + 한 기기가 1분에 3개, 하루 60개까지
create or replace function public.talk_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.has_badword(new.body) or public.has_badword(new.nick) then raise exception 'badword'; end if;
  if (select count(*) from public.talk_posts where voter = new.voter and created_at > now() - interval '1 minute') >= 3 then raise exception 'ratelimit'; end if;
  if (select count(*) from public.talk_posts where voter = new.voter and created_at > now() - interval '1 day') >= 60 then raise exception 'ratelimit'; end if;
  return new;
end $$;
drop trigger if exists talk_guard on public.talk_posts;
create trigger talk_guard before insert on public.talk_posts for each row execute function public.talk_guard();

-- 3) 🚩 신고 : 한 사람이 한 글에 한 번, 서로 다른 3명이 신고하면 자동 숨김
create table if not exists public.talk_flags (
  post_id bigint not null references public.talk_posts(id) on delete cascade,
  voter text not null,
  primary key (post_id, voter)
);
alter table public.talk_flags enable row level security;      -- 직접 읽기·쓰기는 막고 함수로만

create or replace function public.talk_flag(p_id bigint, p_voter text) returns void language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if length(p_voter) < 8 then return; end if;
  insert into public.talk_flags(post_id, voter) values (p_id, p_voter) on conflict do nothing;
  if found then
    update public.talk_posts set flags = flags + 1 where id = p_id returning flags into n;
    if n >= 3 then update public.talk_posts set hidden = true where id = p_id; end if;
  end if;
end $$;
grant execute on function public.talk_flag(bigint, text) to anon, authenticated;

-- 4) 👍 도움돼요 : 한 사람이 한 글에 한 번 (다시 누르면 취소)
create table if not exists public.talk_likes (
  post_id bigint not null references public.talk_posts(id) on delete cascade,
  voter text not null,
  primary key (post_id, voter)
);
alter table public.talk_likes enable row level security;

create or replace function public.talk_like(p_id bigint, p_voter text) returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if length(p_voter) < 8 then return 0; end if;
  insert into public.talk_likes(post_id, voter) values (p_id, p_voter) on conflict do nothing;
  if not found then delete from public.talk_likes where post_id = p_id and voter = p_voter; end if;
  update public.talk_posts set likes = (select count(*) from public.talk_likes where post_id = p_id) where id = p_id returning likes into n;
  return coalesce(n, 0);
end $$;
grant execute on function public.talk_like(bigint, text) to anon, authenticated;

-- 5) 실시간 켜기 (이미 켜져 있으면 그냥 넘어감)
do $$ begin
  alter publication supabase_realtime add table public.talk_posts;
exception when duplicate_object then null; when undefined_object then null;
end $$;
