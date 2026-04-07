import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
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

interface WalletStateResponse {
  walletAlias: string | null;
  balanceSats: number;
  ledger: WalletLedgerEntry[];
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

const normalizeCashuToken = (token: string): string => token.trim().replace(/^cashu:/i, '');

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
  const [lastWithdrawal, setLastWithdrawal] = useState<WithdrawalArtifact | null>(null);

  const applyServerState = useCallback((state: WalletStateResponse) => {
    setWalletAlias(state.walletAlias ?? null);
    setBalanceSats(state.balanceSats ?? 0);
    setLedger(Array.isArray(state.ledger) ? state.ledger : []);
  }, []);

  const fetchWalletState = useCallback(async () => {
    if (!user) {
      setWalletAlias(null);
      setBalanceSats(0);
      setLedger([]);
      setLastWithdrawal(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('wallet-balance', {
        body: { ledgerLimit: 100 },
      });

      if (error) throw error;
      applyServerState(data?.state ?? { walletAlias: null, balanceSats: 0, ledger: [] });
    } catch (error) {
      console.error('Error fetching wallet state:', error);
    } finally {
      setLoading(false);
    }
  }, [applyServerState, user]);

  useEffect(() => {
    void fetchWalletState();
  }, [fetchWalletState]);

  const connectWallet = useCallback(async (alias: string) => {
    const trimmedAlias = alias.trim();
    if (!trimmedAlias) {
      return { success: false, message: 'Wallet name is required.' };
    }

    try {
      const { data, error } = await supabase.functions.invoke('wallet-alias', {
        body: { alias: trimmedAlias },
      });
      if (error) throw error;

      applyServerState(data?.state ?? { walletAlias: trimmedAlias, balanceSats, ledger });
      return { success: true, message: `${trimmedAlias} connected.` };
    } catch (error: any) {
      return { success: false, message: error?.message || 'Failed to update wallet label.' };
    }
  }, [applyServerState, balanceSats, ledger]);

  const disconnectWallet = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke('wallet-alias', {
        body: { alias: null },
      });
      if (error) throw error;
      applyServerState(data?.state ?? { walletAlias: null, balanceSats, ledger });
    } catch (error) {
      console.error('Error clearing wallet label:', error);
    }
  }, [applyServerState, balanceSats, ledger]);

  const redeemCashuToken = useCallback(async (token: string, note = '') => {
    if (!user) {
      return { success: false, message: 'Sign in before redeeming tokens.' };
    }

    try {
      const requestId = crypto.randomUUID();
      const { data, error } = await supabase.functions.invoke('wallet-redeem', {
        body: {
          requestId,
          token: normalizeCashuToken(token),
          note,
        },
      });

      if (error) throw error;
      applyServerState(data?.state ?? { walletAlias, balanceSats, ledger });
      return { success: true, message: data?.message ?? 'Redeem successful.' };
    } catch (error: any) {
      return { success: false, message: error?.message || 'Unable to redeem token.' };
    }
  }, [applyServerState, balanceSats, ledger, user, walletAlias]);

  const spendFp = useCallback(async (amountFp: number, note: string) => {
    if (!user) {
      return { success: false, message: 'Sign in before withdrawing FP.' };
    }

    if (!Number.isFinite(amountFp) || amountFp <= 0) {
      return { success: false, message: 'Enter a valid FP amount.' };
    }

    const amountSats = Math.floor(amountFp);

    try {
      const requestId = crypto.randomUUID();
      const { data, error } = await supabase.functions.invoke('wallet-withdraw', {
        body: {
          requestId,
          amountSats,
          note,
        },
      });

      if (error) throw error;

      const token = data?.token as string;
      const mintUrl = data?.mintUrl as string;
      const qrCodeDataUrl = await QRCode.toDataURL(token, { margin: 1, width: 360 });

      const artifact: WithdrawalArtifact = {
        token,
        qrCodeDataUrl,
        amountSats,
        mintUrl,
        createdAt: new Date().toISOString(),
      };

      setLastWithdrawal(artifact);
      applyServerState(data?.state ?? { walletAlias, balanceSats, ledger });
      return { success: true, message: data?.message ?? 'Withdrawal token created.', artifact };
    } catch (error: any) {
      return { success: false, message: error?.message || 'Unable to create withdrawal token.' };
    }
  }, [applyServerState, balanceSats, ledger, user, walletAlias]);

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
