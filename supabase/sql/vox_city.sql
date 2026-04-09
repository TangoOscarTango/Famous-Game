create extension if not exists pgcrypto;

alter table public.user_profiles
  add column if not exists user_type text not null default 'player'
  check (user_type in ('player', 'dev'));

alter table public.user_profiles
  add column if not exists gender text not null default 'male'
  check (gender in ('male', 'female'));

create table if not exists public.vox_city_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  blood_type text not null check (blood_type in ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  ferocity double precision not null default 5,
  agility double precision not null default 5,
  instinct_combat double precision not null default 5,
  grit double precision not null default 5,
  gym_ferocity double precision not null default 1,
  gym_agility double precision not null default 1,
  gym_instinct_combat double precision not null default 1,
  gym_grit double precision not null default 1,
  active_gym text not null default 'scrap-yard-gym',
  energy integer not null default 100,
  max_energy integer not null default 100,
  nerve integer not null default 10,
  max_nerve integer not null default 10,
  happy integer not null default 100,
  max_happy integer not null default 100,
  life integer not null default 100,
  max_life integer not null default 100,
  total_gym_energy_spent bigint not null default 0,
  scavenging_skill integer not null default 1,
  college_classes integer not null default 0,
  scrap integer not null default 0,
  components integer not null default 0,
  rare_tech integer not null default 0,
  vox_points integer not null default 0,
  inventory_items jsonb not null default '[]'::jsonb,
  crime_log jsonb not null default '[]'::jsonb,
  medical_cooldown_seconds integer not null default 0,
  booster_cooldown_seconds integer not null default 0,
  drug_cooldown_seconds integer not null default 0,
  last_cooldown_processed_at timestamptz not null default now(),
  regen_energy_at timestamptz not null default now(),
  regen_nerve_at timestamptz not null default now(),
  regen_happy_at timestamptz not null default now(),
  morale_reset_checked_at timestamptz not null default now(),
  academy_active_course_slug text,
  academy_started_at timestamptz,
  regen_life_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vox_city_courses (
  slug text primary key,
  major text not null,
  major_order integer not null,
  course_order integer not null,
  display_name text not null,
  duration_seconds integer not null check (duration_seconds > 0),
  bonus_text text not null
);

create table if not exists public.vox_city_course_completions (
  user_id uuid not null references auth.users(id) on delete cascade,
  course_slug text not null references public.vox_city_courses(slug) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (user_id, course_slug)
);

create table if not exists public.vox_exchange_unlocks (
  user_id uuid not null references auth.users(id) on delete cascade,
  unlock_slug text not null,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, unlock_slug)
);

create table if not exists public.market_stocks (
  slug text primary key,
  display_name text not null,
  min_price_fp numeric(18,8) not null,
  max_price_fp numeric(18,8) not null,
  current_price_fp numeric(18,8) not null,
  last_change_pct numeric(10,6) not null default 0,
  block_size integer not null default 1,
  benefits jsonb not null default '[]'::jsonb,
  last_price_update_at timestamptz not null default now()
);

create table if not exists public.market_holdings (
  user_id uuid not null references auth.users(id) on delete cascade,
  stock_slug text not null references public.market_stocks(slug) on delete cascade,
  shares numeric(24,6) not null default 0,
  primary key (user_id, stock_slug)
);

create table if not exists public.market_benefit_claims (
  user_id uuid not null references auth.users(id) on delete cascade,
  stock_slug text not null references public.market_stocks(slug) on delete cascade,
  benefit_key text not null,
  last_claimed_at timestamptz,
  primary key (user_id, stock_slug, benefit_key)
);

create table if not exists public.vox_city_global_state (
  key text primary key,
  fp_value bigint not null default 0
);

create table if not exists public.vox_city_gyms (
  slug text primary key,
  display_name text not null,
  sort_order integer not null unique,
  tier text not null default 'special' check (tier in ('lightweight', 'medium', 'heavyweight', 'special')),
  fp_cost bigint not null default 0 check (fp_cost >= 0),
  energy_per_train integer not null check (energy_per_train in (5, 10, 25, 50)),
  energy_required bigint not null default 0 check (energy_required >= 0),
  dot_ferocity double precision not null,
  dot_agility double precision not null,
  dot_instinct_combat double precision not null,
  dot_grit double precision not null
);

create table if not exists public.vox_city_gym_unlocks (
  user_id uuid not null references auth.users(id) on delete cascade,
  gym_slug text not null references public.vox_city_gyms(slug) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, gym_slug)
);

-- Ensure new gym progression columns exist before seeding/upserting rows.
alter table public.vox_city_gyms
  add column if not exists tier text not null default 'special',
  add column if not exists energy_required bigint not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'vox_city_gyms_tier_check'
  ) then
    alter table public.vox_city_gyms
      add constraint vox_city_gyms_tier_check
      check (tier in ('lightweight', 'medium', 'heavyweight', 'special'));
  end if;
end
$$;

-- Prevent sort_order collisions on existing deployments before reseeding gym rows.
update public.vox_city_gyms
set sort_order = sort_order + 1000
where sort_order between 1 and 999;

-- Legacy gym slug migration before new progression data.
update public.vox_city_profiles
set active_gym = 'shoreline-brawlers'
where active_gym = 'pack-training-grounds';

update public.vox_city_profiles
set active_gym = 'bonebreaker-yard'
where active_gym = 'warclaw-conditioning-center';

update public.vox_city_profiles
set active_gym = 'pioneer-den'
where active_gym = 'vixenvox-athletic-complex';

insert into public.vox_city_gym_unlocks (user_id, gym_slug)
select user_id, 'shoreline-brawlers'
from public.vox_city_gym_unlocks
where gym_slug = 'pack-training-grounds'
on conflict (user_id, gym_slug) do nothing;

insert into public.vox_city_gym_unlocks (user_id, gym_slug)
select user_id, 'bonebreaker-yard'
from public.vox_city_gym_unlocks
where gym_slug = 'warclaw-conditioning-center'
on conflict (user_id, gym_slug) do nothing;

insert into public.vox_city_gym_unlocks (user_id, gym_slug)
select user_id, 'pioneer-den'
from public.vox_city_gym_unlocks
where gym_slug = 'vixenvox-athletic-complex'
on conflict (user_id, gym_slug) do nothing;

delete from public.vox_city_gym_unlocks
where gym_slug in ('pack-training-grounds', 'warclaw-conditioning-center', 'vixenvox-athletic-complex');

delete from public.vox_city_gyms
where slug in ('pack-training-grounds', 'warclaw-conditioning-center', 'vixenvox-athletic-complex');

insert into public.vox_city_gyms (
  slug, display_name, sort_order, tier, fp_cost, energy_per_train, energy_required,
  dot_ferocity, dot_agility, dot_instinct_combat, dot_grit
)
values
  ('scrap-yard-gym', 'Scrap Yard Gym', 1, 'lightweight', 10, 5, 0, 2.0, 2.0, 2.0, 2.0),
  ('rustfang-fitness', 'Rustfang Fitness', 2, 'lightweight', 100, 5, 200, 2.4, 2.4, 2.8, 2.4),
  ('iron-den', 'Iron Den', 3, 'lightweight', 250, 5, 500, 2.7, 3.2, 3.0, 2.7),
  ('shoreline-brawlers', 'Shoreline Brawlers', 4, 'lightweight', 500, 5, 1000, 3.2, 3.2, 3.2, 3.2),
  ('silverfang-gym', 'Silverfang Gym', 5, 'lightweight', 1000, 5, 2000, 3.4, 3.6, 3.4, 3.2),
  ('vixen-form-studio', 'Vixen Form Studio', 6, 'lightweight', 2500, 5, 2750, 3.4, 3.6, 3.6, 3.8),
  ('denmasters-pit', 'Denmasters Pit', 7, 'lightweight', 5000, 5, 3000, 3.7, 3.7, 3.7, 3.7),
  ('vox-central-gym', 'Vox Central Gym', 8, 'lightweight', 10000, 5, 3500, 4.0, 4.0, 4.0, 4.0),
  ('bonebreaker-yard', 'Bonebreaker Yard', 9, 'medium', 50000, 10, 4000, 4.8, 4.4, 4.0, 4.2),
  ('pioneer-den', 'Pioneer Den', 10, 'medium', 100000, 10, 6000, 4.4, 4.6, 4.8, 4.4),
  ('anomaly-forge', 'Anomaly Forge', 11, 'medium', 250000, 10, 7000, 5.0, 4.6, 5.2, 4.6),
  ('core-facility', 'Core Facility', 12, 'medium', 500000, 10, 8000, 5.0, 5.2, 5.0, 5.0),
  ('razortrack-fitness', 'Razortrack Fitness', 13, 'medium', 1000000, 10, 11000, 5.0, 5.4, 4.8, 5.2),
  ('pulse-cardio-hub', 'Pulse Cardio Hub', 14, 'medium', 2000000, 10, 12420, 5.5, 5.7, 5.5, 5.2),
  ('lowerbody-forge', 'Lowerbody Forge', 15, 'medium', 3000000, 10, 18000, 5.5, 5.5, 5.5, 5.7),
  ('deep-burn-complex', 'Deep Burn Complex', 16, 'medium', 5000000, 10, 18100, 6.0, 6.0, 6.0, 6.0),
  ('apollo-den', 'Apollo Den', 17, 'heavyweight', 7500000, 10, 24140, 6.0, 6.2, 6.4, 6.2),
  ('iron-armory', 'Iron Armory', 18, 'heavyweight', 10000000, 10, 31260, 6.5, 6.4, 6.2, 6.2),
  ('force-conditioning', 'Force Conditioning', 19, 'heavyweight', 15000000, 10, 36610, 6.4, 6.5, 6.4, 6.8),
  ('cha-den-arena', 'Cha Den Arena', 20, 'heavyweight', 20000000, 10, 46640, 6.4, 6.4, 6.8, 7.0),
  ('atlas-stronghold', 'Atlas Stronghold', 21, 'heavyweight', 30000000, 10, 56520, 7.0, 6.4, 6.4, 6.5),
  ('last-round-pit', 'Last Round Pit', 22, 'heavyweight', 50000000, 10, 67775, 6.8, 6.5, 7.0, 6.5),
  ('the-edge-arena', 'The Edge Arena', 23, 'heavyweight', 75000000, 10, 84535, 6.8, 7.0, 7.0, 6.8),
  ('apex-predator-facility', 'Apex Predator Facility', 24, 'heavyweight', 100000000, 10, 106305, 7.3, 7.3, 7.3, 7.3),
  ('fangforge', 'Fangforge', 25, 'special', 120000000, 50, 106305, 9.5, 7.2, 7.2, 7.2),
  ('ghoststep-arena', 'Ghoststep Arena', 26, 'special', 120000000, 50, 106305, 7.2, 9.5, 7.2, 7.2),
  ('shadow-reflex-lab', 'Shadow Reflex Lab', 27, 'special', 120000000, 50, 106305, 7.2, 7.2, 9.5, 7.2),
  ('ironhide-bastion', 'Ironhide Bastion', 28, 'special', 120000000, 50, 106305, 7.2, 7.2, 7.2, 9.5)
