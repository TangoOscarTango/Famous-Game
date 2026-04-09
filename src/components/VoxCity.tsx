import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

type BloodType = 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-';
type Outcome = 'Fail' | 'Partial' | 'Success' | 'Exceptional';
type ApproachId = 'careful' | 'quick' | 'deep';
type SectionId =
  | 'home'
  | 'training'
  | 'items'
  | 'academy'
  | 'dens'
  | 'operations'
  | 'luck-den'
  | 'work'
  | 'lockup'
  | 'recovery'
  | 'pack';

interface BattleStats {
  ferocity: number;
  agility: number;
  instinctCombat: number;
  grit: number;
}

interface ResourceStats {
  energy: number;
  maxEnergy: number;
  nerve: number;
  maxNerve: number;
  happy: number;
  maxHappy: number;
  life: number;
  maxLife: number;
}

interface RegenTimestamps {
  energyAt: number;
  nerveAt: number;
  happyAt: number;
  lifeAt: number;
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
  regen: RegenTimestamps;
  updatedAt: string;
}

interface VoxCityProps {
  onBackToHub: () => void;
  onOpenAuth: () => void;
}

const BLOOD_TYPES: BloodType[] = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const ENERGY_INTERVAL_MS = 5 * 60 * 1000;
const NERVE_INTERVAL_MS = 5 * 60 * 1000;
const HAPPY_INTERVAL_MS = 15 * 60 * 1000;
const LIFE_INTERVAL_MS = 5 * 60 * 1000;

const navItems: Array<{ id: SectionId; label: string }> = [
  { id: 'home', label: 'District' },
  { id: 'training', label: 'Training Grounds' },
  { id: 'items', label: 'Items' },
  { id: 'academy', label: 'Academy' },
  { id: 'dens', label: 'Dens' },
  { id: 'operations', label: 'Operations' },
  { id: 'luck-den', label: 'Luck Den' },
  { id: 'work', label: 'Work' },
  { id: 'lockup', label: 'Lockup' },
  { id: 'recovery', label: 'Recovery' },
  { id: 'pack', label: 'Pack' },
];

