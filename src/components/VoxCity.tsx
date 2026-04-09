import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

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

type Outcome = 'Fail' | 'Partial' | 'Success' | 'Exceptional';

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
  nextMoraleResetAt?: string | null;
}

interface InventoryState {
  scrap: number;
  components: number;
  rareTech: number;
}

interface InventoryItem {
  name: string;
  category: string;
  quantity: number;
  moraleBoost?: number;
  energyBoost?: number;
  lifeBoost?: number;
  cooldownType?: 'none' | 'medical' | 'booster' | 'drug';
  cooldownAddSeconds?: number;
  description?: string;
  rarity?: string;
}

interface CooldownState {
  medicalSeconds: number;
  medicalMaxSeconds: number;
  boosterSeconds: number;
  boosterMaxSeconds: number;
  drugSeconds: number;
}

interface AcademyCourse {
  slug: string;
  major: string;
  majorOrder: number;
  courseOrder: number;
  displayName: string;
  durationSeconds: number;
  bonus: string;
  completed: boolean;
  inProgress: boolean;
}

interface AcademyState {
  activeCourseSlug?: string | null;
  startedAt?: string | null;
  courses: AcademyCourse[];
}

interface ExchangeState {
  voxPoints: number;
  unlocks: Array<{ slug: string; unlockedAt: string }>;
  catalog: Array<{ slug: string; name: string; costPoints: number }>;
}

interface MarketState {
  treasuryFp: number;
  stocks: Array<{
    slug: string;
    name: string;
    currentPriceFp: number;
    minPriceFp: number;
    maxPriceFp: number;
    lastChangePct: number;
    blockSize: number;
    benefits: Array<{ key: string; sharesRequired: number; cooldownSeconds: number; rewardType: string; rewardValue?: number; rewardItem?: string; rewardQuantity?: number }>;
    sharesOwned: number;
  }>;
}

interface CrimeLogEntry {
  id: string;
  approach: string;
  outcome: Outcome;
  summary: string;
  at: string;
}

interface VoxCityState {
  battle: BattleStats;
  resources: ResourceStats;
  scavengingSkill: number;
  collegeClasses: number;
  totalGymEnergySpent: number;
  inventory: InventoryState;
  inventoryItems: InventoryItem[];
  cooldowns: CooldownState;
  gender: 'male' | 'female';
  academy: AcademyState;
  exchange: ExchangeState;
  market: MarketState;
  crimeLog: CrimeLogEntry[];
  isDev: boolean;
  activeGym: string;
  gyms: Array<{
    slug: string;
    displayName: string;
    sortOrder: number;
    tier: GymTier;
    costFp: number;
    energyPerTrain: 5 | 10 | 25 | 50;
    energyRequired: number;
    dots: {
      ferocity: number;
      agility: number;
      instinctCombat: number;
      grit: number;
    };
    unlocked: boolean;
    active: boolean;
  }>;
  notice?: string;
}

interface VoxCityProps {
  onBackToHub: () => void;
  onOpenAuth: () => void;
}

type GymTier = 'lightweight' | 'medium' | 'heavyweight' | 'special';
const GENERAL_GYM_CHAIN = [
  'scrap-yard-gym',
  'rustfang-fitness',
  'iron-den',
  'shoreline-brawlers',
  'silverfang-gym',
  'vixen-form-studio',
  'denmasters-pit',
  'vox-central-gym',
  'bonebreaker-yard',
  'pioneer-den',
  'anomaly-forge',
  'core-facility',
  'razortrack-fitness',
  'pulse-cardio-hub',
  'lowerbody-forge',
  'deep-burn-complex',
  'apollo-den',
  'iron-armory',
  'force-conditioning',
  'cha-den-arena',
  'atlas-stronghold',
  'last-round-pit',
  'the-edge-arena',
  'apex-predator-facility',
] as const;
const SPECIALIST_GYMS = ['fangforge', 'ghoststep-arena', 'shadow-reflex-lab', 'ironhide-bastion'] as const;

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

const defaultState: VoxCityState = {
  battle: { ferocity: 5, agility: 5, instinctCombat: 5, grit: 5 },
  resources: { energy: 100, maxEnergy: 100, nerve: 10, maxNerve: 10, happy: 100, maxHappy: 100, life: 100, maxLife: 100, nextMoraleResetAt: null },
  scavengingSkill: 1,
  collegeClasses: 0,
  totalGymEnergySpent: 0,
  inventory: { scrap: 0, components: 0, rareTech: 0 },
  inventoryItems: [],
  cooldowns: { medicalSeconds: 0, medicalMaxSeconds: 21600, boosterSeconds: 0, boosterMaxSeconds: 86400, drugSeconds: 0 },
  gender: 'male',
  academy: { activeCourseSlug: null, startedAt: null, courses: [] },
  exchange: { voxPoints: 0, unlocks: [], catalog: [] },
  market: { treasuryFp: 0, stocks: [] },
  crimeLog: [],
  isDev: false,
  activeGym: 'scrap-yard-gym',
  gyms: [],
  notice: 'City systems online.',
};

const gymTierLabels: Record<GymTier, string> = {
  lightweight: 'Lightweight',
  medium: 'Medium',
  heavyweight: 'Heavyweight',
  special: 'Special',
};

