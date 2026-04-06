import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

type LedgerDirection = 'credit' | 'debit';
type LedgerStatus = 'confirmed' | 'pending_verification';

export interface WalletLedgerEntry {
  id: string;
  direction: LedgerDirection;
  amountSats: number;
  source: 'cashu_token' | 'game_action';
  note: string;
  status: LedgerStatus;
  createdAt: string;
}

interface WalletContextType {
  loading: boolean;
  walletAlias: string | null;
  isWalletConnected: boolean;
  balanceSats: number;
  balanceFp: number;
  ledger: WalletLedgerEntry[];
  connectWallet: (alias: string) => Promise<{ success: boolean; message: string }>;
  disconnectWallet: () => Promise<void>;
  redeemCashuToken: (token: string, note?: string) => Promise<{ success: boolean; message: string }>;
  spendFp: (amountFp: number, note: string) => Promise<{ success: boolean; message: string }>;
}

interface StoredWalletState {
  walletAlias: string | null;
  balanceSats: number;
  ledger: WalletLedgerEntry[];
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

const STORAGE_PREFIX = 'famous_wallet_state';
const MAX_LEDGER_ENTRIES = 100;

const toStorageKey = (userId: string) => `${STORAGE_PREFIX}:${userId}`;

const safeParse = (value: string | null): StoredWalletState | null => {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value);
    if (typeof parsed.balanceSats !== 'number' || !Array.isArray(parsed.ledger)) return null;
    return {
      walletAlias: typeof parsed.walletAlias === 'string' ? parsed.walletAlias : null,
      balanceSats: parsed.balanceSats,
      ledger: parsed.ledger,
    };
  } catch {
    return null;
  }
};

