-- 👍/👎 반응 (가게·제보) + 가게 정보 수정 요청
create table if not exists public.reactions (
  item_type text not null, item_id text not null, voter text not null,
  val smallint not null check (val in (1, -1)),
  updated_at timestamptz not null default now(),
  primary key (item_type, item_id, voter)
);
alter table public.reactions enable row level security;

create or replace function public.react(p_type text, p_id text, p_voter text, p_val int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_type not in ('shop', 'report') or length(p_voter) < 8 or length(p_id) > 80 then return; end if;
  if p_val = 0 then
    delete from public.reactions where item_type = p_type and item_id = p_id and voter = p_voter;
  else
    insert into public.reactions(item_type, item_id, voter, val) values (p_type, p_id, p_voter, case when p_val > 0 then 1 else -1 end)
    on conflict (item_type, item_id, voter) do update set val = excluded.val, updated_at = now();
  end if;
end $$;

create or replace function public.reaction_counts(p_type text, p_ids text[])
returns table (item_id text, up bigint, down bigint) language sql stable security definer set search_path = public as $$
  select r.item_id, count(*) filter (where r.val = 1), count(*) filter (where r.val = -1)
  from public.reactions r where r.item_type = p_type and r.item_id = any(p_ids) group by r.item_id;
$$;
grant execute on function public.react(text, text, text, int) to anon, authenticated;
grant execute on function public.reaction_counts(text, text[]) to anon, authenticated;

create table if not exists public.shop_corrections (
  id bigint generated always as identity primary key,
  shop_id text not null, shop_name text, kind text not null, note text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
alter table public.shop_corrections enable row level security;
drop policy if exists "corr_insert" on public.shop_corrections;
drop policy if exists "corr_admin_sel" on public.shop_corrections;
drop policy if exists "corr_admin_upd" on public.shop_corrections;
drop policy if exists "corr_admin_del" on public.shop_corrections;
create policy "corr_insert" on public.shop_corrections for insert to anon, authenticated
  with check (status = 'pending' and length(coalesce(note, '')) <= 100 and length(shop_id) <= 80);
create policy "corr_admin_sel" on public.shop_corrections for select to authenticated using ((auth.jwt() ->> 'email') = 'dujin986@gmail.com');
create policy "corr_admin_upd" on public.shop_corrections for update to authenticated using ((auth.jwt() ->> 'email') = 'dujin986@gmail.com') with check ((auth.jwt() ->> 'email') = 'dujin986@gmail.com');
create policy "corr_admin_del" on public.shop_corrections for delete to authenticated using ((auth.jwt() ->> 'email') = 'dujin986@gmail.com');
grant insert on public.shop_corrections to anon, authenticated;
grant select, update, delete on public.shop_corrections to authenticated;