const VoxCity: React.FC<VoxCityProps> = ({ onBackToHub, onOpenAuth }) => {
  const { user } = useAuth();
  const [section, setSection] = useState<SectionId>('operations');
  const [state, setState] = useState<VoxCityState>(defaultState);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('City systems online.');
  const [trainingTrains, setTrainingTrains] = useState<number>(1);
  const [selectedGymSlug, setSelectedGymSlug] = useState<string>('');
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventoryCategory, setInventoryCategory] = useState('all');
  const [inventoryView, setInventoryView] = useState<'list' | 'grid'>('list');
  const [selectedGridItemName, setSelectedGridItemName] = useState<string>('');
  const [moraleResetNow, setMoraleResetNow] = useState(Date.now());
  const [devPointDelta, setDevPointDelta] = useState<number>(1);
  const [devRestore, setDevRestore] = useState({
    life: 10,
    stamina: 10,
    instinct: 1,
    morale: 5,
  });

  const zonesUnlocked = useMemo(
    () => [
      'Outmine Dungeons',
      ...(state.scavengingSkill >= 18 ? ['Toxic Ruins'] : []),
      ...(state.scavengingSkill >= 35 ? ['Collapsed Bunkers'] : []),
    ],
    [state.scavengingSkill],
  );

  const deepDigUnlocked = state.scavengingSkill >= 25;
  const activeGym = state.gyms.find((g) => g.slug === state.activeGym) ?? state.gyms.find((g) => g.active);
  const selectedGym =
    state.gyms.find((g) => g.slug === selectedGymSlug) ??
    activeGym ??
    state.gyms[0];
  const formatStat = (value: number) => Number(value || 0).toFixed(4);
  const nextMoraleResetMs = state.resources.nextMoraleResetAt ? new Date(state.resources.nextMoraleResetAt).getTime() : 0;
  const moraleOverMax = state.resources.happy > state.resources.maxHappy;
  const moraleResetSeconds = moraleOverMax && nextMoraleResetMs > moraleResetNow
    ? Math.floor((nextMoraleResetMs - moraleResetNow) / 1000)
    : 0;
  const moraleResetTimer = `${Math.floor(moraleResetSeconds / 60)}:${String(moraleResetSeconds % 60).padStart(2, '0')}`;
  const formatDuration = (seconds: number) => {
    const clamped = Math.max(0, Math.floor(seconds));
    const h = Math.floor(clamped / 3600);
    const m = Math.floor((clamped % 3600) / 60);
    const s = clamped % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };
  const iconHeat = (current: number, max: number) => {
    const p = Math.max(0, Math.min(1, current / Math.max(1, max)));
    const r = Math.round(64 + p * 191);
    const g = Math.round(205 - p * 150);
    return `rgb(${r},${g},90)`;
  };
  const canUseItem = (item: InventoryItem) => {
    const cooldownType = item.cooldownType ?? (item.category === 'morale' ? 'booster' : 'none');
    if (cooldownType === 'medical') {
      return state.cooldowns.medicalSeconds <= state.cooldowns.medicalMaxSeconds;
    }
    if (cooldownType === 'booster') {
      return state.cooldowns.boosterSeconds <= state.cooldowns.boosterMaxSeconds;
    }
    if (cooldownType === 'drug') {
      return state.cooldowns.drugSeconds <= 0;
    }
    return Boolean((item.moraleBoost ?? 0) > 0 || (item.energyBoost ?? 0) > 0 || (item.lifeBoost ?? 0) > 0);
  };
  const unlockedGymSet = useMemo(() => new Set(state.gyms.filter((g) => g.unlocked).map((g) => g.slug)), [state.gyms]);
  const canPurchaseGym = (slug: string) => {
    if (unlockedGymSet.has(slug)) return false;
    const gym = state.gyms.find((g) => g.slug === slug);
    if (!gym) return false;
    if ((SPECIALIST_GYMS as readonly string[]).includes(slug)) {
      return unlockedGymSet.has('apex-predator-facility');
    }
    const idx = GENERAL_GYM_CHAIN.findIndex((gymSlug) => gymSlug === slug);
    if (idx < 0) return false;
    if (idx === 0) return state.totalGymEnergySpent >= gym.energyRequired;
    return unlockedGymSet.has(GENERAL_GYM_CHAIN[idx - 1]) && state.totalGymEnergySpent >= gym.energyRequired;
  };
  const getLockedGymHint = (slug: string) => {
    if ((SPECIALIST_GYMS as readonly string[]).includes(slug) && !unlockedGymSet.has('apex-predator-facility')) {
      return 'Unlock Apex Predator Facility first.';
    }
    const idx = GENERAL_GYM_CHAIN.findIndex((gymSlug) => gymSlug === slug);
    if (idx > 0 && !unlockedGymSet.has(GENERAL_GYM_CHAIN[idx - 1])) {
      const prevGym = state.gyms.find((g) => g.slug === GENERAL_GYM_CHAIN[idx - 1]);
      return `Unlock ${prevGym?.displayName ?? 'the previous gym'} first.`;
    }
    const gym = state.gyms.find((g) => g.slug === slug);
    if (gym && state.totalGymEnergySpent < gym.energyRequired) {
      return state.isDev
        ? `Need ${state.totalGymEnergySpent.toLocaleString()} / ${gym.energyRequired.toLocaleString()} lifetime gym energy spent.`
        : 'Spend more energy in training to unlock this gym.';
    }
    return 'Gym is locked.';
  };
  const getGymInitials = (name: string) =>
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? '')
      .join('');
  const renderDotPills = (dots: number) => {
    const clamped = Math.max(0, Math.min(10, dots));
    const full = Math.floor(clamped);
    const partial = clamped - full;

    return (
      <div className="flex gap-1">
        {Array.from({ length: 10 }).map((_, idx) => {
          const fill = idx < full ? 1 : idx === full ? partial : 0;
          return (
            <span key={idx} className="relative h-2.5 w-4 overflow-hidden rounded-full bg-[#2b3645]">
              <span
                className="absolute left-0 top-0 h-full rounded-full bg-cyan-500"
                style={{ width: `${Math.round(fill * 100)}%` }}
              />
            </span>
          );
        })}
      </div>
    );
  };

  const gymsByTier = useMemo(() => {
    const grouped: Record<GymTier, VoxCityState['gyms']> = {
      lightweight: [],
      medium: [],
      heavyweight: [],
      special: [],
    };

    [...state.gyms]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .forEach((gym) => {
        const tier = gym.tier ?? 'special';
        grouped[tier].push(gym);
      });

    return grouped;
  }, [state.gyms]);
  const gymSlotsByTier = useMemo(() => {
    const tiers: GymTier[] = ['lightweight', 'medium', 'heavyweight', 'special'];
    return tiers.reduce(
      (acc, tier) => {
        acc[tier] = Array.from({ length: 8 }).map((_, idx) => gymsByTier[tier][idx] ?? null);
        return acc;
      },
      {} as Record<GymTier, Array<VoxCityState['gyms'][number] | null>>,
    );
  }, [gymsByTier]);

  useEffect(() => {
    if (!selectedGymSlug && activeGym?.slug) {
      setSelectedGymSlug(activeGym.slug);
    }
  }, [activeGym?.slug, selectedGymSlug]);

  useEffect(() => {
    const timer = window.setInterval(() => setMoraleResetNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const filteredInventoryItems = useMemo(() => {
    const term = inventorySearch.trim().toLowerCase();
    return state.inventoryItems.filter((item) => {
      const categoryMatch = inventoryCategory === 'all' || item.category === inventoryCategory;
      const textMatch = term.length === 0 || item.name.toLowerCase().includes(term);
      return categoryMatch && textMatch;
    });
  }, [state.inventoryItems, inventorySearch, inventoryCategory]);

  const loadState = async (silent = false) => {
    if (!user) {
      setLoading(false);
      return;
    }

    if (!silent) setLoading(true);
    const { data, error } = await supabase.rpc('vox_city_get_state', { p_user_id: user.id });
    if (error) {
      setNotice(error.message || 'Failed to load city state.');
      setLoading(false);
      return;
    }

    setState(data as VoxCityState);
    setLoading(false);
  };

  useEffect(() => {
    void loadState();
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(() => {
      void loadState(true);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [user?.id]);

  const runAction = async (action: string, payload: Record<string, unknown> = {}) => {
    if (!user || busy) return;

    setBusy(true);
    const { data, error } = await supabase.rpc('vox_city_apply_action', {
      p_user_id: user.id,
      p_action: action,
      p_payload: payload,
    });

    if (error) {
      setNotice(error.message || 'Action failed.');
      setBusy(false);
      return;
    }

    const next = data as VoxCityState;
    setState(next);
    setNotice(next.notice || 'Action completed.');
    setBusy(false);
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
              <button disabled={busy} onClick={() => void runAction('crime', { approach: 'careful' })} className="rounded border border-[#3c4a5d] bg-[#1a2432] p-3 text-left hover:bg-[#213046] disabled:opacity-60">
                <p className="text-sm font-semibold">Careful Search</p>
                <p className="mt-1 text-xs text-[#93a5bd]">Low risk, low reward, steady skill gain.</p>
              </button>
              <button disabled={busy} onClick={() => void runAction('crime', { approach: 'quick' })} className="rounded border border-[#3c4a5d] bg-[#1a2432] p-3 text-left hover:bg-[#213046] disabled:opacity-60">
                <p className="text-sm font-semibold">Quick Grab</p>
                <p className="mt-1 text-xs text-[#93a5bd]">Faster run, higher fail chance, moderate reward.</p>
              </button>
              <button
                disabled={busy || !deepDigUnlocked}
                onClick={() => void runAction('crime', { approach: 'deep' })}
                className={`rounded border p-3 text-left disabled:opacity-60 ${deepDigUnlocked ? 'border-[#3c4a5d] bg-[#1a2432] hover:bg-[#213046]' : 'border-[#384051] bg-[#151c27]'}`}
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
        <div className="space-y-4">
          <div className="rounded border border-[#2f3b4b] bg-[#121923] p-4 text-sm">
            <h2 className="mb-3 text-lg font-semibold text-[#eef2f8]">Training Grounds</h2>
            <div className="mb-3 grid gap-2 sm:grid-cols-2">
              <div className="rounded border border-[#344257] bg-[#1a2432] px-2 py-2 text-xs text-[#c6d5e8]">
                Active Gym: <span className="font-semibold text-[#eef2f8]">{activeGym?.displayName ?? 'None'}</span>
                <div className="text-[#90a2bb]">{activeGym?.energyPerTrain ?? 5} Stamina per train</div>
                {state.isDev && (
                  <div className="text-[#90a2bb]">Lifetime Gym Energy Spent: {state.totalGymEnergySpent.toLocaleString()}</div>
                )}
              </div>
              <label className="text-xs text-[#9aacc3]">
                Train count
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={trainingTrains}
                  onChange={(e) => setTrainingTrains(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                  className="mt-1 w-full rounded border border-[#3c4a5d] bg-[#1a2432] px-2 py-1 text-sm text-[#e6eef9]"
                />
              </label>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between"><span>Ferocity</span><button disabled={busy} onClick={() => void runAction('train', { stat: 'ferocity', trains: trainingTrains })} className="rounded border border-[#3c4a5d] px-2 py-1 text-xs hover:bg-[#243246] disabled:opacity-60">{formatStat(state.battle.ferocity)} Train</button></div>
              <div className="flex items-center justify-between"><span>Agility</span><button disabled={busy} onClick={() => void runAction('train', { stat: 'agility', trains: trainingTrains })} className="rounded border border-[#3c4a5d] px-2 py-1 text-xs hover:bg-[#243246] disabled:opacity-60">{formatStat(state.battle.agility)} Train</button></div>
              <div className="flex items-center justify-between"><span>Instinct</span><button disabled={busy} onClick={() => void runAction('train', { stat: 'instinctCombat', trains: trainingTrains })} className="rounded border border-[#3c4a5d] px-2 py-1 text-xs hover:bg-[#243246] disabled:opacity-60">{formatStat(state.battle.instinctCombat)} Train</button></div>
              <div className="flex items-center justify-between"><span>Grit</span><button disabled={busy} onClick={() => void runAction('train', { stat: 'grit', trains: trainingTrains })} className="rounded border border-[#3c4a5d] px-2 py-1 text-xs hover:bg-[#243246] disabled:opacity-60">{formatStat(state.battle.grit)} Train</button></div>
            </div>
          </div>

          <div className="rounded border border-[#2f3b4b] bg-[#121923] p-4 text-sm">
            <h2 className="mb-3 text-lg font-semibold text-[#eef2f8]">Gym List</h2>
            <div className="space-y-2">
              {([
                ['lightweight', 'medium'],
                ['heavyweight', 'special'],
              ] as Array<[GymTier, GymTier]>).map(([leftTier, rightTier]) => (
                <div key={`${leftTier}-${rightTier}`} className="space-y-1">
                  <div className="grid grid-cols-[repeat(8,minmax(0,1fr))_10px_repeat(8,minmax(0,1fr))] gap-1">
                    <p className="col-span-8 text-[11px] font-semibold uppercase tracking-wide text-[#90a2bb]">
                      {gymTierLabels[leftTier]}
                    </p>
                    <div />
                    <p className="col-span-8 text-[11px] font-semibold uppercase tracking-wide text-[#90a2bb]">
                      {gymTierLabels[rightTier]}
                    </p>
                  </div>
                  <div className="grid grid-cols-[repeat(8,minmax(0,1fr))_10px_repeat(8,minmax(0,1fr))] gap-1 sm:gap-1.5">
                    {gymSlotsByTier[leftTier].map((gym, idx) => {
                      if (!gym) {
                        return (
                          <div
                            key={`${leftTier}-empty-${idx}`}
                            className="aspect-square w-full rounded border border-[#2e3643] bg-[#141b25]/70"
                          />
                        );
                      }
                      return (
                        <button
                          key={gym.slug}
                          onClick={() => setSelectedGymSlug(gym.slug)}
                          className={`aspect-square w-full rounded border text-center text-[9px] font-semibold leading-none transition ${
                            selectedGym?.slug === gym.slug
                              ? 'border-cyan-500 bg-[#203247] text-[#e6f7ff]'
                              : 'border-[#344257] bg-[#1a2432] text-[#c9d6e8] hover:bg-[#223248]'
                          }`}
                        >
                          <div className="flex h-full items-center justify-center px-0.5">
                            {getGymInitials(gym.displayName)}
                          </div>
                        </button>
                      );
                    })}

                    <div className="h-full w-full rounded bg-[#17202b]" />

                    {gymSlotsByTier[rightTier].map((gym, idx) => {
                      if (!gym) {
                        return (
                          <div
                            key={`${rightTier}-empty-${idx}`}
                            className="aspect-square w-full rounded border border-[#2e3643] bg-[#141b25]/70"
                          />
                        );
                      }
                      return (
                        <button
                          key={gym.slug}
                          onClick={() => setSelectedGymSlug(gym.slug)}
                          className={`aspect-square w-full rounded border text-center text-[9px] font-semibold leading-none transition ${
                            selectedGym?.slug === gym.slug
                              ? 'border-cyan-500 bg-[#203247] text-[#e6f7ff]'
                              : 'border-[#344257] bg-[#1a2432] text-[#c9d6e8] hover:bg-[#223248]'
                          }`}
                        >
                          <div className="flex h-full items-center justify-center px-0.5">
                            {getGymInitials(gym.displayName)}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {selectedGym && (
              <div className="mt-3 rounded border border-[#344257] bg-[#1a2432] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-[#eef2f8]">{selectedGym.displayName}</p>
                    <p className="text-xs text-[#9aacc3]">{selectedGym.energyPerTrain} Stamina per train</p>
                  </div>
                  {selectedGym.unlocked ? (
                    selectedGym.slug === state.activeGym ? (
                      <span className="rounded border border-[#38576c] bg-[#1b3346] px-2 py-1 text-xs text-[#98d0ff]">Active</span>
                    ) : (
                      <button
                        disabled={busy}
                        onClick={() => void runAction('set_gym', { gymSlug: selectedGym.slug })}
                        className="rounded border border-[#3c4a5d] px-2 py-1 text-xs hover:bg-[#243246] disabled:opacity-60"
                      >
                        Activate
                      </button>
                    )
                  ) : canPurchaseGym(selectedGym.slug) ? (
                    <button
                      disabled={busy}
                      onClick={() => void runAction('buy_gym', { gymSlug: selectedGym.slug })}
                      className="rounded border border-[#66553b] bg-[#33291c] px-2 py-1 text-xs text-[#f3d7aa] hover:bg-[#413222] disabled:opacity-60"
                    >
                      Unlock ({selectedGym.costFp.toLocaleString()} FP)
                    </button>
                  ) : (
                    <span className="rounded border border-[#4a3f3f] bg-[#2a2020] px-2 py-1 text-xs text-[#d5b4b4]">Locked</span>
                  )}
                </div>
                {!selectedGym.unlocked && !canPurchaseGym(selectedGym.slug) && (
                  <p className="mt-2 text-xs text-[#d0a2a2]">{getLockedGymHint(selectedGym.slug)}</p>
                )}

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[#9fb0c5]">
                  {([
                    ['Ferocity', selectedGym.dots.ferocity],
                    ['Agility', selectedGym.dots.agility],
                    ['Instinct', selectedGym.dots.instinctCombat],
                    ['Grit', selectedGym.dots.grit],
                  ] as Array<[string, number]>).map(([label, dots]) => (
                    <div key={label} title={`${Number(dots).toFixed(1)} ${label}`}>
                      <div className="mb-1 flex justify-between"><span>{label}</span></div>
                      {renderDotPills(dots)}
                    </div>
                  ))}
                </div>
                {state.isDev && (
                  <div className="mt-3 rounded border border-[#2f3c4f] bg-[#121923] p-2 text-xs">
                    <p className="mb-1 text-[#cfe0f4]">
                      Energy Progress: {state.totalGymEnergySpent.toLocaleString()} / {selectedGym.energyRequired.toLocaleString()}
                    </p>
                    <div className="h-2 rounded bg-[#0f1620]">
                      <div
                        className="h-full rounded bg-cyan-700"
                        style={{ width: `${Math.max(0, Math.min(100, (state.totalGymEnergySpent / Math.max(1, selectedGym.energyRequired)) * 100))}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      );
    }

    if (section === 'items') {
      const filterButtons: Array<{ id: string; label: string; icon: string }> = [
        { id: 'all', label: 'All', icon: '☰' },
        { id: 'favorite', label: 'Fav', icon: '★' },
        { id: 'weapon', label: 'Weapons', icon: '✦' },
        { id: 'armor', label: 'Armor', icon: '⬒' },
        { id: 'medical', label: 'Medical', icon: '+' },
        { id: 'drug', label: 'Stimulants', icon: '◉' },
        { id: 'temporary', label: 'Temp', icon: '⌛' },
        { id: 'special', label: 'Special', icon: '◆' },
        { id: 'jewelry', label: 'Jewelry', icon: '◇' },
        { id: 'book', label: 'Books', icon: '▤' },
        { id: 'morale', label: 'Morale', icon: 'M' },
        { id: 'misc', label: 'Misc', icon: '◌' },
      ];

      return (
        <div className="space-y-2">
          <div className="rounded border border-[#323b48] bg-[#171c24]">
            <div className="flex items-center justify-between border-b border-[#2c3441] px-2 py-1 text-[11px]">
              <div className="flex gap-1">
                {['Items', 'Ammo', 'Mods', 'Trades', 'Bazaar', 'Display'].map((tab) => (
                  <button
                    key={tab}
                    className={`rounded px-2 py-1 ${tab === 'Items' ? 'bg-[#2f3746] text-[#eef2f8]' : 'bg-[#1d2430] text-[#95a8c0]'}`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setInventoryView('list')}
                  className={`rounded px-2 py-1 ${inventoryView === 'list' ? 'bg-[#2f3746] text-[#e8edf5]' : 'bg-[#1d2430] text-[#94a6be]'}`}
                >
                  List
                </button>
                <button
                  onClick={() => setInventoryView('grid')}
                  className={`rounded px-2 py-1 ${inventoryView === 'grid' ? 'bg-[#2f3746] text-[#e8edf5]' : 'bg-[#1d2430] text-[#94a6be]'}`}
                >
                  Grid
                </button>
                <button className="rounded bg-[#1d2430] px-2 py-1 text-[#94a6be]">?</button>
              </div>
            </div>

            <div className="grid grid-cols-[130px_minmax(0,1fr)_220px] gap-2 border-b border-[#2c3441] bg-[#1b222d] p-2">
              <div className="aspect-square max-h-[120px] rounded border border-[#3b4454] bg-[#101720] p-1 text-[10px] text-[#8ea2bd]">
                Avatar Preview
              </div>
              <div className="rounded border border-[#3b4454] bg-[#101720] p-2 text-[11px] text-[#9fb0c5]">
                <div className="mb-1 flex items-center justify-between">
                  <button className="rounded border border-[#3a4659] px-1">◀</button>
                  <span className="text-[#d2dbe8]">Secondary</span>
                  <button className="rounded border border-[#3a4659] px-1">▶</button>
                </div>
                <div className="h-14 rounded border border-dashed border-[#3a4659] bg-[#151c27]" />
              </div>
              <div className="grid grid-cols-3 gap-1">
                {['Primary', 'Secondary', 'Melee', 'Temp', 'Head', 'Body', 'Hands', 'Legs', 'Feet'].map((slot) => (
                  <div key={slot} className="h-9 rounded border border-[#3a4555] bg-[#131a24] px-1 py-0.5 text-[9px] text-[#7d8ea5]">
                    {slot}
                  </div>
                ))}
              </div>
            </div>

              <div className="grid grid-cols-3 gap-1 border-b border-[#2c3441] bg-[#141a23] px-2 py-1 text-[10px]">
                <div className={`${state.cooldowns.medicalSeconds > state.cooldowns.medicalMaxSeconds ? 'text-rose-300' : 'text-[#9eb2ca]'}`}>
                  Medical Cooldown: {formatDuration(state.cooldowns.medicalSeconds)} / {formatDuration(state.cooldowns.medicalMaxSeconds)}
                </div>
                <div className={`${state.cooldowns.boosterSeconds > state.cooldowns.boosterMaxSeconds ? 'text-amber-300' : 'text-[#9eb2ca]'}`}>
                  Booster Cooldown: {formatDuration(state.cooldowns.boosterSeconds)} / {formatDuration(state.cooldowns.boosterMaxSeconds)}
                </div>
                <div className={`${state.cooldowns.drugSeconds > 0 ? 'text-violet-300' : 'text-[#9eb2ca]'}`}>
                  Stimulant Cooldown: {formatDuration(state.cooldowns.drugSeconds)}
                </div>
              </div>

            <div className="flex items-center justify-between border-b border-[#2c3441] px-2 py-1 text-xs">
              <span className="text-[#dbe4f0]">Your items - {inventoryCategory === 'all' ? 'All' : inventoryCategory}</span>
              <input
                value={inventorySearch}
                onChange={(e) => setInventorySearch(e.target.value)}
                placeholder="search..."
                className="w-52 rounded border border-[#3a4659] bg-[#131a24] px-2 py-1 text-xs text-[#dbe4f0]"
              />
            </div>

            <div className="flex gap-1 border-b border-[#2c3441] px-2 py-1">
              {filterButtons.map((filter) => (
                <button
                  key={filter.id}
                  title={filter.label}
                  onClick={() => setInventoryCategory(filter.id)}
                  className={`h-6 w-6 rounded border text-[11px] ${
                    inventoryCategory === filter.id
                      ? 'border-cyan-500 bg-[#1f3448] text-[#d8f2ff]'
                      : 'border-[#3a4659] bg-[#141b25] text-[#8ea2bd]'
                  }`}
                >
                  {filter.icon}
                </button>
              ))}
            </div>

            <div className="max-h-[380px] overflow-auto">
              <div className="grid grid-cols-[38px_minmax(0,1fr)_35px_45px_45px_45px] border-b border-[#2c3441] bg-[#131a24] px-2 py-1 text-[10px] uppercase tracking-wide text-[#8194ab]">
                <span>Icon</span>
                <span>Name</span>
                <span className="text-center">Eq</span>
                <span className="text-center">Use</span>
                <span className="text-center">Sell</span>
                <span className="text-center">Trade</span>
              </div>
              {filteredInventoryItems.length === 0 ? (
                <p className="px-2 py-3 text-xs text-[#8ea1b8]">No items match this filter.</p>
              ) : inventoryView === 'grid' ? (
                <div className="space-y-2 p-2">
                  <div className="grid grid-cols-5 gap-1">
                    {filteredInventoryItems.map((item) => (
                      <button
                        key={item.name}
                        onClick={() => setSelectedGridItemName((prev) => (prev === item.name ? '' : item.name))}
                        className={`rounded border p-1 text-left text-[10px] ${
                          selectedGridItemName === item.name ? 'border-cyan-500 bg-[#1a2b3d]' : 'border-[#344053] bg-[#151d28]'
                        }`}
                      >
                      <div className="mb-1 h-9 rounded bg-[#0f1620]" />
                      <p className="truncate text-[#d9e3f0]">{item.name}</p>
                      <p className="text-[#8ea1b8]">x{item.quantity}</p>
                      </button>
                    ))}
                  </div>
                  {selectedGridItemName && (
                    (() => {
                      const selectedItem = filteredInventoryItems.find((item) => item.name === selectedGridItemName);
                      if (!selectedItem) return null;
                      return (
                        <div className="rounded border border-[#3a4659] bg-[#111821] p-2 text-xs">
                          <p className="font-semibold text-[#dbe5f3]">{selectedItem.name}</p>
                          <p className="text-[11px] text-[#8ea2ba]">{selectedItem.description ?? 'No description.'}</p>
                          <div className="mt-2 flex gap-2">
                            <button
                              disabled={busy || selectedItem.quantity <= 0 || !canUseItem(selectedItem)}
                              onClick={() => void runAction('use_item', { itemName: selectedItem.name })}
                              className="rounded border border-[#355069] px-2 py-1 text-[11px] text-[#a8dcff] disabled:opacity-40"
                            >
                              Use
                            </button>
                            <button className="rounded border border-[#4c4d43] px-2 py-1 text-[11px] text-[#c9c6a4]">Sell</button>
                            <button className="rounded border border-[#43455a] px-2 py-1 text-[11px] text-[#a9b3cd]">Trade</button>
                          </div>
                        </div>
                      );
                    })()
                  )}
                </div>
              ) : (
                filteredInventoryItems.map((item) => (
                  <div key={item.name} className="grid grid-cols-[38px_minmax(0,1fr)_35px_45px_45px_45px] items-center border-b border-[#273140] px-2 py-1 text-xs hover:bg-[#1a2330]">
                    <div className="h-7 w-7 rounded border border-[#3a4659] bg-[#0f1620]" />
                    <div className="min-w-0">
                      <p className="truncate text-[#dfe8f4]">{item.name} {item.quantity > 1 ? `x${item.quantity}` : ''}</p>
                      <p className="truncate text-[10px] text-[#8fa2ba]">{item.description ?? item.category}</p>
                    </div>
                    <span className="text-center text-[#6f8299]">✓</span>
                    <button
                      disabled={busy || item.quantity <= 0 || !canUseItem(item)}
                      onClick={() => void runAction('use_item', { itemName: item.name })}
                      className="rounded border border-[#355069] px-1 py-0.5 text-[10px] text-[#a8dcff] disabled:opacity-40"
                    >
                      Use
                    </button>
                    <button className="rounded border border-[#4c4d43] px-1 py-0.5 text-[10px] text-[#c9c6a4]">Sell</button>
                    <button className="rounded border border-[#43455a] px-1 py-0.5 text-[10px] text-[#a9b3cd]">Trade</button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      );
    }

    if (section === 'academy') {
      const groupedMajors = state.academy.courses.reduce<Record<string, AcademyCourse[]>>((acc, course) => {
        if (!acc[course.major]) acc[course.major] = [];
        acc[course.major].push(course);
        return acc;
      }, {});
      const activeCourse = state.academy.courses.find((c) => c.slug === state.academy.activeCourseSlug);
      const academyRemaining = state.academy.startedAt && activeCourse
        ? Math.max(0, Math.floor((new Date(state.academy.startedAt).getTime() + activeCourse.durationSeconds * 1000 - moraleResetNow) / 1000))
        : 0;
      return (
        <div className="space-y-3 rounded border border-[#2f3b4b] bg-[#121923] p-4 text-sm">
          <h2 className="text-lg font-semibold text-[#eef2f8]">Academy</h2>
          <p className="text-xs text-[#9fb0c5]">One active course at a time. Real-time completion continues offline.</p>
          {activeCourse && (
            <p className="rounded border border-[#3a4659] bg-[#1a2432] px-2 py-1 text-xs text-[#d4e1f2]">
              Active: {activeCourse.displayName} ({formatDuration(academyRemaining)} remaining)
            </p>
          )}
          <div className="space-y-3">
            {Object.entries(groupedMajors).map(([major, courses]) => (
              <div key={major} className="rounded border border-[#344257] bg-[#172130] p-2">
                <h3 className="mb-2 text-sm font-semibold text-[#e5edf8]">{major}</h3>
                <div className="space-y-1">
                  {courses
                    .sort((a, b) => a.courseOrder - b.courseOrder)
                    .map((course) => {
                      const prev = courses.find((c) => c.courseOrder === course.courseOrder - 1);
                      const canStart = !state.academy.activeCourseSlug && !course.completed && (course.courseOrder === 1 || Boolean(prev?.completed));
                      return (
                        <div key={course.slug} className="flex items-center justify-between rounded border border-[#2f3c4f] bg-[#121923] px-2 py-1 text-xs">
                          <div>
                            <p className="text-[#dce6f5]">{course.displayName}</p>
                            <p className="text-[#90a2bb]">{course.bonus} • {formatDuration(course.durationSeconds)}</p>
                          </div>
                          {course.completed ? (
                            <span className="text-emerald-300">Done</span>
                          ) : course.inProgress ? (
                            <span className="text-cyan-300">In Progress</span>
                          ) : (
                            <button
                              disabled={busy || !canStart}
                              onClick={() => void runAction('academy_enroll', { courseSlug: course.slug })}
                              className="rounded border border-[#3c4a5d] px-2 py-1 text-[11px] hover:bg-[#243246] disabled:opacity-40"
                            >
                              Enroll
                            </button>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (section === 'work') {
      return (
        <div className="space-y-3 rounded border border-[#2f3b4b] bg-[#121923] p-4 text-sm">
          <h2 className="text-lg font-semibold text-[#eef2f8]">Vox Exchange</h2>
          <p className="text-xs text-[#9fb0c5]">Vox Points: <span className="font-semibold text-[#eef2f8]">{state.exchange.voxPoints}</span></p>
          {state.isDev && (
            <div className="flex items-center gap-2 rounded border border-[#5a4325] bg-[#2b2013] px-2 py-1 text-xs">
              <input
                type="number"
                value={devPointDelta}
                onChange={(e) => setDevPointDelta(Number(e.target.value) || 1)}
                className="w-20 rounded border border-[#6a5537] bg-[#1d140a] px-2 py-1 text-[#f6ddb6]"
              />
              <button
                disabled={busy}
                onClick={() => void runAction('dev_adjust_points', { delta: Math.abs(devPointDelta || 1) })}
                className="rounded border border-[#684e2b] bg-[#3d2d18] px-2 py-1 text-[#f3cd8d] hover:bg-[#4a361e] disabled:opacity-60"
              >
                +Points
              </button>
              <button
                disabled={busy}
                onClick={() => void runAction('dev_adjust_points', { delta: -Math.abs(devPointDelta || 1) })}
                className="rounded border border-[#684e2b] bg-[#3d2d18] px-2 py-1 text-[#f3cd8d] hover:bg-[#4a361e] disabled:opacity-60"
              >
                -Points
              </button>
            </div>
          )}
          <div className="space-y-2">
            {state.exchange.catalog.map((entry) => {
              const purchased = state.exchange.unlocks.some((u) => u.slug === entry.slug);
              return (
                <div key={entry.slug} className="flex items-center justify-between rounded border border-[#344257] bg-[#1a2432] px-2 py-2 text-xs">
                  <span>{entry.name} ({entry.costPoints} VP)</span>
                  {purchased ? (
                    <span className="text-emerald-300">Unlocked</span>
                  ) : (
                    <button
                      disabled={busy || state.exchange.voxPoints < entry.costPoints}
                      onClick={() => void runAction('exchange_purchase', { unlockSlug: entry.slug })}
                      className="rounded border border-[#3c4a5d] px-2 py-1 hover:bg-[#243246] disabled:opacity-40"
                    >
                      Buy
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    if (section === 'luck-den') {
      const marketAccess = state.exchange.unlocks.some((u) => u.slug === 'market-grid-access');
      return (
        <div className="space-y-3 rounded border border-[#2f3b4b] bg-[#121923] p-4 text-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[#eef2f8]">Market Grid</h2>
            {state.isDev && (
              <span className="rounded border border-[#5a4325] bg-[#2b2013] px-2 py-1 text-xs text-[#f3cd8d]">
                Treasury (FP): {state.market.treasuryFp.toLocaleString()}
              </span>
            )}
          </div>
          {!marketAccess ? (
            <p className="text-xs text-[#d9b58e]">Unlock Market Grid Access from Vox Exchange first.</p>
          ) : (
            <div className="space-y-2">
              {state.market.stocks.map((stock) => (
                <div key={stock.slug} className="rounded border border-[#344257] bg-[#1a2432] p-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[#e3ecf9]">{stock.name}</span>
                    <span className={Number(stock.lastChangePct) >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
                      {(Number(stock.lastChangePct) * 100).toFixed(2)}%
                    </span>
                  </div>
                  <p className="text-[#9db0c7]">Price: {Number(stock.currentPriceFp).toFixed(6)} FP • Shares: {Number(stock.sharesOwned).toFixed(2)}</p>
                  <div className="mt-1 flex gap-2">
                    <button disabled={busy} onClick={() => void runAction('market_buy', { stockSlug: stock.slug, amountFp: 100 })} className="rounded border border-[#3c4a5d] px-2 py-1 hover:bg-[#243246]">Buy 100 FP</button>
                    <button disabled={busy || Number(stock.sharesOwned) <= 0} onClick={() => void runAction('market_sell', { stockSlug: stock.slug, shares: Math.max(1, Math.floor(Number(stock.sharesOwned) * 0.1)) })} className="rounded border border-[#3c4a5d] px-2 py-1 hover:bg-[#243246] disabled:opacity-40">Sell 10%</button>
                  </div>
                  <div className="mt-1 space-y-1">
                    {stock.benefits.map((benefit) => {
                      const progress = Math.max(0, Math.min(100, (Number(stock.sharesOwned) / Number(benefit.sharesRequired || 1)) * 100));
                      return (
                        <div key={benefit.key} className="rounded border border-[#2f3c4f] bg-[#121923] p-1">
                          <p className="text-[11px] text-[#c9d8ea]">{benefit.key} ({benefit.sharesRequired.toLocaleString()} shares)</p>
                          <div className="mt-1 h-2 rounded bg-[#0f1620]">
                            <div className="h-full rounded bg-cyan-700" style={{ width: `${progress}%` }} />
                          </div>
                          <button
                            disabled={busy || Number(stock.sharesOwned) < Number(benefit.sharesRequired)}
                            onClick={() => void runAction('market_claim', { stockSlug: stock.slug, benefitKey: benefit.key })}
                            className="mt-1 rounded border border-[#3c4a5d] px-2 py-1 text-[11px] hover:bg-[#243246] disabled:opacity-40"
                          >
                            Claim
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
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

  if (!user) {
    return (
      <div className="min-h-screen bg-[#1a1f27] text-[#d6dde8] flex items-center justify-center px-4">
        <div className="rounded border border-[#2f3b4b] bg-[#121923] p-6 text-center max-w-md w-full">
          <h2 className="text-lg font-semibold text-[#eef2f8]">Sign in required</h2>
          <p className="mt-2 text-sm text-[#9aacc3]">Vox City progression and vitals are now server-authoritative.</p>
          <button onClick={onOpenAuth} className="mt-4 rounded border border-[#3c4a5d] bg-[#202a37] px-4 py-2 text-sm hover:bg-[#273448]">Sign In</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1a1f27] pb-20 text-[#d6dde8] md:pb-24">
      <div className="mx-auto flex min-h-screen max-w-[1600px]">
        <aside className="hidden w-72 border-r border-[#2e3643] bg-[#11161d] p-4 lg:block">
          <div className="mb-4">
            <img src="/Vixenvox_Logo_smaller.png" alt="VixenVox City" className="mb-2 h-10 w-auto object-contain" />
            <p className="text-[11px] uppercase tracking-[0.25em] text-[#6f7d91]">Vox City</p>
            <h1 className="text-lg font-semibold text-[#eef2f8]">Operations Net</h1>
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
              <span className="rounded border border-[#334358] bg-[#1a2432] px-2 py-1 text-xs">{user.displayName}</span>

              {state.isDev && (
                <div className="flex flex-wrap items-center gap-1 rounded border border-[#5a4325] bg-[#2b2013] px-2 py-1">
                  {(['life', 'stamina', 'instinct', 'morale'] as const).map((vital) => (
                    <div key={vital} className="flex items-center gap-1">
                      <input
                        type="number"
                        min={1}
                        max={99999}
                        value={devRestore[vital]}
                        onChange={(e) =>
                          setDevRestore((prev) => ({
                            ...prev,
                            [vital]: Math.max(1, Math.min(99999, Number(e.target.value) || 1)),
                          }))
                        }
                        className="w-14 rounded border border-[#6a5537] bg-[#1d140a] px-1 py-0.5 text-[11px] text-[#f6ddb6]"
                      />
                      <button
                        disabled={busy}
                        onClick={() => void runAction('dev_restore_vital', { vital, amount: devRestore[vital] })}
                        className="rounded border border-[#684e2b] bg-[#3d2d18] px-1.5 py-0.5 text-[11px] text-[#f3cd8d] hover:bg-[#4a361e] disabled:opacity-60"
                      >
                        +{vital}
                      </button>
                    </div>
                  ))}
                  <button
                    disabled={busy}
                    onClick={() => void runAction('dev_add_oed')}
                    className="rounded border border-[#684e2b] bg-[#3d2d18] px-2 py-0.5 text-[11px] text-[#f3cd8d] hover:bg-[#4a361e] disabled:opacity-60"
                  >
                    +1 OED
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => void runAction('dev_reset_cooldowns')}
                    className="rounded border border-[#684e2b] bg-[#3d2d18] px-2 py-0.5 text-[11px] text-[#f3cd8d] hover:bg-[#4a361e] disabled:opacity-60"
                  >
                    Reset CDs
                  </button>
                </div>
              )}

              <div className="ml-auto grid min-w-[320px] grid-cols-2 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-4">
                {([
                  ['Life', state.resources.life, state.resources.maxLife, 'bg-rose-700'],
                  ['Stamina', state.resources.energy, state.resources.maxEnergy, 'bg-cyan-700'],
                  ['Instinct', state.resources.nerve, state.resources.maxNerve, 'bg-emerald-700'],
                  ['Morale', state.resources.happy, state.resources.maxHappy, 'bg-amber-600'],
                ] as Array<[string, number, number, string]>).map(([label, value, max, barColor]) => {
                  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
                  return (
                    <div key={label}>
                      <div className="mb-0.5 flex items-center justify-between text-[10px] text-[#c7d3e4]">
                        <span>{label}</span>
                        <span>{value}/{max}{label === 'Morale' && moraleOverMax ? ` (+${value - max})` : ''}</span>
                      </div>
                      <div className="relative h-4 overflow-hidden rounded border border-[#405169] bg-[#101720]">
                        <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
                      </div>
                      {label === 'Morale' && moraleOverMax && (
                        <p className="mt-0.5 text-[10px] text-[#f2d690]">Reset in {moraleResetTimer}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="mt-2 flex items-center gap-3 text-xs">
              <span
                title={state.gender === 'female' ? 'Female' : 'Male'}
                style={{ color: state.gender === 'female' ? '#f472b6' : '#60a5fa' }}
              >
                {state.gender === 'female' ? '♀' : '♂'}
              </span>
              {state.cooldowns.medicalSeconds > 0 && (
                <span title={`Medical: ${formatDuration(state.cooldowns.medicalSeconds)}`} style={{ color: iconHeat(state.cooldowns.medicalSeconds, state.cooldowns.medicalMaxSeconds) }}>
                  [M]
                </span>
              )}
              {state.cooldowns.boosterSeconds > 0 && (
                <span title={`Booster: ${formatDuration(state.cooldowns.boosterSeconds)}`} style={{ color: iconHeat(state.cooldowns.boosterSeconds, state.cooldowns.boosterMaxSeconds) }}>
                  [B]
                </span>
              )}
              {state.cooldowns.drugSeconds > 0 && (
                <span title={`Stimulant: ${formatDuration(state.cooldowns.drugSeconds)}`} style={{ color: iconHeat(state.cooldowns.drugSeconds, 21600) }}>
                  [S]
                </span>
              )}
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              {subNavBySection[section].map((label) => (
                <span key={label} className="rounded border border-[#334358] bg-[#1a2432] px-2 py-1 text-xs text-[#b8c7da]">{label}</span>
              ))}
            </div>
            <p className="mt-2 text-xs text-[#8aa0ba]">{loading ? 'Loading city state...' : notice}</p>
          </header>

          <div className="p-3 pb-24 sm:p-5 sm:pb-28">{renderContent()}</div>
        </main>
      </div>
    </div>
  );
};

export default VoxCity;