on conflict (slug) do update
set display_name = excluded.display_name,
    sort_order = excluded.sort_order,
    tier = excluded.tier,
    fp_cost = excluded.fp_cost,
    energy_per_train = excluded.energy_per_train,
    energy_required = excluded.energy_required,
    dot_ferocity = excluded.dot_ferocity,
    dot_agility = excluded.dot_agility,
    dot_instinct_combat = excluded.dot_instinct_combat,
    dot_grit = excluded.dot_grit;

insert into public.vox_city_courses (slug, major, major_order, course_order, display_name, duration_seconds, bonus_text)
values
  ('survival-waste-foraging','Survival Studies',1,1,'Waste Foraging',43200,'+1% item find chance from scavenging crimes'),
  ('survival-ruin-navigation','Survival Studies',1,2,'Ruin Navigation',172800,'+1% success chance on scavenging crimes'),
  ('survival-field-dressing','Survival Studies',1,3,'Field Dressing',64800,'+1% effectiveness from medical items'),
  ('survival-bunker-tracking','Survival Studies',1,4,'Bunker Tracking',172800,'+15% hunting / tracking effectiveness'),
  ('survival-apex','Survival Studies',1,5,'Apex Survival',518400,'+2% defense'),
  ('combat-basics','Combat Doctrine',2,1,'Urban Combat Basics',43200,'+1% Agility'),
  ('combat-sidearm','Combat Doctrine',2,2,'Sidearm Handling',172800,'+1 accuracy with pistol-class weapons'),
  ('combat-rifle','Combat Doctrine',2,3,'Rifle Handling',64800,'+1 accuracy with rifle-class weapons'),
  ('combat-heavy','Combat Doctrine',2,4,'Heavy Weapons Handling',172800,'+1 accuracy with heavy weapons'),
  ('combat-mastery','Combat Doctrine',2,5,'Combat Mastery',518400,'Unlock weapon experience system'),
  ('commerce-intro','Street Commerce',3,1,'Intro to Commerce',43200,'Prerequisite course'),
  ('commerce-logistics','Street Commerce',3,2,'Pack Logistics',172800,'+2% business productivity'),
  ('commerce-advertising','Street Commerce',3,3,'Vox Advertising',64800,'Increased advertising effectiveness'),
  ('commerce-pricing','Street Commerce',3,4,'Pricing Strategy',172800,'+5% perceived product value'),
  ('commerce-workforce','Street Commerce',3,5,'Workforce Coordination',518400,'Passive boost to employee working stats'),
  ('tech-identification','Tech Salvaging',4,1,'Scrap Identification',43200,'+1% rare item find chance'),
  ('tech-circuit-recovery','Tech Salvaging',4,2,'Circuit Recovery',172800,'+1% effectiveness from tech-based items'),
  ('tech-servicing','Tech Salvaging',4,3,'Weapon Servicing',64800,'+1 accuracy with tech-based weapons'),
  ('tech-power-systems','Tech Salvaging',4,4,'Power Systems',172800,'+2% damage with tech-based weapons'),
  ('tech-pre-fall-engineering','Tech Salvaging',4,5,'Pre-Fall Engineering',518400,'+1% success chance for tech-based crimes'),
  ('general-intro','General Survival Theory',5,1,'General Survival Intro',43200,'Prerequisite course'),
  ('general-throwables','General Survival Theory',5,2,'Improvised Throwables',172800,'+1 accuracy with temporary weapons'),
  ('general-chemistry','General Survival Theory',5,3,'Volatile Chemistry',64800,'+5% temporary weapon damage'),
  ('general-tracking','General Survival Theory',5,4,'Tracking Techniques',172800,'+15% hunting effectiveness'),
  ('general-discipline','General Survival Theory',5,5,'Learning Discipline',518400,'+10% working stat gains for future education completions')
on conflict (slug) do update
set major = excluded.major,
    major_order = excluded.major_order,
    course_order = excluded.course_order,
    display_name = excluded.display_name,
    duration_seconds = excluded.duration_seconds,
    bonus_text = excluded.bonus_text;

insert into public.market_stocks (slug, display_name, min_price_fp, max_price_fp, current_price_fp, block_size, benefits)
values
  (
    'gridpower',
    'GridPower',
    0.01000000,
    1.00000000,
    0.10000000,
    6000,
    '[{"key":"gridpower-energy-weekly","sharesRequired":6000,"cooldownSeconds":604800,"rewardType":"energy","rewardValue":100}]'::jsonb
  ),
  (
    'voxmedia',
    'VoxMedia',
    0.00050000,
    0.00500000,
    0.00100000,
    10000000,
    '[{"key":"voxmedia-oed-weekly","sharesRequired":10000000,"cooldownSeconds":604800,"rewardType":"item","rewardItem":"Outmine Entertainment Disk (OED)","rewardQuantity":1}]'::jsonb
  )
on conflict (slug) do update
set display_name = excluded.display_name,
    min_price_fp = excluded.min_price_fp,
    max_price_fp = excluded.max_price_fp,
    current_price_fp = excluded.current_price_fp,
    block_size = excluded.block_size,
    benefits = excluded.benefits;

insert into public.vox_city_global_state (key, fp_value)
values ('global_treasury_fp', 0)
on conflict (key) do nothing;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'vox_city_profiles'
      and column_name = 'active_gym'
  ) then
    alter table public.vox_city_profiles
      add column active_gym text not null default 'scrap-yard-gym';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'vox_city_profiles_active_gym_fkey'
  ) then
    alter table public.vox_city_profiles
      add constraint vox_city_profiles_active_gym_fkey
      foreign key (active_gym) references public.vox_city_gyms(slug);
  end if;
end
$$;

alter table public.vox_city_profiles
  alter column ferocity type double precision using ferocity::double precision,
  alter column agility type double precision using agility::double precision,
  alter column instinct_combat type double precision using instinct_combat::double precision,
  alter column grit type double precision using grit::double precision,
  alter column ferocity set default 5,
  alter column agility set default 5,
  alter column instinct_combat set default 5,
  alter column grit set default 5;

alter table public.vox_city_profiles
  add column if not exists gym_ferocity double precision not null default 1,
  add column if not exists gym_agility double precision not null default 1,
  add column if not exists gym_instinct_combat double precision not null default 1,
  add column if not exists gym_grit double precision not null default 1,
  add column if not exists total_gym_energy_spent bigint not null default 0,
  add column if not exists vox_points integer not null default 0,
  add column if not exists inventory_items jsonb not null default '[]'::jsonb,
  add column if not exists medical_cooldown_seconds integer not null default 0,
  add column if not exists booster_cooldown_seconds integer not null default 0,
  add column if not exists drug_cooldown_seconds integer not null default 0,
  add column if not exists last_cooldown_processed_at timestamptz not null default now(),
  add column if not exists morale_reset_checked_at timestamptz not null default now(),
  add column if not exists academy_active_course_slug text,
  add column if not exists academy_started_at timestamptz,
  add column if not exists active_gym text not null default 'scrap-yard-gym';

alter table public.vox_city_gyms
  add column if not exists tier text not null default 'special',
  add column if not exists energy_required bigint not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'vox_city_gyms_tier_check'
  ) then
    alter table public.vox_city_gyms
      add constraint vox_city_gyms_tier_check
      check (tier in ('lightweight', 'medium', 'heavyweight', 'special'));
  end if;
end
$$;

alter table public.vox_city_profiles enable row level security;
alter table public.vox_city_gym_unlocks enable row level security;
alter table public.vox_city_gyms enable row level security;
alter table public.vox_city_courses enable row level security;
alter table public.vox_city_course_completions enable row level security;
alter table public.vox_exchange_unlocks enable row level security;
alter table public.market_stocks enable row level security;
alter table public.market_holdings enable row level security;
alter table public.market_benefit_claims enable row level security;
alter table public.vox_city_global_state enable row level security;

drop policy if exists "vox_city_owner_select" on public.vox_city_profiles;
drop policy if exists "vox_city_owner_update" on public.vox_city_profiles;
drop policy if exists "vox_city_owner_insert" on public.vox_city_profiles;
drop policy if exists "vox_city_gyms_read" on public.vox_city_gyms;
drop policy if exists "vox_city_unlocks_owner_select" on public.vox_city_gym_unlocks;
drop policy if exists "vox_city_unlocks_no_client_write" on public.vox_city_gym_unlocks;
drop policy if exists "vox_city_courses_read" on public.vox_city_courses;
drop policy if exists "vox_city_course_completions_owner_read" on public.vox_city_course_completions;
drop policy if exists "vox_city_course_completions_no_client_write" on public.vox_city_course_completions;
drop policy if exists "vox_exchange_unlocks_owner_read" on public.vox_exchange_unlocks;
drop policy if exists "vox_exchange_unlocks_no_client_write" on public.vox_exchange_unlocks;
drop policy if exists "market_stocks_read" on public.market_stocks;
drop policy if exists "market_holdings_owner_read" on public.market_holdings;
drop policy if exists "market_holdings_no_client_write" on public.market_holdings;
drop policy if exists "market_benefit_claims_owner_read" on public.market_benefit_claims;
drop policy if exists "market_benefit_claims_no_client_write" on public.market_benefit_claims;
drop policy if exists "vox_city_global_state_read" on public.vox_city_global_state;

create policy "vox_city_owner_select"
on public.vox_city_profiles
for select
using (auth.uid() = user_id);

create policy "vox_city_owner_update"
on public.vox_city_profiles
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "vox_city_owner_insert"
on public.vox_city_profiles
for insert
with check (auth.uid() = user_id);

create policy "vox_city_gyms_read"
on public.vox_city_gyms
for select
using (true);

create policy "vox_city_unlocks_owner_select"
on public.vox_city_gym_unlocks
for select
using (auth.uid() = user_id);

create policy "vox_city_unlocks_no_client_write"
on public.vox_city_gym_unlocks
for all
using (false)
with check (false);

create policy "vox_city_courses_read"
on public.vox_city_courses
for select
using (true);

create policy "vox_city_course_completions_owner_read"
on public.vox_city_course_completions
for select
using (auth.uid() = user_id);

create policy "vox_city_course_completions_no_client_write"
on public.vox_city_course_completions
for all
using (false)
with check (false);

create policy "vox_exchange_unlocks_owner_read"
on public.vox_exchange_unlocks
for select
using (auth.uid() = user_id);

create policy "vox_exchange_unlocks_no_client_write"
on public.vox_exchange_unlocks
for all
using (false)
with check (false);

create policy "market_stocks_read"
on public.market_stocks
for select
using (true);

create policy "market_holdings_owner_read"
on public.market_holdings
for select
using (auth.uid() = user_id);

