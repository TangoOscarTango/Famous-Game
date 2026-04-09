create extension if not exists pgcrypto;

create table if not exists public.chat_channels (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null,
  sort_order integer not null default 0,
  is_enabled_by_default boolean not null default true,
  max_length integer not null default 280,
  cooldown_seconds integer not null default 2,
  rate_limit_count integer not null default 5,
  rate_limit_window_seconds integer not null default 20,
  duplicate_window_seconds integer not null default 45,
  created_at timestamptz not null default now()
);

insert into public.chat_channels (
  slug, display_name, sort_order, is_enabled_by_default,
  max_length, cooldown_seconds, rate_limit_count, rate_limit_window_seconds, duplicate_window_seconds
)
values
  ('global', 'Global', 1, true, 280, 2, 5, 20, 45),
  ('trade', 'Trade', 2, true, 280, 1, 6, 20, 60)
on conflict (slug) do update
set display_name = excluded.display_name,
    sort_order = excluded.sort_order,
    is_enabled_by_default = excluded.is_enabled_by_default,
    max_length = excluded.max_length,
    cooldown_seconds = excluded.cooldown_seconds,
    rate_limit_count = excluded.rate_limit_count,
    rate_limit_window_seconds = excluded.rate_limit_window_seconds,
    duplicate_window_seconds = excluded.duplicate_window_seconds;

alter table public.chat_messages
  add column if not exists channel_slug text not null default 'global',
  add column if not exists normalized_body text not null default '';

create index if not exists chat_messages_channel_created_idx
  on public.chat_messages(channel_slug, created_at desc);

create index if not exists chat_messages_user_channel_created_idx
  on public.chat_messages(user_id, channel_slug, created_at desc);

create table if not exists public.chat_user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled_channels text[] not null default array['global','trade']::text[],
  active_channel text not null default 'global',
  muted_channels text[] not null default '{}'::text[],
  dock_collapsed boolean not null default false,
  dock_width integer,
  dock_height integer,
  updated_at timestamptz not null default now()
);

alter table public.chat_channels enable row level security;
alter table public.chat_user_state enable row level security;

drop policy if exists "chat_channels_read_authenticated" on public.chat_channels;
drop policy if exists "chat_user_state_owner_select" on public.chat_user_state;
drop policy if exists "chat_user_state_owner_upsert" on public.chat_user_state;

create policy "chat_channels_read_authenticated"
on public.chat_channels
for select
to authenticated
using (true);

create policy "chat_user_state_owner_select"
on public.chat_user_state
for select
to authenticated
using (auth.uid() = user_id);

create policy "chat_user_state_owner_upsert"
on public.chat_user_state
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create or replace function public.chat_normalize_text(p_text text)
returns text
language sql
immutable
as $$
  select trim(
    regexp_replace(
      lower(
        replace(
          replace(
            replace(
              replace(coalesce(p_text, ''), chr(8203), ''),
              chr(8204), ''
            ),
            chr(8205), ''
          ),
          chr(65279), ''
        )
      ),
      '\s+',
      ' ',
      'g'
    )
  );
$$;

create or replace function public.chat_messages_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display_name text;
begin
  if auth.uid() is not null then
    new.user_id := auth.uid();
  elsif new.user_id is null then
    raise exception 'Authentication required';
  end if;

  new.message := left(trim(new.message), 280);
  new.channel_slug := lower(trim(coalesce(new.channel_slug, 'global')));
  new.normalized_body := public.chat_normalize_text(new.message);

  if new.message = '' then
    raise exception 'Message cannot be empty';
  end if;

  select nullif(trim(up.display_name), '')
    into v_display_name
  from public.user_profiles up
  where up.user_id = new.user_id;

  new.display_name := coalesce(v_display_name, 'Anonymous');
  return new;
end;
$$;

drop trigger if exists trg_chat_messages_before_insert on public.chat_messages;
create trigger trg_chat_messages_before_insert
before insert on public.chat_messages
for each row
execute function public.chat_messages_before_insert();

