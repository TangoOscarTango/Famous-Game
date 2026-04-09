create extension if not exists pgcrypto;

alter table public.user_profiles
  add column if not exists user_type text not null default 'player'
  check (user_type in ('player', 'dev'));

create table if not exists public.vox_city_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  blood_type text not null check (blood_type in ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  ferocity integer not null default 15,
  agility integer not null default 15,
  instinct_combat integer not null default 15,
  grit integer not null default 15,
  energy integer not null default 100,
  max_energy integer not null default 100,
  nerve integer not null default 10,
  max_nerve integer not null default 10,
  happy integer not null default 100,
  max_happy integer not null default 100,
  life integer not null default 100,
  max_life integer not null default 100,
  scavenging_skill integer not null default 1,
  college_classes integer not null default 0,
  scrap integer not null default 0,
  components integer not null default 0,
  rare_tech integer not null default 0,
  crime_log jsonb not null default '[]'::jsonb,
  regen_energy_at timestamptz not null default now(),
  regen_nerve_at timestamptz not null default now(),
  regen_happy_at timestamptz not null default now(),
  regen_life_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.vox_city_profiles enable row level security;

drop policy if exists "vox_city_owner_select" on public.vox_city_profiles;
drop policy if exists "vox_city_owner_update" on public.vox_city_profiles;
drop policy if exists "vox_city_owner_insert" on public.vox_city_profiles;

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
  v_energy_ticks integer;
  v_nerve_ticks integer;
  v_happy_ticks integer;
  v_life_ticks integer;
  v_life_gain integer;
  v_is_dev boolean := false;
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

  v_energy_ticks := floor(extract(epoch from (v_now - v_profile.regen_energy_at)) / 300);
  if v_energy_ticks > 0 then
    v_profile.energy := least(v_profile.max_energy, v_profile.energy + v_energy_ticks * 5);
    v_profile.regen_energy_at := v_profile.regen_energy_at + (v_energy_ticks * interval '5 minutes');
  end if;

  v_nerve_ticks := floor(extract(epoch from (v_now - v_profile.regen_nerve_at)) / 300);
  if v_nerve_ticks > 0 then
    v_profile.nerve := least(v_profile.max_nerve, v_profile.nerve + v_nerve_ticks);
    v_profile.regen_nerve_at := v_profile.regen_nerve_at + (v_nerve_ticks * interval '5 minutes');
  end if;

  v_happy_ticks := floor(extract(epoch from (v_now - v_profile.regen_happy_at)) / 900);
  if v_happy_ticks > 0 then
    v_profile.happy := least(v_profile.max_happy, v_profile.happy + v_happy_ticks);
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
        life = v_profile.life,
        regen_energy_at = v_profile.regen_energy_at,
        regen_nerve_at = v_profile.regen_nerve_at,
        regen_happy_at = v_profile.regen_happy_at,
        regen_life_at = v_profile.regen_life_at,
        updated_at = now()
  where user_id = p_user_id;

  select (up.user_type = 'dev')
    into v_is_dev
  from public.user_profiles up
  where up.user_id = p_user_id;

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
      'life', v_profile.life,
      'maxLife', v_profile.max_life
    ),
    'scavengingSkill', v_profile.scavenging_skill,
    'collegeClasses', v_profile.college_classes,
    'inventory', jsonb_build_object(
      'scrap', v_profile.scrap,
      'components', v_profile.components,
      'rareTech', v_profile.rare_tech
    ),
    'crimeLog', coalesce(v_profile.crime_log, '[]'::jsonb),
    'isDev', coalesce(v_is_dev, false)
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
  v_stat text;
  v_approach text;
  v_gain integer;
  v_roll double precision;
  v_skill_bonus double precision;
  v_happy_bonus double precision;
  v_fail_chance double precision;
  v_partial_chance double precision;
  v_success_chance double precision;
  v_exceptional_chance double precision;
  v_outcome text;
  v_energy_cost integer;
  v_nerve_cost integer;
  v_summary text;
  v_scrap integer;
  v_components integer;
  v_entry jsonb;
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
    if v_profile.energy < 5 then
      raise exception 'Not enough Energy.';
    end if;

    v_gain := greatest(1, floor((1 + random() * 2.2) * (1 + v_profile.happy / 200.0)));

    if v_stat = 'ferocity' then
      v_profile.ferocity := v_profile.ferocity + v_gain;
      v_notice := 'Ferocity trained.';
    elsif v_stat = 'agility' then
      v_profile.agility := v_profile.agility + v_gain;
      v_notice := 'Agility trained.';
    elsif v_stat = 'instinctcombat' then
      v_profile.instinct_combat := v_profile.instinct_combat + v_gain;
      v_notice := 'Instinct trained.';
    elsif v_stat = 'grit' then
      v_profile.grit := v_profile.grit + v_gain;
      v_notice := 'Grit trained.';
    else
      raise exception 'Invalid training stat.';
    end if;

    v_profile.energy := greatest(0, v_profile.energy - 5);
    v_profile.happy := greatest(0, v_profile.happy - 2);

  elsif p_action = 'class' then
    if v_profile.energy < 8 or v_profile.happy < 5 then
      raise exception 'Need at least 8 Energy and 5 Happy.';
    end if;

    v_profile.college_classes := v_profile.college_classes + 1;
    v_profile.energy := greatest(0, v_profile.energy - 8);
    v_profile.happy := greatest(0, v_profile.happy - 5);
    v_notice := 'Academy class completed.';

  elsif p_action = 'crime' then
    v_approach := lower(coalesce(p_payload ->> 'approach', ''));

    if v_approach = 'careful' then
      v_energy_cost := 4;
      v_nerve_cost := 2;
      v_fail_chance := 0.14;
      v_partial_chance := 0.46;
      v_success_chance := 0.34;
    elsif v_approach = 'quick' then
      v_energy_cost := 3;
      v_nerve_cost := 3;
      v_fail_chance := 0.24;
      v_partial_chance := 0.34;
      v_success_chance := 0.34;
    elsif v_approach = 'deep' then
      if v_profile.scavenging_skill < 25 then
        raise exception 'Deep Dig unlocks at Scavenging 25.';
      end if;
      v_energy_cost := 6;
      v_nerve_cost := 4;
      v_fail_chance := 0.36;
      v_partial_chance := 0.24;
      v_success_chance := 0.28;
    else
      raise exception 'Invalid approach.';
    end if;

    if v_profile.energy < v_energy_cost or v_profile.nerve < v_nerve_cost then
      raise exception 'Insufficient Energy or Nerve.';
    end if;

    v_profile.energy := greatest(0, v_profile.energy - v_energy_cost);
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
      v_gain := greatest(1, least(6, floor(2 + random() * 5 - v_profile.grit / 60.0)));
      v_profile.life := greatest(0, v_profile.life - v_gain);
      v_profile.happy := greatest(0, v_profile.happy - 3);
      v_summary := format('Found nothing. Minor injury (-%s Life).', v_gain);
      v_gain := 1;
    elsif v_outcome = 'Partial' then
      v_scrap := 1 + floor(random() * 3);
      v_profile.scrap := v_profile.scrap + v_scrap;
      v_summary := format('Recovered %s scrap.', v_scrap);
      v_gain := 1;
    elsif v_outcome = 'Success' then
      v_scrap := 3 + floor(random() * 4);
      v_components := 1 + floor(random() * 2);
      v_profile.scrap := v_profile.scrap + v_scrap;
      v_profile.components := v_profile.components + v_components;
      v_summary := format('Recovered %s scrap and %s components.', v_scrap, v_components);
      v_gain := 2;
    else
      v_components := 2 + floor(random() * 3);
      v_profile.components := v_profile.components + v_components;
      v_profile.rare_tech := v_profile.rare_tech + 1;
      v_summary := format('Hidden stash: %s components and 1 rare tech.', v_components);
      v_gain := 3;
    end if;

    if v_approach = 'careful' then
      v_gain := v_gain + 1;
    elsif v_approach = 'deep' then
      v_gain := v_gain + 1;
    end if;
    v_profile.scavenging_skill := v_profile.scavenging_skill + v_gain;

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
        scavenging_skill = v_profile.scavenging_skill,
        college_classes = v_profile.college_classes,
        scrap = v_profile.scrap,
        components = v_profile.components,
        rare_tech = v_profile.rare_tech,
        crime_log = v_profile.crime_log,
        regen_energy_at = v_profile.regen_energy_at,
        regen_nerve_at = v_profile.regen_nerve_at,
        regen_happy_at = v_profile.regen_happy_at,
        regen_life_at = v_profile.regen_life_at,
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

notify pgrst, 'reload schema';
