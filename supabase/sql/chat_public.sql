create extension if not exists pgcrypto;

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null default 'Anonymous',
  message text not null check (char_length(trim(message)) between 1 and 280),
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_created_at_idx
  on public.chat_messages(created_at desc);

alter table public.chat_messages enable row level security;

drop policy if exists "chat_messages_read_authenticated" on public.chat_messages;
drop policy if exists "chat_messages_insert_authenticated" on public.chat_messages;

create policy "chat_messages_read_authenticated"
on public.chat_messages
for select
to authenticated
using (true);

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

grant select on public.chat_messages to authenticated;

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
