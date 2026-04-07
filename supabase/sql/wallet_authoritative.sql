create extension if not exists pgcrypto;

create table if not exists public.wallet_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  wallet_alias text,
  balance_sats bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.wallet_ledger (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  direction text not null check (direction in ('credit', 'debit')),
  amount_sats bigint not null check (amount_sats > 0),
  source text not null,
  note text,
  status text not null default 'pending_verification',
  request_id uuid,
  created_at timestamptz not null default now()
);

create unique index if not exists wallet_ledger_request_idx
  on public.wallet_ledger(request_id);

create table if not exists public.wallet_proofs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mint_url text not null,
  proof_secret text not null,
  amount_sats bigint not null check (amount_sats > 0),
  proof_json jsonb not null,
  state text not null default 'unspent' check (state in ('unspent', 'reserved', 'spent')),
  request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mint_url, proof_secret)
);

create index if not exists wallet_proofs_user_state_mint_idx
  on public.wallet_proofs(user_id, state, mint_url);

create table if not exists public.wallet_requests (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('redeem', 'withdraw')),
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wallet_bank_proofs (
  id uuid primary key default gen_random_uuid(),
  mint_url text not null,
  proof_secret text not null,
  amount_sats bigint not null check (amount_sats > 0),
  proof_json jsonb not null,
  source_user_id uuid references auth.users(id) on delete set null,
  request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mint_url, proof_secret)
);

create index if not exists wallet_bank_proofs_request_idx
  on public.wallet_bank_proofs(request_id);

alter table public.wallet_profiles enable row level security;
alter table public.wallet_ledger enable row level security;
alter table public.wallet_proofs enable row level security;
alter table public.wallet_requests enable row level security;
alter table public.wallet_bank_proofs enable row level security;

drop policy if exists "wallet_profiles_owner_all" on public.wallet_profiles;
drop policy if exists "wallet_profiles_owner_read" on public.wallet_profiles;
drop policy if exists "wallet_ledger_owner_all" on public.wallet_ledger;
drop policy if exists "wallet_ledger_owner_read" on public.wallet_ledger;
drop policy if exists "wallet_proofs_no_client_access" on public.wallet_proofs;
drop policy if exists "wallet_requests_no_client_access" on public.wallet_requests;
drop policy if exists "wallet_bank_proofs_no_client_access" on public.wallet_bank_proofs;

create policy "wallet_profiles_owner_read"
on public.wallet_profiles
for select
using (auth.uid() = user_id);

create policy "wallet_ledger_owner_read"
on public.wallet_ledger
for select
using (auth.uid() = user_id);

create policy "wallet_proofs_no_client_access"
on public.wallet_proofs
for all
using (false)
with check (false);

create policy "wallet_requests_no_client_access"
on public.wallet_requests
for all
using (false)
with check (false);

create policy "wallet_bank_proofs_no_client_access"
on public.wallet_bank_proofs
for all
using (false)
with check (false);

create or replace function public.wallet_get_state(
  p_user_id uuid,
  p_ledger_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alias text;
  v_balance bigint;
  v_ledger jsonb;
begin
  select wp.wallet_alias, wp.balance_sats
    into v_alias, v_balance
  from public.wallet_profiles wp
  where wp.user_id = p_user_id;

  v_alias := coalesce(v_alias, null);
  v_balance := coalesce(v_balance, 0);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', wl.id,
        'direction', wl.direction,
        'amountSats', wl.amount_sats,
        'source', wl.source,
        'note', coalesce(wl.note, ''),
        'status', wl.status,
        'createdAt', wl.created_at
      )
      order by wl.created_at desc
    ),
    '[]'::jsonb
  )
    into v_ledger
  from (
    select *
    from public.wallet_ledger
    where user_id = p_user_id
    order by created_at desc
    limit greatest(1, p_ledger_limit)
  ) wl;

  return jsonb_build_object(
    'walletAlias', v_alias,
    'balanceSats', v_balance,
    'ledger', v_ledger
  );
end;
$$;

