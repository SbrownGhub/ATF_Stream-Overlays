-- =====================================================================
-- ATF BREAKDOWNS POLL — Supabase setup
-- Paste the whole file into Supabase → SQL Editor → Run.
-- Safe to run again: it creates what's missing and replaces functions.
-- Every object is prefixed bd_ so it can share an existing project.
-- =====================================================================

-- ---------- tables ----------------------------------------------------

create table if not exists public.bd_state (
  id       smallint primary key default 1 check (id = 1),     -- exactly one row
  status   text not null default 'idle' check (status in ('idle','open','frozen')),
  poll_id  uuid not null default gen_random_uuid()
);
insert into public.bd_state (id) values (1) on conflict (id) do nothing;

-- When the presenter controller last checked in. Voters' phones use this
-- to decide whether to poll quickly or quietly.
alter table public.bd_state
  add column if not exists presenter_seen timestamptz not null default 'epoch';

-- One row per device per ability per poll. The primary key is what makes
-- a double vote impossible — not application code.
create table if not exists public.bd_votes (
  poll_id    uuid     not null,
  device     uuid     not null,
  ability    smallint not null check (ability between 0 and 4),
  pick       char(1)  not null check (pick in ('r','b')),
  updated_at timestamptz not null default now(),
  primary key (poll_id, device, ability)
);
create index if not exists bd_votes_tally on public.bd_votes (poll_id, ability, pick);

create table if not exists public.bd_panel (
  ability smallint primary key check (ability between 0 and 4),
  pick    text not null check (pick in ('red','blue'))
);

create table if not exists public.bd_pool (
  device    uuid primary key,
  joined_at timestamptz not null default now()
);

create table if not exists public.bd_rate (
  ip     text   not null,
  bucket bigint not null,
  n      int    not null default 0,
  primary key (ip, bucket)
);

create table if not exists public.bd_pushlock (
  id        smallint primary key default 1 check (id = 1),
  last_push timestamptz not null default 'epoch'
);
insert into public.bd_pushlock (id) values (1) on conflict (id) do nothing;

-- ---------- lock the tables ----------------------------------------------
-- Row-level security on with NO policies: the public anon key can read
-- and write nothing. Only the server's secret key gets through.

alter table public.bd_state    enable row level security;
alter table public.bd_votes    enable row level security;
alter table public.bd_panel    enable row level security;
alter table public.bd_pool     enable row level security;
alter table public.bd_rate     enable row level security;
alter table public.bd_pushlock enable row level security;

revoke all on public.bd_state, public.bd_votes, public.bd_panel,
              public.bd_pool,  public.bd_rate,  public.bd_pushlock
  from anon, authenticated;

-- The server's secret key runs as service_role. Supabase normally grants
-- this already; stating it here means the file doesn't depend on that.
grant select, insert, update, delete
  on public.bd_state, public.bd_votes, public.bd_panel,
     public.bd_pool,  public.bd_rate,  public.bd_pushlock
  to service_role;

-- ---------- functions ----------------------------------------------------

-- Everything the overlay, presenter and voters need, in one call.
-- Counts are derived from the votes themselves, so they can never drift.
create or replace function public.bd_snapshot()
returns json language sql stable set search_path = public as $$
  select json_build_object(
    'status', s.status,
    'pollId', s.poll_id,
    'live',   s.presenter_seen > now() - interval '120 seconds',
    'pool',   (select count(*) from bd_pool where joined_at > now() - interval '12 hours'),
    'tally',  (
      select json_agg(json_build_object('r', t.r, 'b', t.b) order by t.i)
      from (
        select a.i,
               count(*) filter (where v.pick = 'r') as r,
               count(*) filter (where v.pick = 'b') as b
        from generate_series(0, 4) as a(i)
        left join bd_votes v on v.ability = a.i and v.poll_id = s.poll_id
        group by a.i
      ) t),
    'panel',  (
      select json_agg(p.pick order by a.i)
      from generate_series(0, 4) as a(i)
      left join bd_panel p on p.ability = a.i)
  )
  from bd_state s
  where s.id = 1;
$$;

-- Returns  1 recorded / changed
--          0 same pick again (no-op)
--         -1 voting not open
--         -2 rate-limited
--         -3 bad input
create or replace function public.bd_vote(
  p_device uuid, p_ability int, p_pick text, p_ip text,
  p_limit int default 120, p_window int default 10)
