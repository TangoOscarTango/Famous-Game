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
  battle: BattleStats;
  resources: ResourceStats;
  scavengingSkill: number;
  collegeClasses: number;
  inventory: InventoryState;
  crimeLog: CrimeLogEntry[];
  isDev: boolean;
  activeGym: string;
  gyms: Array<{
    slug: string;
    displayName: string;
    sortOrder: number;
    costFp: number;
    energyPerTrain: 5 | 10 | 25 | 50;
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
  'pack-training-grounds',
  'warclaw-conditioning-center',
  'vixenvox-athletic-complex',
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
  resources: { energy: 100, maxEnergy: 100, nerve: 10, maxNerve: 10, happy: 100, maxHappy: 100, life: 100, maxLife: 100 },
  scavengingSkill: 1,
  collegeClasses: 0,
  inventory: { scrap: 0, components: 0, rareTech: 0 },
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

const gymTierBySlug: Record<string, GymTier> = {
  'scrap-yard-gym': 'lightweight',
  'rustfang-fitness': 'lightweight',
  'iron-den': 'lightweight',
  'pack-training-grounds': 'lightweight',
  'warclaw-conditioning-center': 'medium',
  'vixenvox-athletic-complex': 'medium',
  'apex-predator-facility': 'heavyweight',
  'fangforge': 'special',
  'ghoststep-arena': 'special',
  'shadow-reflex-lab': 'special',
  'ironhide-bastion': 'special',
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
  const unlockedGymSet = useMemo(() => new Set(state.gyms.filter((g) => g.unlocked).map((g) => g.slug)), [state.gyms]);
  const canPurchaseGym = (slug: string) => {
    if (unlockedGymSet.has(slug)) return false;
    if ((SPECIALIST_GYMS as readonly string[]).includes(slug)) {
      return unlockedGymSet.has('apex-predator-facility');
    }
    const idx = GENERAL_GYM_CHAIN.findIndex((gymSlug) => gymSlug === slug);
    if (idx <= 0) return true;
    return unlockedGymSet.has(GENERAL_GYM_CHAIN[idx - 1]);
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
        const tier = gymTierBySlug[gym.slug] ?? 'special';
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
              </div>
            )}
          </div>
        </div>
      );
    }

    if (section === 'academy') {
      return (
        <div className="rounded border border-[#2f3b4b] bg-[#121923] p-4 text-sm">
          <h2 className="mb-3 text-lg font-semibold text-[#eef2f8]">Academy</h2>
          <p>Classes completed: <span className="font-semibold">{state.collegeClasses}</span></p>
          <button disabled={busy} onClick={() => void runAction('class')} className="mt-3 rounded border border-[#3c4a5d] bg-[#1a2432] px-3 py-2 hover:bg-[#213046] disabled:opacity-60">Take Class (8 Stamina, 5 Morale)</button>
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
    <div className="min-h-screen bg-[#1a1f27] text-[#d6dde8]">
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
                </div>
              )}

              <div className="ml-auto flex flex-wrap gap-2 text-xs">
                <span className="rounded border border-[#4a3940] bg-[#2a1d22] px-2 py-1">Life {state.resources.life}/{state.resources.maxLife}</span>
                <span className="rounded border border-[#35506c] bg-[#1a2a3a] px-2 py-1">Stamina {state.resources.energy}/{state.resources.maxEnergy}</span>
                <span className="rounded border border-[#3f5c35] bg-[#1e3121] px-2 py-1">Instinct {state.resources.nerve}/{state.resources.maxNerve}</span>
                <span className="rounded border border-[#6a5a2f] bg-[#352d1b] px-2 py-1">Morale {state.resources.happy}/{state.resources.maxHappy}</span>
              </div>
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              {subNavBySection[section].map((label) => (
                <span key={label} className="rounded border border-[#334358] bg-[#1a2432] px-2 py-1 text-xs text-[#b8c7da]">{label}</span>
              ))}
            </div>
            <p className="mt-2 text-xs text-[#8aa0ba]">{loading ? 'Loading city state...' : notice}</p>
          </header>

          <div className="p-3 sm:p-5">{renderContent()}</div>
        </main>
      </div>
    </div>
  );
};

export default VoxCity;

