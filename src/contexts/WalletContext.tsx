import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { CashuMint, CashuWallet, getDecodedToken, getEncodedTokenV4, type Proof } from '@cashu/cashu-ts';
import QRCode from 'qrcode';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

type LedgerDirection = 'credit' | 'debit';
type LedgerStatus = 'confirmed' | 'pending_verification';

export interface WalletLedgerEntry {
  id: string;
  direction: LedgerDirection;
  amountSats: number;
  source: 'cashu_token' | 'cashu_withdrawal' | 'game_action';
  note: string;
  status: LedgerStatus;
  createdAt: string;
}

export interface WithdrawalArtifact {
  token: string;
  qrCodeDataUrl: string;
  amountSats: number;
  mintUrl: string;
  createdAt: string;
}

interface WalletContextType {
  loading: boolean;
  walletAlias: string | null;
  isWalletConnected: boolean;
  balanceSats: number;
  balanceFp: number;
  ledger: WalletLedgerEntry[];
  lastWithdrawal: WithdrawalArtifact | null;
  connectWallet: (alias: string) => Promise<{ success: boolean; message: string }>;
  disconnectWallet: () => Promise<void>;
  redeemCashuToken: (token: string, note?: string) => Promise<{ success: boolean; message: string }>;
  spendFp: (
    amountFp: number,
    note: string,
  ) => Promise<{ success: boolean; message: string; artifact?: WithdrawalArtifact }>;
  clearLastWithdrawal: () => void;
}

interface StoredWalletState {
  walletAlias: string | null;
  balanceSats: number;
  ledger: WalletLedgerEntry[];
  proofsByMint: Record<string, Proof[]>;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

const STORAGE_PREFIX = 'famous_wallet_state';
const MAX_LEDGER_ENTRIES = 100;

const toStorageKey = (userId: string) => `${STORAGE_PREFIX}:${userId}`;

const getTrustedMintList = (): string[] =>
  (import.meta.env.VITE_CASHU_TRUSTED_MINTS || '')
    .split(',')
    .map((value: string) => value.trim())
    .filter(Boolean);

const normalizeCashuToken = (token: string): string => token.trim().replace(/^cashu:/i, '');

const sumProofs = (proofs: Proof[]): number => proofs.reduce((sum, proof) => sum + (proof.amount || 0), 0);

const sumProofMap = (proofMap: Record<string, Proof[]>): number =>
  Object.values(proofMap).reduce((sum, mintProofs) => sum + sumProofs(mintProofs), 0);

const safeParse = (value: string | null): StoredWalletState | null => {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value);
    if (typeof parsed.balanceSats !== 'number' || !Array.isArray(parsed.ledger)) return null;
    return {
      walletAlias: typeof parsed.walletAlias === 'string' ? parsed.walletAlias : null,
      balanceSats: parsed.balanceSats,
      ledger: parsed.ledger,
      proofsByMint: typeof parsed.proofsByMint === 'object' && parsed.proofsByMint ? parsed.proofsByMint : {},
    };
  } catch {
    return null;
  }
};

const isMintAllowed = (mintUrl: string): boolean => {
  const trusted = getTrustedMintList();
  if (trusted.length === 0) return true;
  return trusted.includes(mintUrl);
};