returns int language plpgsql set search_path = public as $$
declare v_n int; v_status text; v_poll uuid; v_rows int;
begin
  if p_ability is null or p_ability < 0 or p_ability > 4 or p_pick not in ('r','b') then
    return -3;
  end if;

  insert into bd_rate (ip, bucket, n)
    values (coalesce(p_ip, 'unknown'), floor(extract(epoch from now()) / p_window)::bigint, 1)
    on conflict (ip, bucket) do update set n = bd_rate.n + 1
    returning n into v_n;
  if v_n > p_limit then return -2; end if;

  -- FOR SHARE: a freeze or reset waits for in-flight votes to finish,
  -- so nothing lands after the presenter has closed voting.
  select status, poll_id into v_status, v_poll from bd_state where id = 1 for share;
  if v_status is distinct from 'open' then return -1; end if;

  insert into bd_votes (poll_id, device, ability, pick)
    values (v_poll, p_device, p_ability, p_pick)
    on conflict (poll_id, device, ability)
    do update set pick = excluded.pick, updated_at = now()
    where bd_votes.pick <> excluded.pick;
  get diagnostics v_rows = row_count;
  return case when v_rows = 0 then 0 else 1 end;
end $$;

create or replace function public.bd_join(p_device uuid)
returns void language sql set search_path = public as $$
  insert into bd_pool (device) values (p_device)
  on conflict (device) do update set joined_at = now();
$$;

-- Presenter actions. Returns the fresh snapshot.
-- Every call, including the 'ping' heartbeat, marks the presenter as live.
create or replace function public.bd_control(
  p_action text, p_ability int default null, p_pick text default null)
returns json language plpgsql set search_path = public as $$
begin
  update bd_state set presenter_seen = now() where id = 1;

  if p_action = 'ping' then
    null;
  elsif p_action = 'open' then
    update bd_state set status = 'open' where id = 1;
  elsif p_action = 'freeze' then
    update bd_state set status = 'frozen' where id = 1;
  elsif p_action = 'reset' then
    -- same view, cleared in place. The pool is kept.
    update bd_state set status = 'idle', poll_id = gen_random_uuid() where id = 1;
    delete from bd_votes where true;
    delete from bd_panel where true;
    delete from bd_rate  where bucket < floor(extract(epoch from now()) / 10)::bigint - 360;
    delete from bd_pool  where joined_at < now() - interval '2 days';
  elsif p_action = 'panel' then
    if p_ability is null or p_ability < 0 or p_ability > 4 then
      raise exception 'bad ability';
    end if;
    if p_pick is null then
      delete from bd_panel where ability = p_ability;
    elsif p_pick in ('red','blue') then
      insert into bd_panel (ability, pick) values (p_ability, p_pick)
      on conflict (ability) do update set pick = excluded.pick;
    else
      raise exception 'bad pick';
    end if;
  else
    raise exception 'unknown action';
  end if;
  return bd_snapshot();
end $$;

-- Throttle for realtime pushes: true at most once per p_ms milliseconds.
create or replace function public.bd_try_push(p_ms int default 300)
returns boolean language plpgsql set search_path = public as $$
begin
  update bd_pushlock set last_push = clock_timestamp()
  where id = 1 and last_push < clock_timestamp() - p_ms * interval '1 millisecond';
  return found;
end $$;

-- ---------- lock the functions -------------------------------------------
-- Postgres lets anyone execute a new function by default. Supabase exposes
-- public functions over its API. So without these lines, anyone holding
-- your project's public key could open, freeze or reset the poll.

revoke all on function public.bd_snapshot()                          from public, anon, authenticated;
revoke all on function public.bd_vote(uuid, int, text, text, int, int) from public, anon, authenticated;
revoke all on function public.bd_join(uuid)                          from public, anon, authenticated;
revoke all on function public.bd_control(text, int, text)            from public, anon, authenticated;
revoke all on function public.bd_try_push(int)                       from public, anon, authenticated;

grant execute on function public.bd_snapshot()                          to service_role;
grant execute on function public.bd_vote(uuid, int, text, text, int, int) to service_role;
grant execute on function public.bd_join(uuid)                          to service_role;
grant execute on function public.bd_control(text, int, text)            to service_role;
grant execute on function public.bd_try_push(int)                       to service_role;