create or replace function public.wallet_set_alias(
  p_user_id uuid,
  p_alias text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
begin
  select coalesce(sum(amount_sats), 0)
    into v_balance
  from public.wallet_proofs
  where user_id = p_user_id
    and state = 'unspent';

  insert into public.wallet_profiles (user_id, wallet_alias, balance_sats, updated_at)
  values (p_user_id, nullif(trim(p_alias), ''), v_balance, now())
  on conflict (user_id)
  do update
    set wallet_alias = excluded.wallet_alias,
        updated_at = now();

  return public.wallet_get_state(p_user_id, 100);
end;
$$;

create or replace function public.wallet_record_redeem(
  p_user_id uuid,
  p_request_id uuid,
  p_mint_url text,
  p_proofs jsonb,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  proof_item jsonb;
  v_amount bigint;
  v_inserted_total bigint := 0;
  v_balance bigint;
begin
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  insert into public.wallet_requests (id, user_id, kind, status, created_at, updated_at)
  values (p_request_id, p_user_id, 'redeem', 'pending', now(), now())
  on conflict (id) do nothing;

  if exists (
    select 1
    from public.wallet_requests wr
    where wr.id = p_request_id
      and wr.user_id = p_user_id
      and wr.status = 'completed'
  ) then
    return public.wallet_get_state(p_user_id, 100);
  end if;

  for proof_item in
    select value
    from jsonb_array_elements(p_proofs)
  loop
    v_amount := coalesce((proof_item ->> 'amount')::bigint, 0);
    if v_amount <= 0 then
      raise exception 'Invalid proof amount in redeem payload';
    end if;

    insert into public.wallet_proofs (
      user_id,
      mint_url,
      proof_secret,
      amount_sats,
      proof_json,
      state,
      request_id,
      created_at,
      updated_at
    )
    values (
      p_user_id,
      p_mint_url,
      coalesce(proof_item ->> 'secret', ''),
      v_amount,
      proof_item,
      'unspent',
      p_request_id,
      now(),
      now()
    )
    on conflict (mint_url, proof_secret) do nothing;

    if found then
      v_inserted_total := v_inserted_total + v_amount;
    end if;
  end loop;

  if v_inserted_total <= 0 then
    update public.wallet_requests
      set status = 'failed',
          error = 'No new proofs were accepted.',
          updated_at = now()
    where id = p_request_id
      and user_id = p_user_id;
    raise exception 'No new proofs were accepted.';
  end if;

  insert into public.wallet_ledger (
    id, user_id, direction, amount_sats, source, note, status, request_id, created_at
  )
  values (
    gen_random_uuid(),
    p_user_id,
    'credit',
    v_inserted_total,
    'cashu_token',
    coalesce(nullif(trim(p_note), ''), 'Cashu token redeem'),
    'confirmed',
    p_request_id,
    now()
  )
  on conflict (request_id) do nothing;

  select coalesce(sum(amount_sats), 0)
    into v_balance
  from public.wallet_proofs
  where user_id = p_user_id
    and state = 'unspent';

  insert into public.wallet_profiles (user_id, balance_sats, updated_at)
  values (p_user_id, v_balance, now())
  on conflict (user_id)
  do update
    set balance_sats = excluded.balance_sats,
        updated_at = now();

  update public.wallet_requests
    set status = 'completed',
        updated_at = now()
  where id = p_request_id
    and user_id = p_user_id;

  return public.wallet_get_state(p_user_id, 100);
end;
$$;

create or replace function public.wallet_reserve_withdraw(
  p_user_id uuid,
  p_request_id uuid,
  p_amount_sats bigint
)
returns table (
  mint_url text,
  selected_total bigint,
  proofs jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mint_url text;
  v_total bigint := 0;
  v_proofs jsonb := '[]'::jsonb;
  v_selected_ids uuid[] := '{}';
  proof_row record;
begin
  if p_amount_sats <= 0 then
    raise exception 'Withdrawal amount must be greater than zero';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  insert into public.wallet_requests (id, user_id, kind, status, created_at, updated_at)
  values (p_request_id, p_user_id, 'withdraw', 'pending', now(), now())
  on conflict (id) do nothing;

  if exists (
    select 1
    from public.wallet_requests wr
    where wr.id = p_request_id
      and wr.user_id = p_user_id
      and wr.status = 'completed'
  ) then
    raise exception 'Withdraw request already completed';
  end if;

  select wp.mint_url
    into v_mint_url
  from public.wallet_proofs wp
  where wp.user_id = p_user_id
    and wp.state = 'unspent'
  group by wp.mint_url
  having sum(wp.amount_sats) >= p_amount_sats
  order by sum(wp.amount_sats) asc
  limit 1;

  if v_mint_url is null then
    update public.wallet_requests
      set status = 'failed',
          error = 'No single mint balance can cover this withdrawal.',
          updated_at = now()
    where id = p_request_id
      and user_id = p_user_id;
    raise exception 'No single mint balance can cover this withdrawal.';
  end if;

  for proof_row in
    select wp.id, wp.amount_sats, wp.proof_json
    from public.wallet_proofs wp
    where wp.user_id = p_user_id
      and wp.state = 'unspent'
      and wp.mint_url = v_mint_url
    order by wp.amount_sats desc, wp.created_at asc
  loop
    v_selected_ids := array_append(v_selected_ids, proof_row.id);
    v_total := v_total + proof_row.amount_sats;
    v_proofs := v_proofs || jsonb_build_array(proof_row.proof_json);
    exit when v_total >= p_amount_sats;
  end loop;

  if v_total < p_amount_sats then
    update public.wallet_requests
      set status = 'failed',
          error = 'Insufficient proofs while reserving withdrawal.',
          updated_at = now()
    where id = p_request_id
      and user_id = p_user_id;
    raise exception 'Unable to reserve sufficient proofs for withdrawal.';
  end if;

  update public.wallet_proofs
    set state = 'reserved',
        request_id = p_request_id,
        updated_at = now()
  where id = any(v_selected_ids);

  return query
    select v_mint_url, v_total, v_proofs;
end;
$$;

create or replace function public.wallet_release_withdraw(
  p_user_id uuid,
  p_request_id uuid,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  update public.wallet_proofs
    set state = 'unspent',
        request_id = null,
        updated_at = now()
  where user_id = p_user_id
    and request_id = p_request_id
    and state = 'reserved';

  update public.wallet_requests
    set status = 'failed',
        error = coalesce(p_error, error),
        updated_at = now()
  where id = p_request_id
    and user_id = p_user_id
    and status <> 'completed';
end;
$$;

create or replace function public.wallet_finalize_withdraw(
  p_user_id uuid,
  p_request_id uuid,
  p_mint_url text,
  p_amount_sats bigint,
  p_keep_proofs jsonb,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  proof_item jsonb;
  v_amount bigint;
  v_balance bigint;
begin
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  if not exists (
    select 1
    from public.wallet_requests wr
    where wr.id = p_request_id
      and wr.user_id = p_user_id
      and wr.kind = 'withdraw'
      and wr.status = 'pending'
  ) then
    raise exception 'Withdraw request is not pending.';
  end if;

  update public.wallet_proofs
    set state = 'spent',
        updated_at = now()
  where user_id = p_user_id
    and request_id = p_request_id
    and state = 'reserved';

  for proof_item in
    select value
    from jsonb_array_elements(coalesce(p_keep_proofs, '[]'::jsonb))
  loop
    v_amount := coalesce((proof_item ->> 'amount')::bigint, 0);
    if v_amount <= 0 then
      continue;
    end if;

    insert into public.wallet_proofs (
      user_id,
      mint_url,
      proof_secret,
      amount_sats,
      proof_json,
      state,
      request_id,
      created_at,
      updated_at
    )
    values (
      p_user_id,
      p_mint_url,
      coalesce(proof_item ->> 'secret', ''),
      v_amount,
      proof_item - 'mint',
      'unspent',
      p_request_id,
      now(),
      now()
    )
    on conflict (mint_url, proof_secret) do nothing;
  end loop;

  insert into public.wallet_ledger (
    id, user_id, direction, amount_sats, source, note, status, request_id, created_at
  )
  values (
    gen_random_uuid(),
    p_user_id,
    'debit',
    p_amount_sats,
    'cashu_withdrawal',
    coalesce(nullif(trim(p_note), ''), 'Cashu withdrawal'),
    'confirmed',
    p_request_id,
    now()
  )
  on conflict (request_id) do nothing;

  select coalesce(sum(amount_sats), 0)
    into v_balance
  from public.wallet_proofs
  where user_id = p_user_id
    and state = 'unspent';

  insert into public.wallet_profiles (user_id, balance_sats, updated_at)
  values (p_user_id, v_balance, now())
  on conflict (user_id)
  do update
    set balance_sats = excluded.balance_sats,
        updated_at = now();

  update public.wallet_requests
    set status = 'completed',
        updated_at = now()
  where id = p_request_id
    and user_id = p_user_id;

  return public.wallet_get_state(p_user_id, 100);
end;
$$;

create or replace function public.wallet_finalize_fee(
  p_user_id uuid,
  p_request_id uuid,
  p_mint_url text,
  p_amount_sats bigint,
  p_keep_proofs jsonb,
  p_bank_proofs jsonb default '[]'::jsonb,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  proof_item jsonb;
  v_amount bigint;
  v_balance bigint;
begin
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  if p_amount_sats <= 0 then
    raise exception 'Fee amount must be greater than zero.';
  end if;

  if not exists (
    select 1
    from public.wallet_requests wr
    where wr.id = p_request_id
      and wr.user_id = p_user_id
      and wr.kind = 'withdraw'
      and wr.status = 'pending'
  ) then
    raise exception 'Fee request is not pending.';
  end if;

  update public.wallet_proofs
    set state = 'spent',
        updated_at = now()
  where user_id = p_user_id
    and request_id = p_request_id
    and state = 'reserved';

  for proof_item in
    select value
    from jsonb_array_elements(coalesce(p_keep_proofs, '[]'::jsonb))
  loop
    v_amount := coalesce((proof_item ->> 'amount')::bigint, 0);
    if v_amount <= 0 then
      continue;
    end if;

    insert into public.wallet_proofs (
      user_id,
      mint_url,
      proof_secret,
      amount_sats,
      proof_json,
      state,
      request_id,
      created_at,
      updated_at
    )
    values (
      p_user_id,
      p_mint_url,
      coalesce(proof_item ->> 'secret', ''),
      v_amount,
      proof_item - 'mint',
      'unspent',
      p_request_id,
      now(),
      now()
    )
    on conflict (mint_url, proof_secret) do nothing;
  end loop;

  for proof_item in
    select value
    from jsonb_array_elements(coalesce(p_bank_proofs, '[]'::jsonb))
  loop
    v_amount := coalesce((proof_item ->> 'amount')::bigint, 0);
    if v_amount <= 0 then
      continue;
    end if;

    insert into public.wallet_bank_proofs (
      mint_url,
      proof_secret,
      amount_sats,
      proof_json,
      source_user_id,
      request_id,
      created_at,
      updated_at
    )
    values (
      p_mint_url,
      coalesce(proof_item ->> 'secret', ''),
      v_amount,
      proof_item - 'mint',
      p_user_id,
      p_request_id,
      now(),
      now()
    )
    on conflict (mint_url, proof_secret) do nothing;
  end loop;

  insert into public.wallet_ledger (
    id, user_id, direction, amount_sats, source, note, status, request_id, created_at
  )
  values (
    gen_random_uuid(),
    p_user_id,
    'debit',
    p_amount_sats,
    'chat_cooldown_fee',
    coalesce(nullif(trim(p_note), ''), 'Cooldown bypass fee'),
    'confirmed',
    p_request_id,
    now()
  )
  on conflict (request_id) do nothing;

  select coalesce(sum(amount_sats), 0)
    into v_balance
  from public.wallet_proofs
  where user_id = p_user_id
    and state = 'unspent';

  insert into public.wallet_profiles (user_id, balance_sats, updated_at)
  values (p_user_id, v_balance, now())
  on conflict (user_id)
  do update
    set balance_sats = excluded.balance_sats,
        updated_at = now();

  update public.wallet_requests
    set status = 'completed',
        updated_at = now()
  where id = p_request_id
    and user_id = p_user_id;

  return public.wallet_get_state(p_user_id, 100);
end;
$$;

grant execute on function public.wallet_get_state(uuid, integer) to authenticated;
grant execute on function public.wallet_set_alias(uuid, text) to authenticated;
grant execute on function public.wallet_record_redeem(uuid, uuid, text, jsonb, text) to authenticated;
grant execute on function public.wallet_reserve_withdraw(uuid, uuid, bigint) to authenticated;
grant execute on function public.wallet_release_withdraw(uuid, uuid, text) to authenticated;
grant execute on function public.wallet_finalize_withdraw(uuid, uuid, text, bigint, jsonb, text) to authenticated;
grant execute on function public.wallet_finalize_fee(uuid, uuid, text, bigint, jsonb, jsonb, text) to authenticated;