create policy "market_holdings_no_client_write"
on public.market_holdings
for all
using (false)
with check (false);

create policy "market_benefit_claims_owner_read"
on public.market_benefit_claims
for select
using (auth.uid() = user_id);

create policy "market_benefit_claims_no_client_write"
on public.market_benefit_claims
for all
using (false)
with check (false);

create policy "vox_city_global_state_read"
on public.vox_city_global_state
for select
using (true);

create or replace function public.market_refresh_prices()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock record;
  v_now timestamptz := now();
  v_hours integer;
  v_step integer;
  v_cur numeric(18,8);
  v_pct numeric(10,6);
  v_last_pct numeric(10,6);
  v_last_update timestamptz;
begin
  for v_stock in
    select slug, current_price_fp, min_price_fp, max_price_fp, last_price_update_at, last_change_pct
    from public.market_stocks
    order by slug
    for update
  loop
    v_hours := greatest(0, floor(extract(epoch from (v_now - v_stock.last_price_update_at)) / 3600)::int);
    if v_hours <= 0 then
      continue;
    end if;

    v_cur := v_stock.current_price_fp;
    v_last_pct := v_stock.last_change_pct;
    v_last_update := v_stock.last_price_update_at;

    for v_step in 1..v_hours loop
      v_pct := ((random() * 0.04) - 0.02)::numeric(10,6);
      v_cur := greatest(v_stock.min_price_fp, least(v_stock.max_price_fp, v_cur * (1 + v_pct)));
      v_last_pct := v_pct;
      v_last_update := date_trunc('hour', v_last_update) + interval '1 hour';
    end loop;

    update public.market_stocks
      set current_price_fp = round(v_cur, 8),
          last_change_pct = v_last_pct,
          last_price_update_at = v_last_update
    where slug = v_stock.slug;
  end loop;
end;
$$;

create or replace function public.vox_city_get_state(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_quarter_floor timestamptz;
  v_next_quarter timestamptz;
  v_elapsed_seconds integer := 0;
  v_energy_ticks integer;
  v_nerve_ticks integer;
  v_happy_ticks integer;
  v_life_ticks integer;
  v_life_gain integer;
  v_is_dev boolean := false;
  v_gender text := 'male';
  v_gyms jsonb := '[]'::jsonb;
  v_inventory_items jsonb := '[]'::jsonb;
  v_academy jsonb := '{}'::jsonb;
  v_exchange jsonb := '{}'::jsonb;
  v_market jsonb := '{}'::jsonb;
  v_treasury_fp bigint := 0;
  v_profile public.vox_city_profiles%rowtype;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Unauthorized';
  end if;

  insert into public.vox_city_profiles (
    user_id,
    blood_type
  )
  values (
    p_user_id,
    (array['A+','A-','B+','B-','AB+','AB-','O+','O-'])[floor(random() * 8 + 1)::int]
  )
  on conflict (user_id) do nothing;

  select *
    into v_profile
  from public.vox_city_profiles
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'Failed to load profile';
  end if;

  insert into public.vox_city_gym_unlocks (user_id, gym_slug)
  values (p_user_id, 'scrap-yard-gym')
  on conflict (user_id, gym_slug) do nothing;

  if not exists (
    select 1 from public.vox_city_gym_unlocks
    where user_id = p_user_id and gym_slug = v_profile.active_gym
  ) then
    v_profile.active_gym := 'scrap-yard-gym';
  end if;

  v_elapsed_seconds := greatest(0, floor(extract(epoch from (v_now - v_profile.last_cooldown_processed_at)))::integer);
  if v_elapsed_seconds > 0 then
    v_profile.medical_cooldown_seconds := greatest(0, v_profile.medical_cooldown_seconds - v_elapsed_seconds);
    v_profile.booster_cooldown_seconds := greatest(0, v_profile.booster_cooldown_seconds - v_elapsed_seconds);
    v_profile.drug_cooldown_seconds := greatest(0, v_profile.drug_cooldown_seconds - v_elapsed_seconds);
    v_profile.last_cooldown_processed_at := v_now;
  end if;

  v_quarter_floor := date_trunc('hour', v_now) + ((floor(extract(minute from v_now) / 15)::int) * interval '15 minutes');
  v_next_quarter := v_quarter_floor + interval '15 minutes';

  if v_profile.morale_reset_checked_at < v_quarter_floor and v_profile.happy > v_profile.max_happy then
    v_profile.happy := v_profile.max_happy;
  end if;
  if v_profile.morale_reset_checked_at < v_quarter_floor then
    v_profile.morale_reset_checked_at := v_quarter_floor;
  end if;

  if v_profile.academy_active_course_slug is not null and v_profile.academy_started_at is not null then
    if exists (
      select 1
      from public.vox_city_courses c
      where c.slug = v_profile.academy_active_course_slug
        and v_now >= v_profile.academy_started_at + make_interval(secs => c.duration_seconds)
    ) then
      insert into public.vox_city_course_completions (user_id, course_slug, completed_at)
      values (p_user_id, v_profile.academy_active_course_slug, v_now)
      on conflict (user_id, course_slug) do nothing;
      v_profile.academy_active_course_slug := null;
      v_profile.academy_started_at := null;
      v_profile.vox_points := v_profile.vox_points + 1;
    end if;
  end if;

  v_energy_ticks := floor(extract(epoch from (v_now - v_profile.regen_energy_at)) / 300);
  if v_energy_ticks > 0 then
    if v_profile.energy < v_profile.max_energy then
      v_profile.energy := least(v_profile.max_energy, v_profile.energy + v_energy_ticks * 5);
    end if;
    v_profile.regen_energy_at := v_profile.regen_energy_at + (v_energy_ticks * interval '5 minutes');
  end if;

  v_nerve_ticks := floor(extract(epoch from (v_now - v_profile.regen_nerve_at)) / 300);
  if v_nerve_ticks > 0 then
    v_profile.nerve := least(v_profile.max_nerve, v_profile.nerve + v_nerve_ticks);
    v_profile.regen_nerve_at := v_profile.regen_nerve_at + (v_nerve_ticks * interval '5 minutes');
  end if;

  v_happy_ticks := floor(extract(epoch from (v_now - v_profile.regen_happy_at)) / 900);
  if v_happy_ticks > 0 then
    if v_profile.happy < v_profile.max_happy then
      v_profile.happy := least(v_profile.max_happy, v_profile.happy + v_happy_ticks);
    end if;
    v_profile.regen_happy_at := v_profile.regen_happy_at + (v_happy_ticks * interval '15 minutes');
  end if;

  v_life_ticks := floor(extract(epoch from (v_now - v_profile.regen_life_at)) / 300);
  if v_life_ticks > 0 then
    v_life_gain := greatest(1, floor(v_profile.max_life * 0.04));
    v_profile.life := least(v_profile.max_life, v_profile.life + v_life_ticks * v_life_gain);
    v_profile.regen_life_at := v_profile.regen_life_at + (v_life_ticks * interval '5 minutes');
  end if;

  update public.vox_city_profiles
    set energy = v_profile.energy,
        nerve = v_profile.nerve,
        happy = v_profile.happy,
        total_gym_energy_spent = v_profile.total_gym_energy_spent,
        vox_points = v_profile.vox_points,
        life = v_profile.life,
        regen_energy_at = v_profile.regen_energy_at,
        regen_nerve_at = v_profile.regen_nerve_at,
        regen_happy_at = v_profile.regen_happy_at,
        medical_cooldown_seconds = v_profile.medical_cooldown_seconds,
        booster_cooldown_seconds = v_profile.booster_cooldown_seconds,
        drug_cooldown_seconds = v_profile.drug_cooldown_seconds,
        last_cooldown_processed_at = v_profile.last_cooldown_processed_at,
        morale_reset_checked_at = v_profile.morale_reset_checked_at,
        academy_active_course_slug = v_profile.academy_active_course_slug,
        academy_started_at = v_profile.academy_started_at,
        regen_life_at = v_profile.regen_life_at,
        active_gym = v_profile.active_gym,
        updated_at = now()
  where user_id = p_user_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'slug', g.slug,
        'displayName', g.display_name,
        'sortOrder', g.sort_order,
        'tier', g.tier,
        'costFp', g.fp_cost,
        'energyPerTrain', g.energy_per_train,
        'energyRequired', g.energy_required,
        'dots', jsonb_build_object(
          'ferocity', g.dot_ferocity,
          'agility', g.dot_agility,
          'instinctCombat', g.dot_instinct_combat,
          'grit', g.dot_grit
        ),
        'unlocked', (u.gym_slug is not null),
        'active', (g.slug = v_profile.active_gym)
      )
      order by g.sort_order
    ),
    '[]'::jsonb
  )
    into v_gyms
  from public.vox_city_gyms g
  left join public.vox_city_gym_unlocks u
    on u.gym_slug = g.slug
   and u.user_id = p_user_id;

  v_inventory_items := coalesce(v_profile.inventory_items, '[]'::jsonb);

  select (up.user_type = 'dev')
    into v_is_dev
  from public.user_profiles up
  where up.user_id = p_user_id;

  select coalesce(up.gender, 'male')
    into v_gender
  from public.user_profiles up
  where up.user_id = p_user_id;

  perform public.market_refresh_prices();

  select coalesce(fp_value, 0)
    into v_treasury_fp
  from public.vox_city_global_state
  where key = 'global_treasury_fp';

  select jsonb_build_object(
    'activeCourseSlug', v_profile.academy_active_course_slug,
    'startedAt', v_profile.academy_started_at,
    'courses', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'slug', c.slug,
          'major', c.major,
          'majorOrder', c.major_order,
          'courseOrder', c.course_order,
          'displayName', c.display_name,
          'durationSeconds', c.duration_seconds,
          'bonus', c.bonus_text,
          'completed', (cc.course_slug is not null),
          'inProgress', (v_profile.academy_active_course_slug = c.slug)
        )
        order by c.major_order, c.course_order
      ), '[]'::jsonb)
      from public.vox_city_courses c
      left join public.vox_city_course_completions cc
        on cc.course_slug = c.slug
       and cc.user_id = p_user_id
    )
  ) into v_academy;

  select jsonb_build_object(
    'voxPoints', v_profile.vox_points,
    'unlocks', (
      select coalesce(jsonb_agg(jsonb_build_object('slug', unlock_slug, 'unlockedAt', unlocked_at)), '[]'::jsonb)
      from public.vox_exchange_unlocks
      where user_id = p_user_id
    ),
    'catalog', jsonb_build_array(
      jsonb_build_object('slug', 'market-grid-access', 'name', 'Market Grid Access', 'costPoints', 25),
      jsonb_build_object('slug', 'name-change', 'name', 'Name Change', 'costPoints', 50),
      jsonb_build_object('slug', 'cosmetic-upgrade', 'name', 'Cosmetic Upgrade', 'costPoints', 35)
    )
  ) into v_exchange;

  select jsonb_build_object(
    'stocks', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'slug', s.slug,
          'name', s.display_name,
          'currentPriceFp', s.current_price_fp,
          'minPriceFp', s.min_price_fp,
          'maxPriceFp', s.max_price_fp,
          'lastChangePct', s.last_change_pct,
          'blockSize', s.block_size,
          'benefits', s.benefits,
          'sharesOwned', coalesce(h.shares, 0)
        )
        order by s.slug
      ), '[]'::jsonb)
      from public.market_stocks s
      left join public.market_holdings h
        on h.stock_slug = s.slug
       and h.user_id = p_user_id
    ),
    'treasuryFp', v_treasury_fp
  ) into v_market;

  return jsonb_build_object(
    'battle', jsonb_build_object(
      'ferocity', v_profile.ferocity,
      'agility', v_profile.agility,
      'instinctCombat', v_profile.instinct_combat,
      'grit', v_profile.grit
    ),
    'resources', jsonb_build_object(
      'energy', v_profile.energy,
      'maxEnergy', v_profile.max_energy,
      'nerve', v_profile.nerve,
      'maxNerve', v_profile.max_nerve,
      'happy', v_profile.happy,
      'maxHappy', v_profile.max_happy,
      'nextMoraleResetAt', v_next_quarter,
      'life', v_profile.life,
      'maxLife', v_profile.max_life
    ),
    'scavengingSkill', v_profile.scavenging_skill,
    'collegeClasses', v_profile.college_classes,
    'totalGymEnergySpent', v_profile.total_gym_energy_spent,
    'inventory', jsonb_build_object(
      'scrap', v_profile.scrap,
      'components', v_profile.components,
      'rareTech', v_profile.rare_tech
    ),
    'inventoryItems', v_inventory_items,
    'gender', v_gender,
    'cooldowns', jsonb_build_object(
      'medicalSeconds', v_profile.medical_cooldown_seconds,
      'medicalMaxSeconds', 21600,
      'boosterSeconds', v_profile.booster_cooldown_seconds,
      'boosterMaxSeconds', 86400,
      'drugSeconds', v_profile.drug_cooldown_seconds
    ),
    'crimeLog', coalesce(v_profile.crime_log, '[]'::jsonb),
    'isDev', coalesce(v_is_dev, false),
    'academy', v_academy,
    'exchange', v_exchange,
    'market', v_market,
    'activeGym', v_profile.active_gym,
    'gyms', v_gyms
  );