const assertUnspentProofs = async (wallet: CashuWallet, proofs: Proof[]) => {
  const states = await wallet.checkProofsStates(proofs);
  const hasBadState = states.some((state) => state.state !== 'UNSPENT');
  if (hasBadState) {
    throw new Error('Mint rejected one or more proofs as spent or invalid.');
  }
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
  const [proofsByMint, setProofsByMint] = useState<Record<string, Proof[]>>({});
  const [lastWithdrawal, setLastWithdrawal] = useState<WithdrawalArtifact | null>(null);

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
    setProofsByMint(nextState.proofsByMint);

    persistLocal(nextState);
    try {
      await persistRemote(nextState);
    } catch {
      // Wallet tables may not be provisioned yet; keep local state authoritative.
    }
  }, [persistLocal, persistRemote]);

  const appendLedgerEntry = useCallback(async (entry: WalletLedgerEntry, nextState: StoredWalletState) => {
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
      // Local ledger is still persisted.
    }

    await updateState({
      ...nextState,
      ledger: [entry, ...nextState.ledger].slice(0, MAX_LEDGER_ENTRIES),
    });
  }, [updateState, user]);

  useEffect(() => {
    const load = async () => {
      if (!user) {
        setWalletAlias(null);
        setBalanceSats(0);
        setLedger([]);
        setProofsByMint({});
        setLastWithdrawal(null);
        setLoading(false);
        return;
      }

      setLoading(true);

      const local = safeParse(localStorage.getItem(toStorageKey(user.id)));
      if (local) {
        setWalletAlias(local.walletAlias);
        setBalanceSats(local.balanceSats);
        setLedger(local.ledger);
        setProofsByMint(local.proofsByMint);
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
          const mergedState: StoredWalletState = {
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
            proofsByMint: local?.proofsByMint ?? {},
          };

          setWalletAlias(mergedState.walletAlias);
          setBalanceSats(mergedState.balanceSats);
          setLedger(mergedState.ledger);
          setProofsByMint(mergedState.proofsByMint);
          persistLocal(mergedState);
        }
      } catch {
        // Remote wallet state is optional during bootstrap.
      } finally {
        setLoading(false);
      }
    };

    void load();
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
      proofsByMint,
    };
    await updateState(nextState);
    return { success: true, message: `${trimmedAlias} connected.` };
  }, [balanceSats, ledger, proofsByMint, updateState]);

  const disconnectWallet = useCallback(async () => {
    const nextState: StoredWalletState = {
      walletAlias: null,
      balanceSats,
      ledger,
      proofsByMint,
    };
    await updateState(nextState);
  }, [balanceSats, ledger, proofsByMint, updateState]);

  const redeemCashuToken = useCallback(async (token: string, note = '') => {
    if (!user) {
      return { success: false, message: 'Sign in before redeeming tokens.' };
    }

    try {
      const normalizedToken = normalizeCashuToken(token);
      const decoded = getDecodedToken(normalizedToken);

      if (!decoded?.mint) {
        throw new Error('Token does not contain a mint URL.');
      }

      if (!isMintAllowed(decoded.mint)) {
        throw new Error('This mint is not in your trusted mint list.');
      }

      const mint = new CashuMint(decoded.mint);
      const cashuWallet = new CashuWallet(mint, { unit: 'sat' });
      await cashuWallet.loadMint();

      // This round-trips against the mint and reissues proofs to this wallet.
      const receivedProofs = await cashuWallet.receive(normalizedToken, { requireDleq: true });
      await assertUnspentProofs(cashuWallet, receivedProofs);

      const creditedSats = sumProofs(receivedProofs);
      if (creditedSats <= 0) {
        throw new Error('Mint returned zero-value proofs.');
      }

      const nextProofsByMint = {
        ...proofsByMint,
        [decoded.mint]: [...(proofsByMint[decoded.mint] ?? []), ...receivedProofs],
      };

      const nextState: StoredWalletState = {
        walletAlias,
        proofsByMint: nextProofsByMint,
        balanceSats: sumProofMap(nextProofsByMint),
        ledger,
      };

      const entry: WalletLedgerEntry = {
        id: crypto.randomUUID(),
        direction: 'credit',
        amountSats: creditedSats,
        source: 'cashu_token',
        note: note.trim() || `Redeem from ${decoded.mint}`,
        status: 'confirmed',
        createdAt: new Date().toISOString(),
      };

      await appendLedgerEntry(entry, nextState);
      return { success: true, message: `Redeemed ${creditedSats} FP (mint-confirmed).` };
    } catch (error: any) {
      return { success: false, message: error?.message || 'Unable to redeem token.' };
    }
  }, [appendLedgerEntry, ledger, proofsByMint, user, walletAlias]);

  const spendFp = useCallback(async (amountFp: number, note: string) => {
    if (!user) {
      return { success: false, message: 'Sign in before withdrawing FP.' };
    }

    if (!Number.isFinite(amountFp) || amountFp <= 0) {
      return { success: false, message: 'Enter a valid FP amount.' };
    }

    const amountSats = Math.floor(amountFp);
    if (amountSats > balanceSats) {
      return { success: false, message: 'Insufficient FP balance.' };
    }

    const mintCandidate = Object.entries(proofsByMint).find(([, mintProofs]) => sumProofs(mintProofs) >= amountSats);
    if (!mintCandidate) {
      return { success: false, message: 'No single mint balance can cover this withdrawal yet.' };
    }

    const [mintUrl, mintProofs] = mintCandidate;

    try {
      const mint = new CashuMint(mintUrl);
      const cashuWallet = new CashuWallet(mint, { unit: 'sat' });
      await cashuWallet.loadMint();

      const { keep, send } = await cashuWallet.send(amountSats, mintProofs);
      await assertUnspentProofs(cashuWallet, keep);
      await assertUnspentProofs(cashuWallet, send);

      const withdrawToken = getEncodedTokenV4({ mint: mintUrl, proofs: send });
      const qrCodeDataUrl = await QRCode.toDataURL(withdrawToken, { margin: 1, width: 360 });

      const nextProofsByMint = {
        ...proofsByMint,
        [mintUrl]: keep,
      };

      const nextState: StoredWalletState = {
        walletAlias,
        proofsByMint: nextProofsByMint,
        balanceSats: sumProofMap(nextProofsByMint),
        ledger,
      };

      const entry: WalletLedgerEntry = {
        id: crypto.randomUUID(),
        direction: 'debit',
        amountSats,
        source: 'cashu_withdrawal',
        note: note.trim() || `Withdraw to token from ${mintUrl}`,
        status: 'confirmed',
        createdAt: new Date().toISOString(),
      };

      const artifact: WithdrawalArtifact = {
        token: withdrawToken,
        qrCodeDataUrl,
        amountSats,
        mintUrl,
        createdAt: new Date().toISOString(),
      };

      setLastWithdrawal(artifact);
      await appendLedgerEntry(entry, nextState);
      return { success: true, message: `Created ${amountSats} FP withdrawal token.`, artifact };
    } catch (error: any) {
      return { success: false, message: error?.message || 'Unable to create withdrawal token.' };
    }
  }, [appendLedgerEntry, balanceSats, ledger, proofsByMint, user, walletAlias]);

  const clearLastWithdrawal = useCallback(() => {
    setLastWithdrawal(null);
  }, []);

  const value = useMemo<WalletContextType>(() => ({
    loading,
    walletAlias,
    isWalletConnected: Boolean(walletAlias),
    balanceSats,
    balanceFp: balanceSats,
    ledger,
    lastWithdrawal,
    connectWallet,
    disconnectWallet,
    redeemCashuToken,
    spendFp,
    clearLastWithdrawal,
  }), [
    balanceSats,
    clearLastWithdrawal,
    connectWallet,
    disconnectWallet,
    ledger,
    loading,
    lastWithdrawal,
    redeemCashuToken,
    spendFp,
    walletAlias,
  ]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
};
