import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

type BloodType = 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-';
type Outcome = 'Fail' | 'Partial' | 'Success' | 'Exceptional';
type ApproachId = 'careful' | 'quick' | 'deep';

interface BattleStats {
  ferocity: number;
  agility: number;
  instinctCombat: number;
  grit: number;
}

interface ResourceStats {
  stamina: number;
  maxStamina: number;
  instinctNerve: number;
  maxInstinctNerve: number;
  morale: number;
  maxMorale: number;
  hp: number;
  maxHp: number;
}

interface InventoryState {
  scrap: number;
  components: number;
  rareTech: number;
}

interface CrimeLogEntry {
  id: string;
  approach: string;
  outcome: Outcome;
  summary: string;
  at: string;
}

interface VoxCityState {
  bloodType: BloodType;
  battle: BattleStats;
  resources: ResourceStats;
  scavengingSkill: number;
  collegeClasses: number;
  inventory: InventoryState;
  crimeLog: CrimeLogEntry[];
  updatedAt: string;
}

interface VoxCityProps {
  onBackToHub: () => void;
  onOpenAuth: () => void;
}

const BLOOD_TYPES: BloodType[] = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

const createInitialState = (): VoxCityState => ({
  bloodType: BLOOD_TYPES[Math.floor(Math.random() * BLOOD_TYPES.length)],
  battle: {
    ferocity: 12 + Math.floor(Math.random() * 8),
    agility: 12 + Math.floor(Math.random() * 8),
    instinctCombat: 12 + Math.floor(Math.random() * 8),
    grit: 12 + Math.floor(Math.random() * 8),
  },
  resources: {
    stamina: 100,
    maxStamina: 100,
    instinctNerve: 45,
    maxInstinctNerve: 45,
    morale: 100,
    maxMorale: 100,
    hp: 100,
    maxHp: 100,
  },
  scavengingSkill: 1,
  collegeClasses: 0,
  inventory: {
    scrap: 0,
    components: 0,
    rareTech: 0,
  },
  crimeLog: [],
  updatedAt: new Date().toISOString(),
});

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const VoxCity: React.FC<VoxCityProps> = ({ onBackToHub, onOpenAuth }) => {
  const { user } = useAuth();
  const storageKey = useMemo(
    () => `vox_city_state_${user?.id ?? 'guest'}`,
    [user?.id],
  );
  const [state, setState] = useState<VoxCityState>(() => createInitialState());
  const [notice, setNotice] = useState<string>('Welcome to Vox City.');
  const [lastClassGain, setLastClassGain] = useState<string>('');

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        const initial = createInitialState();
        setState(initial);
        return;
      }
      const parsed = JSON.parse(raw) as VoxCityState;
      if (!parsed?.bloodType || !parsed?.battle || !parsed?.resources) {
        setState(createInitialState());
        return;
      }
      setState(parsed);
    } catch {
      setState(createInitialState());
    }
  }, [storageKey]);

  useEffect(() => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({ ...state, updatedAt: new Date().toISOString() }),
    );
  }, [state, storageKey]);

  useEffect(() => {
    const ticker = window.setInterval(() => {
      setState((prev) => ({
        ...prev,
        resources: {
          ...prev.resources,
          stamina: clamp(prev.resources.stamina + 1, 0, prev.resources.maxStamina),
          instinctNerve: clamp(prev.resources.instinctNerve + 1, 0, prev.resources.maxInstinctNerve),
          morale: clamp(prev.resources.morale + 1, 0, prev.resources.maxMorale),
          hp: clamp(prev.resources.hp + 1, 0, prev.resources.maxHp),
        },
      }));
    }, 15000);
    return () => window.clearInterval(ticker);
  }, []);

  const bloodTypeVisible = state.collegeClasses >= 12;
  const deepDigUnlocked = state.scavengingSkill >= 25;
  const zonesUnlocked = [
    'Outmine Dungeons',
    ...(state.scavengingSkill >= 18 ? ['Toxic Ruins'] : []),
    ...(state.scavengingSkill >= 35 ? ['Collapsed Bunkers'] : []),
  ];

  const trainStat = (key: keyof BattleStats, label: string) => {
    setState((prev) => {
      if (prev.resources.stamina < 5) {
        setNotice('Not enough Stamina to train.');
        return prev;
      }
      const moraleModifier = 1 + prev.resources.morale / 200;
      const gain = Math.max(1, Math.floor((1 + Math.random() * 2.2) * moraleModifier));

      return {
        ...prev,
        battle: {
          ...prev.battle,
          [key]: prev.battle[key] + gain,
        },
        resources: {
          ...prev.resources,
          stamina: prev.resources.stamina - 5,
          morale: clamp(prev.resources.morale - 2, 0, prev.resources.maxMorale),
        },
      };
    });
    setNotice(`${label} trained.`);
  };

  const takeCollegeClass = () => {
    setState((prev) => {
      if (prev.resources.stamina < 8 || prev.resources.morale < 5) {
        setNotice('You need at least 8 Stamina and 5 Morale for class.');
        return prev;
      }
      const className =
        ['Human Biology', 'Trauma Response', 'Field Medicine', 'Clinical Procedure'][
          Math.floor(Math.random() * 4)
        ];
      setLastClassGain(className);
      setNotice(`Completed class: ${className}.`);
      return {
        ...prev,
        collegeClasses: prev.collegeClasses + 1,
        resources: {
          ...prev.resources,
          stamina: prev.resources.stamina - 8,
          morale: clamp(prev.resources.morale - 5, 0, prev.resources.maxMorale),
        },
      };
    });
  };

  const runCrime = (approach: ApproachId) => {
    setState((prev) => {
      const approachCfg = {
        careful: { staminaCost: 4, nerveCost: 2, base: [0.14, 0.46, 0.34, 0.06] as const, label: 'Careful Search' },
        quick: { staminaCost: 3, nerveCost: 3, base: [0.24, 0.34, 0.34, 0.08] as const, label: 'Quick Grab' },
        deep: { staminaCost: 6, nerveCost: 4, base: [0.36, 0.24, 0.28, 0.12] as const, label: 'Deep Dig' },
      }[approach];

      if (approach === 'deep' && !deepDigUnlocked) {
        setNotice('Deep Dig unlocks at Scavenging skill 25.');
        return prev;
      }

      if (
        prev.resources.stamina < approachCfg.staminaCost ||
        prev.resources.instinctNerve < approachCfg.nerveCost
      ) {
        setNotice('Not enough Stamina or Instinct (Nerve).');
        return prev;
      }

      const skillBonus = Math.min(0.2, prev.scavengingSkill / 250);
      const moraleBonus = Math.min(0.1, prev.resources.morale / 1000);
      const failChance = clamp(approachCfg.base[0] - skillBonus, 0.04, 0.8);
      const partialChance = clamp(approachCfg.base[1] - skillBonus / 3, 0.1, 0.8);
      const successChance = clamp(approachCfg.base[2] + skillBonus + moraleBonus, 0.1, 0.8);
      const exceptionalChance = clamp(
        1 - (failChance + partialChance + successChance),
        0.02,
        0.3,
      );

      const roll = Math.random();
      const thresholds = [
        failChance,
        failChance + partialChance,
        failChance + partialChance + successChance,
        failChance + partialChance + successChance + exceptionalChance,
      ];

      let outcome: Outcome = 'Fail';
      if (roll > thresholds[2]) outcome = 'Exceptional';
      else if (roll > thresholds[1]) outcome = 'Success';
      else if (roll > thresholds[0]) outcome = 'Partial';

      const next = { ...prev };
      next.resources = {
        ...prev.resources,
        stamina: prev.resources.stamina - approachCfg.staminaCost,
        instinctNerve: prev.resources.instinctNerve - approachCfg.nerveCost,
      };

      let summary = '';
      let skillGain = 1;
      if (outcome === 'Fail') {
        const injury = clamp(Math.floor(2 + Math.random() * 5 - prev.battle.grit / 60), 1, 6);
        next.resources.hp = clamp(prev.resources.hp - injury, 0, prev.resources.maxHp);
        next.resources.morale = clamp(prev.resources.morale - 3, 0, prev.resources.maxMorale);
        summary = `Found nothing. Minor injury (-${injury} HP).`;
      } else if (outcome === 'Partial') {
        const scrap = 1 + Math.floor(Math.random() * 3);
        next.inventory.scrap += scrap;
        summary = `Recovered ${scrap} scrap.`;
      } else if (outcome === 'Success') {
        const scrap = 3 + Math.floor(Math.random() * 4);
        const components = 1 + Math.floor(Math.random() * 2);
        next.inventory.scrap += scrap;
        next.inventory.components += components;
        skillGain = 2;
        summary = `Recovered ${scrap} scrap and ${components} components.`;
      } else {
        const components = 2 + Math.floor(Math.random() * 3);
        const rareTech = 1;
        next.inventory.components += components;
        next.inventory.rareTech += rareTech;
        skillGain = 3;
        summary = `Hit hidden stash: ${components} components and ${rareTech} rare tech.`;
      }

      if (approach === 'careful') skillGain += 1;
      if (approach === 'deep') skillGain += 1;
      next.scavengingSkill += skillGain;

      const entry: CrimeLogEntry = {
        id: crypto.randomUUID(),
        approach: approachCfg.label,
        outcome,
        summary,
        at: new Date().toISOString(),
      };
      next.crimeLog = [entry, ...prev.crimeLog].slice(0, 12);

      setNotice(`${approachCfg.label}: ${summary}`);
      return next;
    });
  };

  const resourcePct = (value: number, max: number) => `${Math.round((value / max) * 100)}%`;

  return (
    <div className="min-h-screen bg-[#1a1f27] text-[#d6dde8]">
      <div className="border-b border-[#2e3643] bg-[#11161d] px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.25em] text-[#6f7d91]">Vox City</p>
            <h1 className="text-xl font-semibold text-[#eef2f8]">Urban Operations Panel</h1>
          </div>
          <button
            onClick={onBackToHub}
            className="rounded border border-[#3c4a5d] bg-[#202a37] px-3 py-2 text-sm text-[#c9d4e5] hover:bg-[#273448]"
          >
            Back to TimeQuest Hub
          </button>
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl gap-4 p-4 sm:grid-cols-12 sm:p-6">
        <section className="space-y-4 sm:col-span-4">
          <div className="rounded border border-[#2f3b4b] bg-[#121923] p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#93a5bd]">Identity</h2>
            {user ? (
              <p className="text-sm">
                Operator: <span className="font-semibold text-[#eef2f8]">{user.displayName}</span>
              </p>
            ) : (
              <button
                onClick={onOpenAuth}
                className="rounded border border-[#3c4a5d] bg-[#202a37] px-3 py-1.5 text-sm text-[#dbe6f5] hover:bg-[#273448]"
              >
                Sign in to save progress
              </button>
            )}
            <p className="mt-2 text-sm">
              Blood Type:{' '}
              <span className="font-semibold text-[#eef2f8]">
                {bloodTypeVisible ? state.bloodType : 'Classified'}
              </span>
            </p>
            <p className="mt-1 text-xs text-[#7f91a8]">
              Take 12 college classes to unlock blood-draw knowledge.
            </p>
          </div>

          <div className="rounded border border-[#2f3b4b] bg-[#121923] p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#93a5bd]">Vitals</h2>
            <div className="space-y-2 text-sm">
              <div>
                <div className="mb-1 flex justify-between">
                  <span>Stamina (Energy)</span>
                  <span>{state.resources.stamina}/{state.resources.maxStamina}</span>
                </div>
                <div className="h-2 rounded bg-[#2d3644]">
                  <div className="h-2 rounded bg-[#44b2ff]" style={{ width: resourcePct(state.resources.stamina, state.resources.maxStamina) }} />
                </div>
              </div>
              <div>
                <div className="mb-1 flex justify-between">
                  <span>Instinct (Nerve)</span>
                  <span>{state.resources.instinctNerve}/{state.resources.maxInstinctNerve}</span>
                </div>
                <div className="h-2 rounded bg-[#2d3644]">
                  <div className="h-2 rounded bg-[#8dd95f]" style={{ width: resourcePct(state.resources.instinctNerve, state.resources.maxInstinctNerve) }} />
                </div>
              </div>
              <div>
                <div className="mb-1 flex justify-between">
                  <span>Morale (Happy)</span>
                  <span>{state.resources.morale}/{state.resources.maxMorale}</span>
                </div>
                <div className="h-2 rounded bg-[#2d3644]">
                  <div className="h-2 rounded bg-[#f2c35d]" style={{ width: resourcePct(state.resources.morale, state.resources.maxMorale) }} />
                </div>
              </div>
              <div>
                <div className="mb-1 flex justify-between">
                  <span>HP</span>
                  <span>{state.resources.hp}/{state.resources.maxHp}</span>
                </div>
                <div className="h-2 rounded bg-[#2d3644]">
                  <div className="h-2 rounded bg-[#ef6a6a]" style={{ width: resourcePct(state.resources.hp, state.resources.maxHp) }} />
                </div>
              </div>
            </div>
          </div>

          <div className="rounded border border-[#2f3b4b] bg-[#121923] p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#93a5bd]">Battle Stats</h2>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span>Ferocity (Strength)</span>
                <button onClick={() => trainStat('ferocity', 'Ferocity')} className="rounded border border-[#3c4a5d] px-2 py-1 text-xs hover:bg-[#243246]">
                  {state.battle.ferocity} Train
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span>Agility (Speed)</span>
                <button onClick={() => trainStat('agility', 'Agility')} className="rounded border border-[#3c4a5d] px-2 py-1 text-xs hover:bg-[#243246]">
                  {state.battle.agility} Train
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span>Instinct (Dexterity)</span>
                <button onClick={() => trainStat('instinctCombat', 'Combat Instinct')} className="rounded border border-[#3c4a5d] px-2 py-1 text-xs hover:bg-[#243246]">
                  {state.battle.instinctCombat} Train
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span>Grit (Defense)</span>
                <button onClick={() => trainStat('grit', 'Grit')} className="rounded border border-[#3c4a5d] px-2 py-1 text-xs hover:bg-[#243246]">
                  {state.battle.grit} Train
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-4 sm:col-span-8">
          <div className="rounded border border-[#2f3b4b] bg-[#121923] p-4">
            <h2 className="text-base font-semibold text-[#eef2f8]">Crime: Scavenge the Ruins</h2>
            <p className="mt-1 text-sm text-[#a7b5c8]">
              Search abandoned Outmine dungeons for salvage, scrap, and rare tech.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <button onClick={() => runCrime('careful')} className="rounded border border-[#3c4a5d] bg-[#1a2432] p-3 text-left hover:bg-[#213046]">
                <p className="text-sm font-semibold">Careful Search</p>
                <p className="mt-1 text-xs text-[#93a5bd]">Low risk, low reward, steady skill growth.</p>
              </button>
              <button onClick={() => runCrime('quick')} className="rounded border border-[#3c4a5d] bg-[#1a2432] p-3 text-left hover:bg-[#213046]">
                <p className="text-sm font-semibold">Quick Grab</p>
                <p className="mt-1 text-xs text-[#93a5bd]">Fast run, higher fail chance, moderate reward.</p>
              </button>
              <button
                onClick={() => runCrime('deep')}
                className={`rounded border p-3 text-left ${deepDigUnlocked ? 'border-[#3c4a5d] bg-[#1a2432] hover:bg-[#213046]' : 'border-[#384051] bg-[#151c27] opacity-70'}`}
              >
                <p className="text-sm font-semibold">Deep Dig</p>
                <p className="mt-1 text-xs text-[#93a5bd]">
                  {deepDigUnlocked ? 'High risk. Rare tech chance.' : 'Unlocks at Scavenging 25.'}
                </p>
              </button>
            </div>
            <p className="mt-4 rounded border border-[#314056] bg-[#1a2433] px-3 py-2 text-sm text-[#d4deec]">
              {notice}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded border border-[#2f3b4b] bg-[#121923] p-4">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#93a5bd]">Progression</h3>
              <p className="text-sm">Scavenging Skill: <span className="font-semibold text-[#eef2f8]">{state.scavengingSkill}</span></p>
              <p className="mt-2 text-xs text-[#90a2bb]">Unlocks better loot tables and new zones.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {zonesUnlocked.map((zone) => (
                  <span key={zone} className="rounded border border-[#425167] bg-[#1a2432] px-2 py-1 text-xs">
                    {zone}
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded border border-[#2f3b4b] bg-[#121923] p-4">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#93a5bd]">Inventory</h3>
              <div className="space-y-2 text-sm">
                <p>Basic Scrap: <span className="font-semibold text-[#eef2f8]">{state.inventory.scrap}</span></p>
                <p>Components: <span className="font-semibold text-[#eef2f8]">{state.inventory.components}</span></p>
                <p>Rare Tech: <span className="font-semibold text-[#eef2f8]">{state.inventory.rareTech}</span></p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded border border-[#2f3b4b] bg-[#121923] p-4">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#93a5bd]">College</h3>
              <p className="text-sm">Classes Completed: <span className="font-semibold text-[#eef2f8]">{state.collegeClasses}</span></p>
              <p className="mt-1 text-xs text-[#90a2bb]">Study toward clinical skills that reveal hidden profile data.</p>
              <button onClick={takeCollegeClass} className="mt-3 rounded border border-[#3c4a5d] bg-[#1a2432] px-3 py-2 text-sm hover:bg-[#213046]">
                Take Class (8 Stamina, 5 Morale)
              </button>
              {lastClassGain ? <p className="mt-2 text-xs text-[#8da1b9]">Latest class: {lastClassGain}</p> : null}
            </div>

            <div className="rounded border border-[#2f3b4b] bg-[#121923] p-4">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#93a5bd]">Recent Operations</h3>
              <div className="max-h-48 space-y-2 overflow-y-auto pr-1 text-sm">
                {state.crimeLog.length === 0 ? (
                  <p className="text-[#90a2bb]">No operations run yet.</p>
                ) : (
                  state.crimeLog.map((entry) => (
                    <div key={entry.id} className="rounded border border-[#344257] bg-[#1a2432] p-2">
                      <p className="font-semibold text-[#e4ecf8]">{entry.approach} - {entry.outcome}</p>
                      <p className="text-xs text-[#9aacc3]">{entry.summary}</p>
                      <p className="mt-1 text-[11px] text-[#7f91a8]">{new Date(entry.at).toLocaleTimeString()}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default VoxCity;