create or replace function public.chat_get_state(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_channels jsonb;
  v_state public.chat_user_state%rowtype;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Unauthorized';
  end if;

  insert into public.chat_user_state (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select *
    into v_state
  from public.chat_user_state
  where user_id = p_user_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'slug', c.slug,
        'displayName', c.display_name,
        'sortOrder', c.sort_order
      )
      order by c.sort_order
    ),
    '[]'::jsonb
  )
    into v_channels
  from public.chat_channels c;

  return jsonb_build_object(
    'channels', v_channels,
    'userState', jsonb_build_object(
      'enabledChannels', v_state.enabled_channels,
      'activeChannel', v_state.active_channel,
      'mutedChannels', v_state.muted_channels,
      'dockCollapsed', v_state.dock_collapsed,
      'dockWidth', v_state.dock_width,
      'dockHeight', v_state.dock_height
    )
  );
end;
$$;

create or replace function public.chat_save_state(
  p_user_id uuid,
  p_enabled_channels text[] default null,
  p_active_channel text default null,
  p_muted_channels text[] default null,
  p_dock_collapsed boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.chat_user_state%rowtype;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Unauthorized';
  end if;

  insert into public.chat_user_state (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  update public.chat_user_state
    set enabled_channels = coalesce(p_enabled_channels, enabled_channels),
        active_channel = coalesce(p_active_channel, active_channel),
        muted_channels = coalesce(p_muted_channels, muted_channels),
        dock_collapsed = coalesce(p_dock_collapsed, dock_collapsed),
        updated_at = now()
  where user_id = p_user_id;

  select *
    into v_state
  from public.chat_user_state
  where user_id = p_user_id;

  return jsonb_build_object(
    'enabledChannels', v_state.enabled_channels,
    'activeChannel', v_state.active_channel,
    'mutedChannels', v_state.muted_channels,
    'dockCollapsed', v_state.dock_collapsed
  );
end;
$$;

create or replace function public.chat_send_message(
  p_user_id uuid,
  p_channel_slug text,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_channel public.chat_channels%rowtype;
  v_message text;
  v_normalized text;
  v_recent_count integer;
  v_last_message_at timestamptz;
  v_inserted public.chat_messages%rowtype;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Unauthorized';
  end if;

  v_message := left(trim(coalesce(p_body, '')), 280);
  if v_message = '' then
    raise exception 'Message cannot be empty';
  end if;

  select *
    into v_channel
  from public.chat_channels
  where slug = lower(trim(coalesce(p_channel_slug, '')));

  if not found then
    raise exception 'Invalid channel';
  end if;

  if char_length(v_message) > v_channel.max_length then
    raise exception 'Message exceeds max length.';
  end if;

  v_normalized := public.chat_normalize_text(v_message);

  select max(created_at)
    into v_last_message_at
  from public.chat_messages
  where user_id = p_user_id
    and channel_slug = v_channel.slug;

  if v_last_message_at is not null
    and v_last_message_at > now() - (v_channel.cooldown_seconds || ' seconds')::interval then
    raise exception 'You are sending messages too quickly.';
  end if;

  select count(*)
    into v_recent_count
  from public.chat_messages
  where user_id = p_user_id
    and channel_slug = v_channel.slug
    and created_at > now() - (v_channel.rate_limit_window_seconds || ' seconds')::interval;

  if v_recent_count >= v_channel.rate_limit_count then
    raise exception 'Rate limited.';
  end if;

  if exists (
    select 1
    from public.chat_messages
    where user_id = p_user_id
      and channel_slug = v_channel.slug
      and normalized_body = v_normalized
      and created_at > now() - (v_channel.duplicate_window_seconds || ' seconds')::interval
  ) then
    raise exception 'Duplicate message blocked.';
  end if;

  insert into public.chat_messages (user_id, channel_slug, message)
  values (p_user_id, v_channel.slug, v_message)
  returning *
    into v_inserted;

  return jsonb_build_object(
    'id', v_inserted.id,
    'channelSlug', v_inserted.channel_slug,
    'userId', v_inserted.user_id,
    'displayName', v_inserted.display_name,
    'message', v_inserted.message,
    'createdAt', v_inserted.created_at
  );
end;
$$;

grant select on public.chat_channels to authenticated;
grant select on public.chat_messages to authenticated;
grant select, insert, update on public.chat_user_state to authenticated;

grant execute on function public.chat_get_state(uuid) to authenticated;
grant execute on function public.chat_save_state(uuid, text[], text, text[], boolean) to authenticated;
grant execute on function public.chat_send_message(uuid, text, text) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end
$$;

notify pgrst, 'reload schema';