end;
$$;

create or replace function public.vox_city_apply_action(
  p_user_id uuid,
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_profile public.vox_city_profiles%rowtype;
  v_notice text := '';
  v_is_dev boolean := false;
  v_gym public.vox_city_gyms%rowtype;
  v_stat text;
  v_approach text;
  v_gain integer;
  v_train_count integer;
  v_trains_done integer := 0;
  v_energy_per_train integer;
  v_s_formula double precision;
  v_h_formula double precision;
  v_log_term numeric;
  v_multiplier numeric;
  v_part1 double precision;
  v_part2 double precision;
  v_part3 double precision;
  v_part4 double precision;
  v_random_term integer;
  v_base double precision;
  v_gym_dots double precision;
  v_const_a double precision;
  v_const_b double precision;
  v_const_c integer;
  v_perks jsonb;
  v_perk numeric;
  v_happy_loss integer;
  v_total_gain double precision := 0;
  v_roll double precision;
  v_skill_bonus double precision;
  v_happy_bonus double precision;
  v_fail_chance double precision;
  v_partial_chance double precision;
  v_success_chance double precision;
  v_exceptional_chance double precision;
  v_outcome text;
  v_nerve_cost integer;
  v_summary text;
  v_scrap integer;
  v_components integer;
  v_entry jsonb;
  v_target_gym text;
  v_target_order integer;
  v_target_energy_required bigint;
  v_required_prev_slug text;
  v_is_special boolean := false;
  v_apex_unlocked boolean := false;
  v_wallet_balance bigint;
  v_vital text;
  v_amount integer;
  v_item_name text;
  v_item_desc text;
  v_item_rarity text;
  v_item_roll double precision;
  v_bundle_roll double precision;
  v_qty integer;
  v_item_category text;
  v_item_morale_boost integer := 0;
  v_item_index integer;
  v_existing_qty integer;
  v_existing_item jsonb;
  v_item_cooldown_type text := 'none';
  v_item_cooldown_add_seconds integer := 0;
  v_item_energy_boost integer := 0;
  v_item_life_boost integer := 0;
  v_market_stock_slug text;
  v_market_amount_fp numeric(18,8);
  v_market_shares numeric(24,6);
  v_market_price numeric(18,8);
  v_market_fee numeric(18,8);
  v_market_tx_amount numeric(18,8);
  v_market_current_shares numeric(24,6);
  v_market_benefit jsonb;
  v_market_benefit_key text;
  v_market_benefit_shares numeric(24,6);
  v_market_benefit_cd integer;
  v_market_last_claim timestamptz;
  v_exchange_unlock_slug text;
  v_exchange_cost integer;
  v_course_slug text;
  v_course_major_order integer;
  v_course_order integer;
  v_prev_course_slug text;
  v_course_duration integer;
  v_treasury_value bigint;
  v_skill_gain integer := 0;
  v_fail_text text;
  v_common_items text[] := array[
    'Rusted Bolt Cluster','Cracked Circuit Plate','Bent Alloy Shard','Scrap Wire Bundle',
    'Empty Fuel Cell','Broken Optic Lens','Worn Gear Cog','Charred Metal Fragment',
    'Loose Spring Pack','Shattered Glass Panel','Melted Plastic Chunk','Corroded Pipe Segment'
  ];
  v_candy_common_items text[] := array[
    'Sugarroot Candy Strip','Foxfire Taffy','Dustberry Chew','Burnt Honey Bite','Glowgum Pellet',
    'Sweet Rust Bar','Ember Sugar Cube','Caramel Ash Drop','Neon Jelly Nugget','Crackle Candy Shard'
  ];
  v_candy_mid_items text[] := array[
    'Foxiz Delight Pack','Sweetwater Flask','Voxel Candy Cluster','Gilded Sugar Brick','Spiced Ember Treat',
    'Velvet Chew Bar','Honeyflare Roll','Radiant Berry Mix','Golden Syrup Stick','Refined Glowgum Pack'
  ];
  v_candy_edgy_items text[] := array[
    'Blackmarket Sweet Tab','Neon Bliss Capsule','Foxfire Infusion Vial','Dreamdust Candy','Overcharge Chew'
  ];
  v_candy_rare_items text[] := array[
    'Pre-Fall Candy Tin','Royal Fox Feast Box','Vixenvox Festival Treat','Pack Celebration Bundle'
  ];
  v_consumable_items text[] := array[
    'Patch Tape Roll','Basic Med Gel','Ration Pack','Dirty Water Flask',
    'Adrenal Shot','Focus Chew','Bandage Wrap','Energy Chew Stick'
  ];
  v_uncommon_items text[] := array[
    'Charged Micro Cell','Clean Water Flask','Reinforced Scrap Plate','Salvaged Tool Kit',
    'Signal Beacon Chip','Old World Coin','Mystery Injector','Unknown Powder Vial',
    'Black-Market Capsule','Foxfire Stimulant'
  ];
  v_rare_items text[] := array[
    'Pre-Fall Data Chip','Intact Energy Cell','Vixenvox Token','Pack Insignia','Hidden Stash Cache'
  ];
  v_desc_pool text[] := array[
    'Barely holds together, but still worth a few FP.',
    'Smells like chemicals. Probably still usable.',
    'Someone hid this well. Not well enough.',
    'Dust-caked, but the core still hums.',
    'Could be junk, could be leverage in the right hands.',
    'You brush off ash and pocket it before anyone notices.',
    'Scuffed and ugly, but traders still buy this stuff.',
    'It rattles when you move. That is usually a good sign.',
    'Stamped with pre-fall markings almost worn away.',
    'The casing is cracked, but the internals look stable.',
    'Not pretty, but it might keep someone alive tonight.',
    'Recovered from deep rubble and still intact.'
  ];
  v_fail_careful text[] := array[
    'You map the room and find only dust.',
    'You trace old footprints to a dead end.',
    'A false panel leads nowhere useful.',
    'Your route is clean, but already picked over.',
    'Loose rubble collapses before you can reach the cache.',
    'An empty locker clicks shut behind you.',
    'You spend too long on a decoy compartment.',
    'The tunnel looked promising, then ended in slag.',
    'A scavenger beat you to every shelf.',
    'You search methodically and come up dry.'
  ];
  v_fail_quick text[] := array[
    'You rush the aisle and trigger a rustfall.',
    'A fast snatch turns into a hard stumble.',
    'You grab a fake crate and lose momentum.',
    'A loose cable whips your leg as you sprint out.',
    'You hit the wrong room and burn your window.',
    'A door jams while you force it.',
    'You snatch junk and drop it in the scramble.',
    'Your shortcut was blocked with fresh debris.',
    'You move too fast and miss every viable stash.',
    'A panicked pull leaves you empty-handed.'
  ];
  v_fail_deep text[] := array[
    'The deep shaft floods with toxic dust.',
    'A support beam snaps and pins your route.',
    'Your lamp fails in a collapsed pocket.',
    'An old trap compartment detonates sparks.',
    'You breach too deep and hit unstable flooring.',
    'A sealed vault vents heat and forces retreat.',
    'Your extraction path caves in behind you.',
    'You force a hatch and catch shrapnel.',
    'A hidden drop shaft clips you on descent.',
    'The chamber is empty after all that risk.'
  ];
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Unauthorized';
  end if;

  perform public.vox_city_get_state(p_user_id);

  select *
    into v_profile
  from public.vox_city_profiles
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'Failed to load profile';
  end if;

  select (up.user_type = 'dev')
    into v_is_dev
  from public.user_profiles up
  where up.user_id = p_user_id;

  if p_action = 'train' then
    v_stat := lower(coalesce(p_payload ->> 'stat', ''));
    v_train_count := coalesce((p_payload ->> 'trains')::integer, 1);
    v_train_count := greatest(1, least(v_train_count, 100));
    select g.*
      into v_gym
    from public.vox_city_gyms g
    where g.slug = v_profile.active_gym;

    if not found then
      raise exception 'Active gym not found.';
    end if;

    v_energy_per_train := v_gym.energy_per_train;
    v_perks := coalesce(p_payload -> 'perks', '[]'::jsonb);

    if v_stat = 'ferocity' then
      v_const_a := 1600;
      v_const_b := 1700;
      v_const_c := 700;
      v_gym_dots := v_gym.dot_ferocity;
    elsif v_stat = 'agility' then
      v_const_a := 1600;
      v_const_b := 2000;
      v_const_c := 1350;
      v_gym_dots := v_gym.dot_agility;
    elsif v_stat = 'instinctcombat' then
      v_const_a := 1800;
      v_const_b := 1500;
      v_const_c := 1000;
      v_gym_dots := v_gym.dot_instinct_combat;
    elsif v_stat = 'grit' then
      v_const_a := 2100;
      v_const_b := -600;
      v_const_c := 1500;
      v_gym_dots := v_gym.dot_grit;
    else
      raise exception 'Invalid training stat.';
    end if;

    v_gym_dots := greatest(0, least(v_gym_dots, 10));

    for v_gain in 1..v_train_count loop
      exit when v_profile.energy < v_energy_per_train;

      if v_stat = 'ferocity' then
        v_s_formula := least(v_profile.ferocity, 50000000);
      elsif v_stat = 'agility' then
        v_s_formula := least(v_profile.agility, 50000000);
      elsif v_stat = 'instinctcombat' then
        v_s_formula := least(v_profile.instinct_combat, 50000000);
      else
        v_s_formula := least(v_profile.grit, 50000000);
      end if;

      v_h_formula := greatest(0, least(v_profile.happy, 99999));
      v_log_term := round(ln(1 + (v_h_formula / 250.0))::numeric, 4);
      v_multiplier := round((1 + 0.07 * v_log_term)::numeric, 4);

      v_part1 := v_s_formula * v_multiplier::double precision;
      v_part2 := 8 * power(v_h_formula, 1.05);
      v_part3 := (1 - power(v_h_formula / 99999.0, 2)) * v_const_a;
      v_part4 := v_const_b;
      v_random_term := floor(random() * (2 * v_const_c + 1))::integer - v_const_c;

      v_base := v_part1 + v_part2 + v_part3 + v_part4 + v_random_term;
      v_base := v_base / 200000.0;
      v_base := v_base * v_gym_dots * v_energy_per_train;

      if jsonb_typeof(v_perks) = 'array' then
        for v_perk in
          select value::numeric
          from jsonb_array_elements_text(v_perks)
        loop
          v_base := v_base * (1 + v_perk::double precision);
        end loop;
      end if;

      if v_stat = 'ferocity' then
        v_profile.ferocity := v_profile.ferocity + v_base;
      elsif v_stat = 'agility' then
        v_profile.agility := v_profile.agility + v_base;
      elsif v_stat = 'instinctcombat' then
        v_profile.instinct_combat := v_profile.instinct_combat + v_base;
      else
        v_profile.grit := v_profile.grit + v_base;
      end if;

      v_total_gain := v_total_gain + v_base;
      v_profile.energy := greatest(0, v_profile.energy - v_energy_per_train);
      v_profile.total_gym_energy_spent := v_profile.total_gym_energy_spent + v_energy_per_train;

      v_happy_loss := round((v_energy_per_train::numeric / 10.0) * (4 + floor(random() * 3))::numeric, 0)::integer;
      v_profile.happy := greatest(0, v_profile.happy - v_happy_loss);

      v_trains_done := v_trains_done + 1;
    end loop;

    if v_trains_done = 0 then
      raise exception 'Not enough Stamina.';
    end if;

    v_notice := format('Training complete: %s train(s), +%s total gain.', v_trains_done, round(v_total_gain::numeric, 4));

  elsif p_action = 'buy_gym' then
    v_target_gym := lower(coalesce(p_payload ->> 'gymSlug', ''));
    if v_target_gym = '' then
      raise exception 'Missing gym slug.';
    end if;

    if exists (
      select 1
      from public.vox_city_gym_unlocks
      where user_id = p_user_id
        and gym_slug = v_target_gym
    ) then
      raise exception 'Gym already unlocked.';
    end if;

    select sort_order, energy_required
      into v_target_order, v_target_energy_required
    from public.vox_city_gyms
    where slug = v_target_gym;

    if v_target_order is null then
      raise exception 'Invalid gym.';
    end if;

    v_is_special := v_target_gym in ('fangforge', 'ghoststep-arena', 'shadow-reflex-lab', 'ironhide-bastion');
    select exists (
      select 1
      from public.vox_city_gym_unlocks
      where user_id = p_user_id
        and gym_slug = 'apex-predator-facility'
    ) into v_apex_unlocked;

    if v_is_special then
      if not v_apex_unlocked then
        raise exception 'Apex Predator Facility must be unlocked first.';
      end if;
    else
      if v_target_order > 1 and v_target_order <= 24 then
        select slug
          into v_required_prev_slug
        from public.vox_city_gyms
        where sort_order = v_target_order - 1;

        if not exists (
          select 1
          from public.vox_city_gym_unlocks
          where user_id = p_user_id
            and gym_slug = v_required_prev_slug
        ) then
          raise exception 'Previous gym must be unlocked first.';
        end if;
      end if;

      if v_target_order <= 24 and v_profile.total_gym_energy_spent < v_target_energy_required then
        raise exception 'Not enough lifetime gym energy spent to unlock this gym.';
      end if;
    end if;

    select balance_sats
      into v_wallet_balance
    from public.wallet_profiles
    where user_id = p_user_id
    for update;

    if v_wallet_balance is null then
      v_wallet_balance := 0;
      insert into public.wallet_profiles (user_id, balance_sats, updated_at)
      values (p_user_id, 0, now())
      on conflict (user_id) do nothing;
    end if;

    select fp_cost
      into v_gain
    from public.vox_city_gyms
    where slug = v_target_gym;

    if v_wallet_balance < v_gain then
      raise exception 'Not enough FP to unlock this gym.';
    end if;

    update public.wallet_profiles
      set balance_sats = balance_sats - v_gain,
          updated_at = now()
    where user_id = p_user_id;

    insert into public.wallet_ledger (
      id, user_id, direction, amount_sats, source, note, status, created_at
    )
    values (
      gen_random_uuid(),
      p_user_id,
      'debit',
      v_gain,
      'game_action',
      'Gym unlock purchase',
      'confirmed',
      now()
    );

    insert into public.vox_city_gym_unlocks (user_id, gym_slug)
    values (p_user_id, v_target_gym);

    if v_target_gym = 'apex-predator-facility' then
      insert into public.vox_city_gym_unlocks (user_id, gym_slug)
      select p_user_id, slug
      from public.vox_city_gyms
      where tier = 'special'
      on conflict (user_id, gym_slug) do nothing;
    end if;

    v_profile.active_gym := v_target_gym;
    v_notice := 'Gym unlocked and activated.';

  elsif p_action = 'set_gym' then
    v_target_gym := lower(coalesce(p_payload ->> 'gymSlug', ''));
    if v_target_gym = '' then
      raise exception 'Missing gym slug.';
    end if;

    if not exists (
      select 1
      from public.vox_city_gym_unlocks
      where user_id = p_user_id
        and gym_slug = v_target_gym
    ) then
      raise exception 'Gym is not unlocked.';
    end if;

    v_profile.active_gym := v_target_gym;
    v_notice := 'Active gym changed.';

  elsif p_action = 'class' then
    if v_profile.energy < 8 or v_profile.happy < 5 then
      raise exception 'Need at least 8 Stamina and 5 Morale.';
    end if;

    v_profile.college_classes := v_profile.college_classes + 1;
    v_profile.energy := greatest(0, v_profile.energy - 8);
    v_profile.happy := greatest(0, v_profile.happy - 5);
    v_notice := 'Academy class completed.';

  elsif p_action = 'crime' then
    v_approach := lower(coalesce(p_payload ->> 'approach', ''));

    if v_approach = 'careful' then
      v_nerve_cost := 2;
      v_fail_chance := 0.14;
      v_partial_chance := 0.46;
      v_success_chance := 0.34;
    elsif v_approach = 'quick' then
      v_nerve_cost := 3;
      v_fail_chance := 0.24;
      v_partial_chance := 0.34;
      v_success_chance := 0.34;
    elsif v_approach = 'deep' then
      if v_profile.scavenging_skill < 25 then
        raise exception 'Deep Dig unlocks at Scavenging 25.';
      end if;
      v_nerve_cost := 4;
      v_fail_chance := 0.36;
      v_partial_chance := 0.24;
      v_success_chance := 0.28;
    else
      raise exception 'Invalid approach.';
    end if;

    if v_profile.nerve < v_nerve_cost then
      raise exception 'Insufficient Instinct.';
    end if;

    v_profile.nerve := greatest(0, v_profile.nerve - v_nerve_cost);

    v_skill_bonus := least(0.2, v_profile.scavenging_skill / 250.0);
    v_happy_bonus := least(0.1, v_profile.happy / 1000.0);
    v_fail_chance := greatest(0.04, least(0.8, v_fail_chance - v_skill_bonus));
    v_partial_chance := greatest(0.1, least(0.8, v_partial_chance - v_skill_bonus / 3.0));
    v_success_chance := greatest(0.1, least(0.8, v_success_chance + v_skill_bonus + v_happy_bonus));
    v_exceptional_chance := greatest(0.02, least(0.3, 1 - (v_fail_chance + v_partial_chance + v_success_chance)));

    v_roll := random();
    if v_roll < v_fail_chance then
      v_outcome := 'Fail';
    elsif v_roll < v_fail_chance + v_partial_chance then
      v_outcome := 'Partial';
    elsif v_roll < v_fail_chance + v_partial_chance + v_success_chance then
      v_outcome := 'Success';
    else
      v_outcome := 'Exceptional';
    end if;

    if v_outcome = 'Fail' then
      if v_approach = 'careful' then
        v_fail_text := v_fail_careful[1 + floor(random() * array_length(v_fail_careful, 1))::integer];
      elsif v_approach = 'quick' then
        v_fail_text := v_fail_quick[1 + floor(random() * array_length(v_fail_quick, 1))::integer];
      else
        v_fail_text := v_fail_deep[1 + floor(random() * array_length(v_fail_deep, 1))::integer];
      end if;

      v_gain := greatest(1, least(8, floor(2 + random() * 6 - v_profile.grit / 55.0)));
      if v_approach = 'deep' then
        v_gain := v_gain + 1;
      end if;
      v_profile.life := greatest(0, v_profile.life - v_gain);
      v_profile.happy := greatest(0, v_profile.happy - 2);
      v_summary := format('%s (-%s Life).', v_fail_text, v_gain);
      v_skill_gain := 1;
    else
      v_item_roll := random();
      v_bundle_roll := random();

      if v_bundle_roll < 0.015 then
        v_item_rarity := 'Rare';
        v_item_name := 'Hidden Stash Cache';
      else
        if v_approach = 'careful' then
          if v_outcome = 'Partial' then
            if v_item_roll < 0.78 then v_item_rarity := 'Common';
            elsif v_item_roll < 0.96 then v_item_rarity := 'Consumable';
            else v_item_rarity := 'Uncommon'; end if;
          elsif v_outcome = 'Success' then
            if v_item_roll < 0.68 then v_item_rarity := 'Common';
            elsif v_item_roll < 0.88 then v_item_rarity := 'Consumable';
            elsif v_item_roll < 0.98 then v_item_rarity := 'Uncommon';
            else v_item_rarity := 'Rare'; end if;
          else
            if v_item_roll < 0.52 then v_item_rarity := 'Common';
            elsif v_item_roll < 0.76 then v_item_rarity := 'Consumable';
            elsif v_item_roll < 0.92 then v_item_rarity := 'Uncommon';
            else v_item_rarity := 'Rare'; end if;
          end if;
        elsif v_approach = 'quick' then
          if v_outcome = 'Partial' then
            if v_item_roll < 0.70 then v_item_rarity := 'Common';
            elsif v_item_roll < 0.90 then v_item_rarity := 'Consumable';
            elsif v_item_roll < 0.98 then v_item_rarity := 'Uncommon';
            else v_item_rarity := 'Rare'; end if;
          elsif v_outcome = 'Success' then
            if v_item_roll < 0.60 then v_item_rarity := 'Common';
            elsif v_item_roll < 0.80 then v_item_rarity := 'Consumable';
            elsif v_item_roll < 0.94 then v_item_rarity := 'Uncommon';
            else v_item_rarity := 'Rare'; end if;
          else
            if v_item_roll < 0.44 then v_item_rarity := 'Common';
            elsif v_item_roll < 0.66 then v_item_rarity := 'Consumable';
            elsif v_item_roll < 0.86 then v_item_rarity := 'Uncommon';
            else v_item_rarity := 'Rare'; end if;
          end if;
        else
          if v_outcome = 'Partial' then
            if v_item_roll < 0.62 then v_item_rarity := 'Common';
            elsif v_item_roll < 0.84 then v_item_rarity := 'Consumable';
            elsif v_item_roll < 0.96 then v_item_rarity := 'Uncommon';
            else v_item_rarity := 'Rare'; end if;
          elsif v_outcome = 'Success' then
            if v_item_roll < 0.50 then v_item_rarity := 'Common';
            elsif v_item_roll < 0.72 then v_item_rarity := 'Consumable';
            elsif v_item_roll < 0.90 then v_item_rarity := 'Uncommon';
            else v_item_rarity := 'Rare'; end if;
          else
            if v_item_roll < 0.36 then v_item_rarity := 'Common';
            elsif v_item_roll < 0.60 then v_item_rarity := 'Consumable';
            elsif v_item_roll < 0.84 then v_item_rarity := 'Uncommon';
            else v_item_rarity := 'Rare'; end if;
          end if;
        end if;

        if v_item_rarity = 'Common' then
          if random() < 0.40 then
            v_item_name := v_candy_common_items[1 + floor(random() * array_length(v_candy_common_items, 1))::integer];
          else
            v_item_name := v_common_items[1 + floor(random() * array_length(v_common_items, 1))::integer];
          end if;
        elsif v_item_rarity = 'Consumable' then
          if random() < 0.45 then
            v_item_name := v_candy_mid_items[1 + floor(random() * array_length(v_candy_mid_items, 1))::integer];
          else
            v_item_name := v_consumable_items[1 + floor(random() * array_length(v_consumable_items, 1))::integer];
          end if;
        elsif v_item_rarity = 'Uncommon' then
          if random() < 0.30 then
            v_item_name := v_candy_edgy_items[1 + floor(random() * array_length(v_candy_edgy_items, 1))::integer];
          else
            v_item_name := v_uncommon_items[1 + floor(random() * array_length(v_uncommon_items, 1))::integer];
          end if;
        else
          if random() < 0.40 then
            v_item_name := v_candy_rare_items[1 + floor(random() * array_length(v_candy_rare_items, 1))::integer];
          else
            v_item_name := v_rare_items[1 + floor(random() * (array_length(v_rare_items, 1) - 1))::integer];
          end if;
        end if;
      end if;

      v_item_desc := v_desc_pool[1 + floor(random() * array_length(v_desc_pool, 1))::integer];

      if v_item_name = 'Hidden Stash Cache' then
        v_scrap := 4 + floor(random() * 6);
        v_components := 2 + floor(random() * 4);
        v_profile.scrap := v_profile.scrap + v_scrap;
        v_profile.components := v_profile.components + v_components;
        if random() < 0.35 then
          v_profile.rare_tech := v_profile.rare_tech + 1;
        end if;
        v_qty := 1;
      elsif v_item_rarity = 'Common' then
        v_scrap := case when v_outcome = 'Partial' then 1 + floor(random() * 3) when v_outcome = 'Success' then 2 + floor(random() * 4) else 4 + floor(random() * 6) end;
        v_profile.scrap := v_profile.scrap + v_scrap;
        v_qty := greatest(1, floor(v_scrap / 2.0));
      elsif v_item_rarity = 'Consumable' then
        v_qty := case when v_outcome = 'Partial' then 1 when v_outcome = 'Success' then 1 + floor(random() * 2) else 2 + floor(random() * 2) end;
        v_profile.components := v_profile.components + v_qty;
      elsif v_item_rarity = 'Uncommon' then
        v_components := case when v_outcome = 'Partial' then 1 + floor(random() * 2) when v_outcome = 'Success' then 2 + floor(random() * 2) else 3 + floor(random() * 3) end;
        v_profile.components := v_profile.components + v_components;
        v_profile.scrap := v_profile.scrap + greatest(1, floor(v_components / 2.0));
        v_qty := v_components;
      else
        v_qty := 1;
        v_profile.rare_tech := v_profile.rare_tech + 1;
        if v_outcome = 'Exceptional' and random() < 0.45 then
          v_profile.components := v_profile.components + 2;
        end if;
      end if;

      if v_item_name = any(v_candy_common_items) then
        v_item_category := 'morale';
        v_item_morale_boost := 8 + floor(random() * 6);
        v_item_cooldown_type := 'booster';
        v_item_cooldown_add_seconds := 1800;
      elsif v_item_name = any(v_candy_mid_items) then
        v_item_category := 'morale';
        v_item_morale_boost := 15 + floor(random() * 10);
        v_item_cooldown_type := 'booster';
        v_item_cooldown_add_seconds := 1800;
      elsif v_item_name = any(v_candy_edgy_items) then
        v_item_category := 'morale';
        v_item_morale_boost := 22 + floor(random() * 14);
        v_item_cooldown_type := 'booster';
        v_item_cooldown_add_seconds := 1800;
      elsif v_item_name = any(v_candy_rare_items) then
        v_item_category := 'morale';
        if v_item_name = 'Outmine Entertainment Disk (OED)' then
          v_item_morale_boost := 80 + floor(random() * 40);
          v_item_cooldown_type := 'booster';
          v_item_cooldown_add_seconds := 21600;
        else
          v_item_morale_boost := 35 + floor(random() * 20);
          v_item_cooldown_type := 'booster';
          v_item_cooldown_add_seconds := 1800;
        end if;
      elsif v_item_rarity = 'Common' then
        v_item_category := 'misc';
        v_item_morale_boost := 0;
        v_item_cooldown_type := 'none';
        v_item_cooldown_add_seconds := 0;
      elsif v_item_rarity = 'Consumable' then
        v_item_category := 'temporary';
        v_item_morale_boost := 0;
        v_item_cooldown_type := 'none';
        v_item_cooldown_add_seconds := 0;
      elsif v_item_rarity = 'Uncommon' then
        v_item_category := 'special';
        v_item_morale_boost := 0;
        v_item_cooldown_type := 'none';
        v_item_cooldown_add_seconds := 0;
      else
        v_item_category := 'special';
        v_item_morale_boost := 0;
        v_item_cooldown_type := 'none';
        v_item_cooldown_add_seconds := 0;
      end if;

      if v_item_name <> 'Hidden Stash Cache' then
        select (j.idx - 1)::integer, j.value
          into v_item_index, v_existing_item
        from jsonb_array_elements(coalesce(v_profile.inventory_items, '[]'::jsonb)) with ordinality as j(value, idx)
        where j.value->>'name' = v_item_name
        limit 1;

        if found then
          v_existing_qty := coalesce((v_existing_item->>'quantity')::integer, 0);
          v_profile.inventory_items := jsonb_set(
            coalesce(v_profile.inventory_items, '[]'::jsonb),
            array[v_item_index::text, 'quantity'],
            to_jsonb(v_existing_qty + v_qty),
            false
          );
        else
          v_profile.inventory_items := coalesce(v_profile.inventory_items, '[]'::jsonb) || jsonb_build_array(
            jsonb_build_object(
              'name', v_item_name,
              'category', v_item_category,
              'quantity', v_qty,
              'moraleBoost', v_item_morale_boost,
              'energyBoost', 0,
              'lifeBoost', 0,
              'cooldownType', v_item_cooldown_type,
              'cooldownAddSeconds', v_item_cooldown_add_seconds,
              'rarity', v_item_rarity,
              'description', v_item_desc
            )
          );
        end if;
      end if;

      if v_item_name = 'Hidden Stash Cache' then
        v_summary := format('[Rare] Hidden Stash Cache x1. %s Bundle yielded %s scrap and %s components.', v_item_desc, v_scrap, v_components);
      else
        v_summary := format('[%s] %s x%s. %s', v_item_rarity, v_item_name, v_qty, v_item_desc);
      end if;

      if v_outcome = 'Partial' then
        v_skill_gain := 1;
      elsif v_outcome = 'Success' then
        v_skill_gain := 2;
      else
        v_skill_gain := 3;
      end if;
    end if;

    if v_approach = 'careful' then
      v_skill_gain := v_skill_gain + 1;
    elsif v_approach = 'deep' then
      v_skill_gain := v_skill_gain + 1;
    end if;
    v_profile.scavenging_skill := v_profile.scavenging_skill + v_skill_gain;

    v_entry := jsonb_build_object(
      'id', gen_random_uuid(),
      'approach', initcap(v_approach),
      'outcome', v_outcome,
      'summary', v_summary,
      'at', now()
    );
    v_profile.crime_log := jsonb_build_array(v_entry) || coalesce(v_profile.crime_log, '[]'::jsonb);
    if jsonb_array_length(v_profile.crime_log) > 10 then
      select coalesce(jsonb_agg(e.value), '[]'::jsonb)
        into v_profile.crime_log
      from (
        select value
        from jsonb_array_elements(v_profile.crime_log) with ordinality as j(value, idx)
        where idx <= 10
        order by idx
      ) e;
    end if;

    v_notice := format('%s: %s', initcap(v_approach), v_summary);

  elsif p_action = 'use_item' then
    v_item_name := coalesce(p_payload ->> 'itemName', '');
    if v_item_name = '' then
      raise exception 'Missing item name.';
    end if;

    select (j.idx - 1)::integer, j.value
      into v_item_index, v_existing_item
    from jsonb_array_elements(coalesce(v_profile.inventory_items, '[]'::jsonb)) with ordinality as j(value, idx)
    where j.value->>'name' = v_item_name
    limit 1;

    if not found then
      raise exception 'Item not found.';
    end if;

    v_existing_qty := coalesce((v_existing_item->>'quantity')::integer, 0);
    if v_existing_qty <= 0 then
      raise exception 'No remaining quantity.';
    end if;

    v_item_category := coalesce(v_existing_item->>'category', 'misc');
    v_item_morale_boost := coalesce((v_existing_item->>'moraleBoost')::integer, 0);
    if v_item_name = 'Outmine Entertainment Disk (OED)' then
      v_item_morale_boost := 2500;
    end if;
    v_item_energy_boost := coalesce((v_existing_item->>'energyBoost')::integer, 0);
    v_item_life_boost := coalesce((v_existing_item->>'lifeBoost')::integer, 0);
    v_item_cooldown_type := coalesce(v_existing_item->>'cooldownType', 'none');
    v_item_cooldown_add_seconds := coalesce((v_existing_item->>'cooldownAddSeconds')::integer, 0);
    if v_item_cooldown_type = 'none' and v_item_category = 'morale' then
      v_item_cooldown_type := 'booster';
      v_item_cooldown_add_seconds := case when v_item_name = 'Outmine Entertainment Disk (OED)' then 21600 else 1800 end;
    end if;

    if (v_item_morale_boost <= 0 and v_item_energy_boost <= 0 and v_item_life_boost <= 0) then
      raise exception 'This item cannot be used right now.';
    end if;

    if v_item_cooldown_type = 'medical' and v_profile.medical_cooldown_seconds > 21600 then
      raise exception 'Medical cooldown is too high. Wait before using another med item.';
    elsif v_item_cooldown_type = 'booster' and v_profile.booster_cooldown_seconds > 86400 then
      raise exception 'Booster cooldown is too high. Wait before using another booster item.';
    elsif v_item_cooldown_type = 'drug' and v_profile.drug_cooldown_seconds > 0 then
      raise exception 'Stimulant cooldown active. You cannot use another stimulant yet.';
    end if;

    if v_item_name = 'Dreamdust Candy' and random() < 0.35 then
      if random() < 0.5 then
        v_item_morale_boost := v_item_morale_boost + (5 + floor(random() * 8));
      else
        v_item_morale_boost := greatest(1, v_item_morale_boost - (4 + floor(random() * 6)));
      end if;
    elsif v_item_name = 'Overcharge Chew' and random() < 0.35 then
      v_profile.energy := greatest(0, v_profile.energy - (2 + floor(random() * 4)));
    elsif v_item_name = 'Blackmarket Sweet Tab' and random() < 0.20 then
      v_profile.life := greatest(0, v_profile.life - (1 + floor(random() * 3)));
    end if;

    if v_item_morale_boost > 0 then
      v_profile.happy := v_profile.happy + v_item_morale_boost;
    end if;
    if v_item_energy_boost > 0 then
      v_profile.energy := least(1000, v_profile.energy + v_item_energy_boost);
    end if;
    if v_item_life_boost > 0 then
      v_profile.life := least(v_profile.max_life, v_profile.life + v_item_life_boost);
    end if;

    if v_item_cooldown_type = 'medical' then
      v_profile.medical_cooldown_seconds := greatest(0, v_profile.medical_cooldown_seconds) + greatest(0, v_item_cooldown_add_seconds);
    elsif v_item_cooldown_type = 'booster' then
      v_profile.booster_cooldown_seconds := greatest(0, v_profile.booster_cooldown_seconds) + greatest(0, v_item_cooldown_add_seconds);
    elsif v_item_cooldown_type = 'drug' then
      v_profile.drug_cooldown_seconds := greatest(0, v_profile.drug_cooldown_seconds) + greatest(0, v_item_cooldown_add_seconds);
    end if;

    if v_existing_qty = 1 then
      v_profile.inventory_items := (
        select coalesce(jsonb_agg(value), '[]'::jsonb)
        from jsonb_array_elements(coalesce(v_profile.inventory_items, '[]'::jsonb)) with ordinality as j(value, idx)
        where (j.idx - 1)::integer <> v_item_index
      );
    else
      v_profile.inventory_items := jsonb_set(
        coalesce(v_profile.inventory_items, '[]'::jsonb),
        array[v_item_index::text, 'quantity'],
        to_jsonb(v_existing_qty - 1),
        false
      );
    end if;

    v_notice := format(
      'Used %s.%s%s%s',
      v_item_name,
      case when v_item_morale_boost > 0 then format(' +%s Morale.', v_item_morale_boost) else '' end,
      case when v_item_energy_boost > 0 then format(' +%s Stamina.', v_item_energy_boost) else '' end,
      case when v_item_life_boost > 0 then format(' +%s Life.', v_item_life_boost) else '' end
    );

  elsif p_action = 'dev_add_oed' then
    if not coalesce(v_is_dev, false) then
      raise exception 'Not allowed.';
    end if;

    v_item_name := 'Outmine Entertainment Disk (OED)';
    select (j.idx - 1)::integer, j.value
      into v_item_index, v_existing_item
    from jsonb_array_elements(coalesce(v_profile.inventory_items, '[]'::jsonb)) with ordinality as j(value, idx)
    where j.value->>'name' = v_item_name
    limit 1;

    if found then
      v_existing_qty := coalesce((v_existing_item->>'quantity')::integer, 0);
      v_profile.inventory_items := jsonb_set(
        coalesce(v_profile.inventory_items, '[]'::jsonb),
        array[v_item_index::text, 'quantity'],
        to_jsonb(v_existing_qty + 1),
        false
      );
    else
      v_profile.inventory_items := coalesce(v_profile.inventory_items, '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object(
          'name', v_item_name,
          'category', 'morale',
          'quantity', 1,
          'moraleBoost', 2500,
          'energyBoost', 0,
          'lifeBoost', 0,
          'cooldownType', 'booster',
          'cooldownAddSeconds', 21600,
          'rarity', 'Rare',
          'description', 'Salvaged pre-collapse media disk loaded with old world entertainment.'
        )
      );
    end if;

    v_notice := 'Added 1 Outmine Entertainment Disk (OED) to inventory.';

  elsif p_action = 'dev_reset_cooldowns' then
    if not coalesce(v_is_dev, false) then
      raise exception 'Not allowed.';
    end if;
    v_profile.medical_cooldown_seconds := 0;
    v_profile.booster_cooldown_seconds := 0;
    v_profile.drug_cooldown_seconds := 0;
    v_profile.last_cooldown_processed_at := v_now;
    v_notice := 'All cooldowns reset to zero.';

  elsif p_action = 'dev_adjust_points' then
    if not coalesce(v_is_dev, false) then
      raise exception 'Not allowed.';
    end if;
    v_amount := coalesce((p_payload ->> 'delta')::integer, 0);
    if v_amount = 0 then
      raise exception 'Delta must not be zero.';
    end if;
    v_profile.vox_points := greatest(0, v_profile.vox_points + v_amount);
    v_notice := format('Vox Points adjusted by %s. Current: %s', v_amount, v_profile.vox_points);

  elsif p_action = 'academy_enroll' then
    v_course_slug := lower(coalesce(p_payload ->> 'courseSlug', ''));
    if v_course_slug = '' then
      raise exception 'Missing course slug.';
    end if;
    if v_profile.academy_active_course_slug is not null then
      raise exception 'Another Academy course is already in progress.';
    end if;

    select major_order, course_order, duration_seconds
      into v_course_major_order, v_course_order, v_course_duration
    from public.vox_city_courses
    where slug = v_course_slug;

    if v_course_major_order is null then
      raise exception 'Invalid course.';
    end if;

    if exists (
      select 1 from public.vox_city_course_completions
      where user_id = p_user_id and course_slug = v_course_slug
    ) then
      raise exception 'Course already completed.';
    end if;

    if v_course_order > 1 then
      select slug
        into v_prev_course_slug
      from public.vox_city_courses
      where major_order = v_course_major_order
        and course_order = v_course_order - 1;
      if not exists (
        select 1 from public.vox_city_course_completions
        where user_id = p_user_id and course_slug = v_prev_course_slug
      ) then
        raise exception 'Complete the previous course in this major first.';
      end if;
    end if;

    v_profile.academy_active_course_slug := v_course_slug;
    v_profile.academy_started_at := v_now;
    v_notice := 'Academy course started.';

  elsif p_action = 'exchange_purchase' then
    v_exchange_unlock_slug := lower(coalesce(p_payload ->> 'unlockSlug', ''));
    if v_exchange_unlock_slug = 'market-grid-access' then
      v_exchange_cost := 25;
    elsif v_exchange_unlock_slug = 'name-change' then
      v_exchange_cost := 50;
    elsif v_exchange_unlock_slug = 'cosmetic-upgrade' then
      v_exchange_cost := 35;
    else
      raise exception 'Invalid Exchange unlock.';
    end if;

    if exists (
      select 1 from public.vox_exchange_unlocks
      where user_id = p_user_id and unlock_slug = v_exchange_unlock_slug
    ) then
      raise exception 'Unlock already purchased.';
    end if;

    if v_profile.vox_points < v_exchange_cost then
      raise exception 'Not enough Vox Points.';
    end if;

    v_profile.vox_points := v_profile.vox_points - v_exchange_cost;
    insert into public.vox_exchange_unlocks (user_id, unlock_slug, unlocked_at)
    values (p_user_id, v_exchange_unlock_slug, v_now);
    v_notice := 'Vox Exchange unlock purchased.';

  elsif p_action = 'market_buy' then
    v_market_stock_slug := lower(coalesce(p_payload ->> 'stockSlug', ''));
    v_market_shares := floor(coalesce((p_payload ->> 'shares')::numeric, 0));
    if v_market_stock_slug = '' or v_market_shares <= 0 then
      raise exception 'Invalid market buy request.';
    end if;

    if not exists (
      select 1 from public.vox_exchange_unlocks
      where user_id = p_user_id and unlock_slug = 'market-grid-access'
    ) then
      raise exception 'Market Grid Access required from Vox Exchange.';
    end if;

    select current_price_fp
      into v_market_price
    from public.market_stocks
    where slug = v_market_stock_slug
    for update;
    if v_market_price is null then
      raise exception 'Invalid stock.';
    end if;

    v_market_tx_amount := round(v_market_shares * v_market_price, 8);
    v_market_fee := round(v_market_tx_amount * 0.005, 8);
    v_market_amount_fp := v_market_tx_amount + v_market_fee;
    if v_market_tx_amount <= 0 then
      raise exception 'Invalid transaction.';
    end if;
    insert into public.wallet_profiles (user_id, balance_sats, updated_at)
    values (p_user_id, 0, now())
    on conflict (user_id) do nothing;

    if v_wallet_balance is null then
      select balance_sats
        into v_wallet_balance
      from public.wallet_profiles
      where user_id = p_user_id
      for update;
      if v_wallet_balance is null then
        v_wallet_balance := 0;
      end if;
    end if;
    if v_wallet_balance < ceil(v_market_amount_fp)::bigint then
      raise exception 'Not enough FP balance.';
    end if;

    update public.wallet_profiles
      set balance_sats = balance_sats - ceil(v_market_amount_fp)::bigint,
          updated_at = now()
    where user_id = p_user_id;

    insert into public.market_holdings (user_id, stock_slug, shares)
    values (p_user_id, v_market_stock_slug, v_market_shares)
    on conflict (user_id, stock_slug) do update
      set shares = public.market_holdings.shares + excluded.shares;

    insert into public.vox_city_global_state (key, fp_value)
    values ('global_treasury_fp', ceil(v_market_fee)::bigint)
    on conflict (key) do update
      set fp_value = public.vox_city_global_state.fp_value + excluded.fp_value;

    v_notice := format('Bought %s shares of %s (fee %s FP).', v_market_shares, v_market_stock_slug, v_market_fee);

  elsif p_action = 'market_sell' then
    v_market_stock_slug := lower(coalesce(p_payload ->> 'stockSlug', ''));
    v_market_shares := floor(coalesce((p_payload ->> 'shares')::numeric, 0));
    if v_market_stock_slug = '' or v_market_shares <= 0 then
      raise exception 'Invalid market sell request.';
    end if;

    insert into public.wallet_profiles (user_id, balance_sats, updated_at)
    values (p_user_id, 0, now())
    on conflict (user_id) do nothing;

    select current_price_fp
      into v_market_price
    from public.market_stocks
    where slug = v_market_stock_slug
    for update;
    if v_market_price is null then
      raise exception 'Invalid stock.';
    end if;

    select shares
      into v_market_current_shares
    from public.market_holdings
    where user_id = p_user_id and stock_slug = v_market_stock_slug
    for update;
    if v_market_current_shares is null or v_market_current_shares < v_market_shares then
      raise exception 'Not enough shares to sell.';
    end if;

    v_market_tx_amount := round(v_market_shares * v_market_price, 8);
    v_market_fee := round(v_market_tx_amount * 0.015, 8);
    v_market_amount_fp := greatest(0, v_market_tx_amount - v_market_fee);

    update public.market_holdings
      set shares = shares - v_market_shares
    where user_id = p_user_id and stock_slug = v_market_stock_slug;

    delete from public.market_holdings
    where user_id = p_user_id and stock_slug = v_market_stock_slug and shares <= 0;

    update public.wallet_profiles
      set balance_sats = balance_sats + floor(v_market_amount_fp)::bigint,
          updated_at = now()
    where user_id = p_user_id;

    insert into public.vox_city_global_state (key, fp_value)
    values ('global_treasury_fp', ceil(v_market_fee)::bigint)
    on conflict (key) do update
      set fp_value = public.vox_city_global_state.fp_value + excluded.fp_value;

    v_notice := format('Sold %s shares of %s (fee %s FP).', v_market_shares, v_market_stock_slug, v_market_fee);

  elsif p_action = 'market_claim' then
    v_market_stock_slug := lower(coalesce(p_payload ->> 'stockSlug', ''));
    v_market_benefit_key := coalesce(p_payload ->> 'benefitKey', '');
    if v_market_stock_slug = '' or v_market_benefit_key = '' then
      raise exception 'Invalid market claim request.';
    end if;

    select h.shares
      into v_market_current_shares
    from public.market_holdings h
    where h.user_id = p_user_id and h.stock_slug = v_market_stock_slug;
    if coalesce(v_market_current_shares, 0) <= 0 then
      raise exception 'No shares owned for this stock.';
    end if;

    select value
      into v_market_benefit
    from public.market_stocks s,
      lateral jsonb_array_elements(s.benefits) as value
    where s.slug = v_market_stock_slug
      and value->>'key' = v_market_benefit_key
    limit 1;
    if v_market_benefit is null then
      raise exception 'Invalid benefit.';
    end if;

    v_market_benefit_shares := coalesce((v_market_benefit->>'sharesRequired')::numeric, 0);
    v_market_benefit_cd := coalesce((v_market_benefit->>'cooldownSeconds')::integer, 0);
    if v_market_current_shares < v_market_benefit_shares then
      raise exception 'Not enough shares for this block benefit.';
    end if;

    select last_claimed_at
      into v_market_last_claim
    from public.market_benefit_claims
    where user_id = p_user_id and stock_slug = v_market_stock_slug and benefit_key = v_market_benefit_key;
    if v_market_last_claim is not null and v_now < v_market_last_claim + make_interval(secs => v_market_benefit_cd) then
      raise exception 'Benefit is still on cooldown.';
    end if;

    if coalesce(v_market_benefit->>'rewardType', '') = 'energy' then
      v_profile.energy := least(1000, v_profile.energy + coalesce((v_market_benefit->>'rewardValue')::integer, 0));
    elsif coalesce(v_market_benefit->>'rewardType', '') = 'item' then
      v_item_name := coalesce(v_market_benefit->>'rewardItem', '');
      v_qty := greatest(1, coalesce((v_market_benefit->>'rewardQuantity')::integer, 1));

      select (j.idx - 1)::integer, j.value
        into v_item_index, v_existing_item
      from jsonb_array_elements(coalesce(v_profile.inventory_items, '[]'::jsonb)) with ordinality as j(value, idx)
      where j.value->>'name' = v_item_name
      limit 1;

      if found then
        v_existing_qty := coalesce((v_existing_item->>'quantity')::integer, 0);
        v_profile.inventory_items := jsonb_set(
          coalesce(v_profile.inventory_items, '[]'::jsonb),
          array[v_item_index::text, 'quantity'],
          to_jsonb(v_existing_qty + v_qty),
          false
        );
      else
        v_profile.inventory_items := coalesce(v_profile.inventory_items, '[]'::jsonb) || jsonb_build_array(
          jsonb_build_object(
            'name', v_item_name,
            'category', 'morale',
            'quantity', v_qty,
            'moraleBoost', 2500,
            'energyBoost', 0,
            'lifeBoost', 0,
            'cooldownType', 'booster',
            'cooldownAddSeconds', 21600,
            'rarity', 'Rare',
            'description', 'Salvaged pre-collapse media disk loaded with old world entertainment.'
          )
        );
      end if;
    end if;

    insert into public.market_benefit_claims (user_id, stock_slug, benefit_key, last_claimed_at)
    values (p_user_id, v_market_stock_slug, v_market_benefit_key, v_now)
    on conflict (user_id, stock_slug, benefit_key) do update
      set last_claimed_at = excluded.last_claimed_at;

    v_notice := 'Block benefit claimed.';

  elsif p_action = 'dev_restore_vital' then
    if not coalesce(v_is_dev, false) then
      raise exception 'Not allowed.';
    end if;

    v_vital := lower(coalesce(p_payload ->> 'vital', ''));
    v_amount := greatest(0, coalesce((p_payload ->> 'amount')::integer, 0));

    if v_amount <= 0 then
      raise exception 'Amount must be greater than zero.';
    end if;

    if v_vital = 'life' then
      v_profile.life := least(v_profile.max_life, v_profile.life + v_amount);
      v_notice := format('Life restored by %s.', v_amount);
    elsif v_vital = 'stamina' then
      v_profile.energy := least(1000, v_profile.energy + v_amount);
      v_notice := format('Stamina restored by %s.', v_amount);
    elsif v_vital = 'instinct' then
      v_profile.nerve := least(v_profile.max_nerve, v_profile.nerve + v_amount);
      v_notice := format('Instinct restored by %s.', v_amount);
    elsif v_vital = 'morale' then
      v_profile.happy := v_profile.happy + v_amount;
      v_notice := format('Morale restored by %s.', v_amount);
    else
      raise exception 'Invalid vital.';
    end if;

  elsif p_action = 'dev_refill' then
    if not coalesce(v_is_dev, false) then
      raise exception 'Not allowed.';
    end if;

    v_profile.energy := v_profile.max_energy;
    v_profile.nerve := v_profile.max_nerve;
    v_profile.happy := v_profile.max_happy;
    v_profile.life := v_profile.max_life;
    v_profile.regen_energy_at := v_now;
    v_profile.regen_nerve_at := v_now;
    v_profile.regen_happy_at := v_now;
    v_profile.regen_life_at := v_now;
    v_notice := 'Vitals restored to maximum.';
  else
    raise exception 'Invalid action.';
  end if;

  update public.vox_city_profiles
    set ferocity = v_profile.ferocity,
        agility = v_profile.agility,
        instinct_combat = v_profile.instinct_combat,
        grit = v_profile.grit,
        energy = v_profile.energy,
        max_energy = v_profile.max_energy,
        nerve = v_profile.nerve,
        max_nerve = v_profile.max_nerve,
        happy = v_profile.happy,
        max_happy = v_profile.max_happy,
        life = v_profile.life,
        max_life = v_profile.max_life,
        vox_points = v_profile.vox_points,
        total_gym_energy_spent = v_profile.total_gym_energy_spent,
        scavenging_skill = v_profile.scavenging_skill,
        college_classes = v_profile.college_classes,
        scrap = v_profile.scrap,
        components = v_profile.components,
        rare_tech = v_profile.rare_tech,
        inventory_items = coalesce(v_profile.inventory_items, '[]'::jsonb),
        crime_log = v_profile.crime_log,
        regen_energy_at = v_profile.regen_energy_at,
        regen_nerve_at = v_profile.regen_nerve_at,
        regen_happy_at = v_profile.regen_happy_at,
        medical_cooldown_seconds = v_profile.medical_cooldown_seconds,
        booster_cooldown_seconds = v_profile.booster_cooldown_seconds,
        drug_cooldown_seconds = v_profile.drug_cooldown_seconds,
        last_cooldown_processed_at = v_profile.last_cooldown_processed_at,
        morale_reset_checked_at = v_profile.morale_reset_checked_at,
        academy_active_course_slug = v_profile.academy_active_course_slug,
        academy_started_at = v_profile.academy_started_at,
        regen_life_at = v_profile.regen_life_at,
        active_gym = v_profile.active_gym,
        updated_at = now()
  where user_id = p_user_id;

  return public.vox_city_get_state(p_user_id) || jsonb_build_object('notice', v_notice);
end;
$$;

grant execute on function public.vox_city_get_state(uuid) to authenticated;
grant execute on function public.vox_city_apply_action(uuid, text, jsonb) to authenticated;

-- Set exactly one developer account for now.
update public.user_profiles set user_type = 'player';
update public.user_profiles
set user_type = 'dev'
where user_id = '9ef0de96-c84d-46fe-a43a-b285d209d5cf';

update public.user_profiles
set gender = 'female'
where user_id = '9ef0de96-c84d-46fe-a43a-b285d209d5cf';

-- Normalize old starter rows created before stat defaults changed to 5.
update public.vox_city_profiles
set ferocity = 5,
    agility = 5,
    instinct_combat = 5,
    grit = 5
where ferocity = 15
  and agility = 15
  and instinct_combat = 15
  and grit = 15;

notify pgrst, 'reload schema';