const parseCashuTokenAmount = (token: string): number => {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error('Token is required');
  }

  if (!trimmed.startsWith('cashuA')) {
    throw new Error('Unsupported token format. Expected a token beginning with cashuA.');
  }

  const payload = trimmed.slice('cashuA'.length);
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const decoded = atob(padded);
  const parsed = JSON.parse(decoded);

  const readProofAmounts = (proofs: any[]): number =>
    proofs.reduce((sum, proof) => sum + (typeof proof?.amount === 'number' ? proof.amount : 0), 0);

  if (Array.isArray(parsed?.proofs)) {
    return readProofAmounts(parsed.proofs);
  }

  if (Array.isArray(parsed?.token)) {
    return parsed.token.reduce((sum: number, group: any) => {
      if (!Array.isArray(group?.proofs)) return sum;
      return sum + readProofAmounts(group.proofs);
    }, 0);
  }

  throw new Error('Unable to parse token proofs.');
};

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
};

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [walletAlias, setWalletAlias] = useState<string | null>(null);
  const [balanceSats, setBalanceSats] = useState(0);
  const [ledger, setLedger] = useState<WalletLedgerEntry[]>([]);

  const persistLocal = useCallback((nextState: StoredWalletState) => {
    if (!user) return;
    localStorage.setItem(toStorageKey(user.id), JSON.stringify(nextState));
  }, [user]);

  const persistRemote = useCallback(async (nextState: StoredWalletState) => {
    if (!user) return;

    await supabase
      .from('wallet_profiles')
      .upsert(
        {
          user_id: user.id,
          wallet_alias: nextState.walletAlias,
          balance_sats: nextState.balanceSats,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );
  }, [user]);

  const updateState = useCallback(async (nextState: StoredWalletState) => {
    setWalletAlias(nextState.walletAlias);
    setBalanceSats(nextState.balanceSats);
    setLedger(nextState.ledger);

    persistLocal(nextState);
    try {
      await persistRemote(nextState);
    } catch {
      // Wallet tables may not be provisioned yet; keep local state authoritative.
    }
  }, [persistLocal, persistRemote]);

  const appendLedgerEntry = useCallback(async (entry: WalletLedgerEntry, nextBalanceSats: number) => {
    const nextState: StoredWalletState = {
      walletAlias,
      balanceSats: nextBalanceSats,
      ledger: [entry, ...ledger].slice(0, MAX_LEDGER_ENTRIES),
    };

    try {
      if (user) {
        await supabase.from('wallet_ledger').insert({
          id: entry.id,
          user_id: user.id,
          direction: entry.direction,
          amount_sats: entry.amountSats,
          source: entry.source,
          note: entry.note,
          status: entry.status,
          created_at: entry.createdAt,
        });
      }
    } catch {
      // Safe fallback: local ledger persists even if table missing.
    }

    await updateState(nextState);
  }, [ledger, updateState, user, walletAlias]);

  useEffect(() => {
    const load = async () => {
      if (!user) {
        setWalletAlias(null);
        setBalanceSats(0);
        setLedger([]);
        setLoading(false);
        return;
      }

      setLoading(true);

      const local = safeParse(localStorage.getItem(toStorageKey(user.id)));
      if (local) {
        setWalletAlias(local.walletAlias);
        setBalanceSats(local.balanceSats);
        setLedger(local.ledger);
      }

      try {
        const { data: profile } = await supabase
          .from('wallet_profiles')
          .select('wallet_alias,balance_sats')
          .eq('user_id', user.id)
          .single();

        const { data: remoteLedger } = await supabase
          .from('wallet_ledger')
          .select('id,direction,amount_sats,source,note,status,created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(MAX_LEDGER_ENTRIES);

        if (profile || remoteLedger) {
          const nextState: StoredWalletState = {
            walletAlias: profile?.wallet_alias ?? local?.walletAlias ?? null,
            balanceSats: profile?.balance_sats ?? local?.balanceSats ?? 0,
            ledger: (remoteLedger ?? []).map((item: any) => ({
              id: item.id,
              direction: item.direction,
              amountSats: item.amount_sats,
              source: item.source,
              note: item.note ?? '',
              status: item.status ?? 'pending_verification',
              createdAt: item.created_at,
            })),
          };
          setWalletAlias(nextState.walletAlias);
          setBalanceSats(nextState.balanceSats);
          setLedger(nextState.ledger);
          persistLocal(nextState);
        }
      } catch {
        // Remote wallet state is optional during bootstrap.
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [persistLocal, user]);

  const connectWallet = useCallback(async (alias: string) => {
    const trimmedAlias = alias.trim();
    if (!trimmedAlias) {
      return { success: false, message: 'Wallet name is required.' };
    }

    const nextState: StoredWalletState = {
      walletAlias: trimmedAlias,
      balanceSats,
      ledger,
    };
    await updateState(nextState);
    return { success: true, message: `${trimmedAlias} connected.` };
  }, [balanceSats, ledger, updateState]);

  const disconnectWallet = useCallback(async () => {
    const nextState: StoredWalletState = {
      walletAlias: null,
      balanceSats,
      ledger,
    };
    await updateState(nextState);
  }, [balanceSats, ledger, updateState]);

  const redeemCashuToken = useCallback(async (token: string, note = '') => {
    if (!user) {
      return { success: false, message: 'Sign in before redeeming tokens.' };
    }

    try {
      const amountSats = parseCashuTokenAmount(token);
      if (amountSats <= 0) {
        throw new Error('Token amount must be greater than zero.');
      }

      const entry: WalletLedgerEntry = {
        id: crypto.randomUUID(),
        direction: 'credit',
        amountSats,
        source: 'cashu_token',
        note: note.trim() || 'Cashu token redeem',
        status: 'pending_verification',
        createdAt: new Date().toISOString(),
      };

      await appendLedgerEntry(entry, balanceSats + amountSats);
      return { success: true, message: `Redeemed ${amountSats} FP.` };
    } catch (error: any) {
      return { success: false, message: error?.message || 'Unable to redeem token.' };
    }
  }, [appendLedgerEntry, balanceSats, user]);

  const spendFp = useCallback(async (amountFp: number, note: string) => {
    if (!user) {
      return { success: false, message: 'Sign in before spending FP.' };
    }

    if (!Number.isFinite(amountFp) || amountFp <= 0) {
      return { success: false, message: 'Enter a valid FP amount.' };
    }

    const amountSats = Math.floor(amountFp);
    if (amountSats > balanceSats) {
      return { success: false, message: 'Insufficient FP balance.' };
    }

    const entry: WalletLedgerEntry = {
      id: crypto.randomUUID(),
      direction: 'debit',
      amountSats,
      source: 'game_action',
      note: note.trim() || 'In-game spend',
      status: 'confirmed',
      createdAt: new Date().toISOString(),
    };

    await appendLedgerEntry(entry, balanceSats - amountSats);
    return { success: true, message: `${amountSats} FP spent.` };
  }, [appendLedgerEntry, balanceSats, user]);

  const value = useMemo<WalletContextType>(() => ({
    loading,
    walletAlias,
    isWalletConnected: Boolean(walletAlias),
    balanceSats,
    balanceFp: balanceSats,
    ledger,
    connectWallet,
    disconnectWallet,
    redeemCashuToken,
    spendFp,
  }), [balanceSats, connectWallet, disconnectWallet, ledger, loading, redeemCashuToken, spendFp, walletAlias]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
};