const subNavBySection: Record<SectionId, string[]> = {
  home: ['City Feed', 'Travel', 'Player List'],
  training: ['Ferocity', 'Agility', 'Instinct', 'Grit'],
  items: ['Inventory', 'Market', 'Storage'],
  academy: ['Enroll', 'Current Class', 'Transcript'],
  dens: ['Safehouse', 'Upgrades', 'Rent'],
  operations: ['Scavenge the Ruins', 'Ops Log', 'Zones'],
  'luck-den': ['Slots', 'Cards', 'Roulette'],
  work: ['Job Board', 'Current Shift', 'Rank'],
  lockup: ['Sentence', 'Bail', 'Legal'],
  recovery: ['Ward', 'Rehab', 'Doctors'],
  pack: ['Roster', 'Armory', 'Territory'],
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const createInitialState = (): VoxCityState => {
  const now = Date.now();
  return {
    bloodType: BLOOD_TYPES[Math.floor(Math.random() * BLOOD_TYPES.length)],
    battle: {
      ferocity: 12 + Math.floor(Math.random() * 8),
      agility: 12 + Math.floor(Math.random() * 8),
      instinctCombat: 12 + Math.floor(Math.random() * 8),
      grit: 12 + Math.floor(Math.random() * 8),
    },
    resources: {
      energy: 100,
      maxEnergy: 100,
      nerve: 10,
      maxNerve: 10,
      happy: 100,
      maxHappy: 100,
      life: 100,
      maxLife: 100,
    },
    scavengingSkill: 1,
    collegeClasses: 0,
    inventory: {
      scrap: 0,
      components: 0,
      rareTech: 0,
    },
    crimeLog: [],
    regen: {
      energyAt: now,
      nerveAt: now,
      happyAt: now,
      lifeAt: now,
    },
    updatedAt: new Date().toISOString(),
  };
};

const applyRegen = (prev: VoxCityState): VoxCityState => {
  const now = Date.now();
  const next = { ...prev, resources: { ...prev.resources }, regen: { ...prev.regen } };

  const energyTicks = Math.floor((now - prev.regen.energyAt) / ENERGY_INTERVAL_MS);
  if (energyTicks > 0) {
    next.resources.energy = clamp(prev.resources.energy + energyTicks * 5, 0, prev.resources.maxEnergy);
    next.regen.energyAt = prev.regen.energyAt + energyTicks * ENERGY_INTERVAL_MS;
  }

  const nerveTicks = Math.floor((now - prev.regen.nerveAt) / NERVE_INTERVAL_MS);
  if (nerveTicks > 0) {
    next.resources.nerve = clamp(prev.resources.nerve + nerveTicks, 0, prev.resources.maxNerve);
    next.regen.nerveAt = prev.regen.nerveAt + nerveTicks * NERVE_INTERVAL_MS;
  }

  const happyTicks = Math.floor((now - prev.regen.happyAt) / HAPPY_INTERVAL_MS);
  if (happyTicks > 0) {
    next.resources.happy = clamp(prev.resources.happy + happyTicks, 0, prev.resources.maxHappy);
    next.regen.happyAt = prev.regen.happyAt + happyTicks * HAPPY_INTERVAL_MS;
  }

  const lifeTicks = Math.floor((now - prev.regen.lifeAt) / LIFE_INTERVAL_MS);
  if (lifeTicks > 0) {
    const lifeGainPerTick = Math.max(1, Math.floor(prev.resources.maxLife * 0.04));
    next.resources.life = clamp(prev.resources.life + lifeTicks * lifeGainPerTick, 0, prev.resources.maxLife);
    next.regen.lifeAt = prev.regen.lifeAt + lifeTicks * LIFE_INTERVAL_MS;
  }

  return next;
};

const VoxCity: React.FC<VoxCityProps> = ({ onBackToHub, onOpenAuth }) => {
  const { user } = useAuth();
  const storageKey = useMemo(() => `vox_city_state_${user?.id ?? 'guest'}`, [user?.id]);
  const [state, setState] = useState<VoxCityState>(() => createInitialState());
  const [notice, setNotice] = useState<string>('City systems online.');
  const [section, setSection] = useState<SectionId>('operations');

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        setState(createInitialState());
        return;
      }
      const parsed = JSON.parse(raw) as VoxCityState;
      if (!parsed?.resources?.maxNerve) {
        setState(createInitialState());
        return;
      }
      setState(applyRegen(parsed));
    } catch {
      setState(createInitialState());
    }
  }, [storageKey]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }));
  }, [state, storageKey]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setState((prev) => applyRegen(prev));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const deepDigUnlocked = state.scavengingSkill >= 25;
  const zonesUnlocked = [
    'Outmine Dungeons',
    ...(state.scavengingSkill >= 18 ? ['Toxic Ruins'] : []),
    ...(state.scavengingSkill >= 35 ? ['Collapsed Bunkers'] : []),
  ];

  const trainStat = (key: keyof BattleStats, label: string) => {
    setState((prev) => {
      if (prev.resources.energy < 5) {
        setNotice('Not enough Energy to train.');
        return prev;
      }

      const gain = Math.max(1, Math.floor((1 + Math.random() * 2.2) * (1 + prev.resources.happy / 200)));
      return {
        ...prev,
        battle: {
          ...prev.battle,
          [key]: prev.battle[key] + gain,
        },
        resources: {
          ...prev.resources,
          energy: prev.resources.energy - 5,
          happy: clamp(prev.resources.happy - 2, 0, prev.resources.maxHappy),
        },
      };
    });
    setNotice(`${label} trained.`);
  };

  const takeCollegeClass = () => {
    setState((prev) => {
      if (prev.resources.energy < 8 || prev.resources.happy < 5) {
        setNotice('Need at least 8 Energy and 5 Happy for class.');
        return prev;
      }

      return {
        ...prev,
        collegeClasses: prev.collegeClasses + 1,
        resources: {
          ...prev.resources,
          energy: prev.resources.energy - 8,
          happy: clamp(prev.resources.happy - 5, 0, prev.resources.maxHappy),
        },
      };
    });
    setNotice('Academy class completed.');
  };

  const runCrime = (approach: ApproachId) => {
    setState((prev) => {
      const cfg = {
        careful: { energyCost: 4, nerveCost: 2, base: [0.14, 0.46, 0.34, 0.06] as const, label: 'Careful Search' },
        quick: { energyCost: 3, nerveCost: 3, base: [0.24, 0.34, 0.34, 0.08] as const, label: 'Quick Grab' },
        deep: { energyCost: 6, nerveCost: 4, base: [0.36, 0.24, 0.28, 0.12] as const, label: 'Deep Dig' },
      }[approach];

      if (approach === 'deep' && !deepDigUnlocked) {
        setNotice('Deep Dig unlocks at Scavenging 25.');
        return prev;
      }

      if (prev.resources.energy < cfg.energyCost || prev.resources.nerve < cfg.nerveCost) {
        setNotice('Insufficient Energy or Nerve.');
        return prev;
      }

      const skillBonus = Math.min(0.2, prev.scavengingSkill / 250);
      const happyBonus = Math.min(0.1, prev.resources.happy / 1000);

      const failChance = clamp(cfg.base[0] - skillBonus, 0.04, 0.8);
      const partialChance = clamp(cfg.base[1] - skillBonus / 3, 0.1, 0.8);
      const successChance = clamp(cfg.base[2] + skillBonus + happyBonus, 0.1, 0.8);
      const exceptionalChance = clamp(1 - (failChance + partialChance + successChance), 0.02, 0.3);

      const roll = Math.random();
      const t1 = failChance;
      const t2 = t1 + partialChance;
      const t3 = t2 + successChance;

      let outcome: Outcome = 'Fail';
      if (roll > t3) outcome = 'Exceptional';
      else if (roll > t2) outcome = 'Success';
      else if (roll > t1) outcome = 'Partial';

      const next = { ...prev };
      next.resources = {
        ...prev.resources,
        energy: prev.resources.energy - cfg.energyCost,
        nerve: prev.resources.nerve - cfg.nerveCost,
      };

      let summary = '';
      let skillGain = 1;
      if (outcome === 'Fail') {
        const injury = clamp(Math.floor(2 + Math.random() * 5 - prev.battle.grit / 60), 1, 6);
        next.resources.life = clamp(prev.resources.life - injury, 0, prev.resources.maxLife);
        next.resources.happy = clamp(prev.resources.happy - 3, 0, prev.resources.maxHappy);
        summary = `Found nothing. Minor injury (-${injury} Life).`;
      } else if (outcome === 'Partial') {
        const scrap = 1 + Math.floor(Math.random() * 3);
        next.inventory = { ...prev.inventory, scrap: prev.inventory.scrap + scrap };
        summary = `Recovered ${scrap} scrap.`;
      } else if (outcome === 'Success') {
        const scrap = 3 + Math.floor(Math.random() * 4);
        const components = 1 + Math.floor(Math.random() * 2);
        next.inventory = {
          ...prev.inventory,
          scrap: prev.inventory.scrap + scrap,
          components: prev.inventory.components + components,
        };
        skillGain = 2;
        summary = `Recovered ${scrap} scrap and ${components} components.`;
      } else {
        const components = 2 + Math.floor(Math.random() * 3);
        next.inventory = {
          ...prev.inventory,
          components: prev.inventory.components + components,
          rareTech: prev.inventory.rareTech + 1,
        };
        skillGain = 3;
        summary = `Hit hidden stash: ${components} components and 1 rare tech.`;
      }

      if (approach === 'careful') skillGain += 1;
      if (approach === 'deep') skillGain += 1;
      next.scavengingSkill += skillGain;

      const entry: CrimeLogEntry = {
        id: crypto.randomUUID(),
        approach: cfg.label,
        outcome,
        summary,
        at: new Date().toISOString(),
      };

      next.crimeLog = [entry, ...prev.crimeLog].slice(0, 10);
      setNotice(`${cfg.label}: ${summary}`);
      void exceptionalChance;
      return next;
    });
  };

  const renderContent = () => {
    if (section === 'operations') {
      return (
        <div className="space-y-4">
          <div className="rounded border border-[#2f3b4b] bg-[#121923] p-4">
            <h2 className="text-lg font-semibold text-[#eef2f8]">Scavenge the Ruins</h2>
            <p className="mt-1 text-sm text-[#a7b5c8]">
              Foundation operation. Low-risk repetition to build Scavenging and supply lines.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <button onClick={() => runCrime('careful')} className="rounded border border-[#3c4a5d] bg-[#1a2432] p-3 text-left hover:bg-[#213046]">
                <p className="text-sm font-semibold">Careful Search</p>
                <p className="mt-1 text-xs text-[#93a5bd]">Low risk, low reward, steady skill gain.</p>
              </button>
              <button onClick={() => runCrime('quick')} className="rounded border border-[#3c4a5d] bg-[#1a2432] p-3 text-left hover:bg-[#213046]">
                <p className="text-sm font-semibold">Quick Grab</p>
                <p className="mt-1 text-xs text-[#93a5bd]">Faster run, higher fail chance, moderate reward.</p>
              </button>
              <button
                onClick={() => runCrime('deep')}
                className={`rounded border p-3 text-left ${deepDigUnlocked ? 'border-[#3c4a5d] bg-[#1a2432] hover:bg-[#213046]' : 'border-[#384051] bg-[#151c27] opacity-70'}`}
              >
                <p className="text-sm font-semibold">Deep Dig</p>
                <p className="mt-1 text-xs text-[#93a5bd]">{deepDigUnlocked ? 'High risk, rare tech chance.' : 'Unlocks at Scavenging 25.'}</p>
              </button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded border border-[#2f3b4b] bg-[#121923] p-4 text-sm">
              <h3 className="mb-2 font-semibold text-[#dce6f5]">Progression</h3>
              <p>Scavenging: <span className="font-semibold text-[#eef2f8]">{state.scavengingSkill}</span></p>
              <p className="mt-2">Zones:</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {zonesUnlocked.map((zone) => (
                  <span key={zone} className="rounded border border-[#425167] bg-[#1a2432] px-2 py-1 text-xs">{zone}</span>
                ))}
              </div>
            </div>
            <div className="rounded border border-[#2f3b4b] bg-[#121923] p-4 text-sm">
              <h3 className="mb-2 font-semibold text-[#dce6f5]">Loot</h3>
              <p>Scrap: <span className="font-semibold text-[#eef2f8]">{state.inventory.scrap}</span></p>
              <p>Components: <span className="font-semibold text-[#eef2f8]">{state.inventory.components}</span></p>
              <p>Rare Tech: <span className="font-semibold text-[#eef2f8]">{state.inventory.rareTech}</span></p>
            </div>
          </div>

          <div className="rounded border border-[#2f3b4b] bg-[#121923] p-4">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[#93a5bd]">Operation Log</h3>
            <div className="space-y-2 text-sm">
              {state.crimeLog.length === 0 ? (
                <p className="text-[#90a2bb]">No operations run yet.</p>
              ) : (
                state.crimeLog.map((entry) => (
                  <div key={entry.id} className="rounded border border-[#344257] bg-[#1a2432] p-2">
                    <p className="font-semibold text-[#e4ecf8]">{entry.approach} - {entry.outcome}</p>
                    <p className="text-xs text-[#9aacc3]">{entry.summary}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      );
    }

    if (section === 'training') {
      return (
        <div className="rounded border border-[#2f3b4b] bg-[#121923] p-4 text-sm">
          <h2 className="mb-3 text-lg font-semibold text-[#eef2f8]">Training Grounds</h2>
          <div className="space-y-2">
            <div className="flex items-center justify-between"><span>Ferocity (Strength)</span><button onClick={() => trainStat('ferocity', 'Ferocity')} className="rounded border border-[#3c4a5d] px-2 py-1 text-xs hover:bg-[#243246]">{state.battle.ferocity} Train</button></div>
            <div className="flex items-center justify-between"><span>Agility (Speed)</span><button onClick={() => trainStat('agility', 'Agility')} className="rounded border border-[#3c4a5d] px-2 py-1 text-xs hover:bg-[#243246]">{state.battle.agility} Train</button></div>
            <div className="flex items-center justify-between"><span>Instinct (Dexterity)</span><button onClick={() => trainStat('instinctCombat', 'Instinct')} className="rounded border border-[#3c4a5d] px-2 py-1 text-xs hover:bg-[#243246]">{state.battle.instinctCombat} Train</button></div>
            <div className="flex items-center justify-between"><span>Grit (Defense)</span><button onClick={() => trainStat('grit', 'Grit')} className="rounded border border-[#3c4a5d] px-2 py-1 text-xs hover:bg-[#243246]">{state.battle.grit} Train</button></div>
          </div>
        </div>
      );
    }

    if (section === 'academy') {
      return (
        <div className="rounded border border-[#2f3b4b] bg-[#121923] p-4 text-sm">
          <h2 className="mb-3 text-lg font-semibold text-[#eef2f8]">Academy</h2>
          <p>Classes completed: <span className="font-semibold">{state.collegeClasses}</span></p>
          <button onClick={takeCollegeClass} className="mt-3 rounded border border-[#3c4a5d] bg-[#1a2432] px-3 py-2 hover:bg-[#213046]">Take Class (8 Energy, 5 Happy)</button>
        </div>
      );
    }

    return (
      <div className="rounded border border-[#2f3b4b] bg-[#121923] p-4 text-sm">
        <h2 className="text-lg font-semibold text-[#eef2f8]">{navItems.find((n) => n.id === section)?.label}</h2>
        <p className="mt-2 text-[#9aacc3]">This module is staged and ready for implementation next.</p>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#1a1f27] text-[#d6dde8]">
      <div className="mx-auto flex min-h-screen max-w-[1600px]">
        <aside className="hidden w-72 border-r border-[#2e3643] bg-[#11161d] p-4 lg:block">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.25em] text-[#6f7d91]">Vox City</p>
              <h1 className="text-lg font-semibold text-[#eef2f8]">Operations Net</h1>
            </div>
          </div>

          <button onClick={onBackToHub} className="mb-4 w-full rounded border border-[#3c4a5d] bg-[#202a37] px-3 py-2 text-sm hover:bg-[#273448]">
            Back to TimeQuest Hub
          </button>

          <nav className="space-y-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setSection(item.id)}
                className={`w-full rounded px-3 py-2 text-left text-sm ${section === item.id ? 'bg-[#253144] text-[#eef2f8]' : 'text-[#a7b5c8] hover:bg-[#1c2533]'}`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        <main className="flex-1">
          <header className="border-b border-[#2e3643] bg-[#11161d] px-3 py-3 sm:px-5">
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={onBackToHub} className="rounded border border-[#3c4a5d] px-2 py-1 text-xs lg:hidden">Back</button>
              {!user ? (
                <button onClick={onOpenAuth} className="rounded border border-[#3c4a5d] px-2 py-1 text-xs">Sign In</button>
              ) : (
                <span className="rounded border border-[#334358] bg-[#1a2432] px-2 py-1 text-xs">{user.displayName}</span>
              )}

              <div className="ml-auto flex flex-wrap gap-2 text-xs">
                <span className="rounded border border-[#4a3940] bg-[#2a1d22] px-2 py-1">Life {state.resources.life}/{state.resources.maxLife}</span>
                <span className="rounded border border-[#35506c] bg-[#1a2a3a] px-2 py-1">Energy {state.resources.energy}/{state.resources.maxEnergy}</span>
                <span className="rounded border border-[#3f5c35] bg-[#1e3121] px-2 py-1">Nerve {state.resources.nerve}/{state.resources.maxNerve}</span>
                <span className="rounded border border-[#6a5a2f] bg-[#352d1b] px-2 py-1">Happy {state.resources.happy}/{state.resources.maxHappy}</span>
              </div>
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              {subNavBySection[section].map((label) => (
                <span key={label} className="rounded border border-[#334358] bg-[#1a2432] px-2 py-1 text-xs text-[#b8c7da]">{label}</span>
              ))}
            </div>
            <p className="mt-2 text-xs text-[#8aa0ba]">{notice}</p>
          </header>

          <div className="p-3 sm:p-5">{renderContent()}</div>
        </main>
      </div>
    </div>
  );
};

export default VoxCity;
