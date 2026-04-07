import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useWallet } from '@/contexts/WalletContext';

const WalletHub: React.FC = () => {
  const { user } = useAuth();
  const {
    loading,
    walletAlias,
    isWalletConnected,
    balanceFp,
    ledger,
    connectWallet,
    disconnectWallet,
    redeemCashuToken,
    spendFp,
  } = useWallet();

  const [aliasInput, setAliasInput] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [tokenNote, setTokenNote] = useState('');
  const [spendAmount, setSpendAmount] = useState('');
  const [spendNote, setSpendNote] = useState('');
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  if (!user) {
    return (
      <div className="rounded-xl bg-gray-800/50 border border-gray-700/50 p-6">
        <h2 className="text-xl font-semibold text-white mb-2">Wallet</h2>
        <p className="text-gray-400 text-sm">Sign in with a magic link to use Foxy Pesos (FP).</p>
      </div>
    );
  }

  const showResult = (success: boolean, text: string) => {
    setMessage({ kind: success ? 'success' : 'error', text });
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await connectWallet(aliasInput);
    showResult(result.success, result.message);
    if (result.success) setAliasInput('');
  };

  const handleRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await redeemCashuToken(tokenInput, tokenNote);
    showResult(result.success, result.message);
    if (result.success) {
      setTokenInput('');
      setTokenNote('');
    }
  };

  const handleSpend = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(spendAmount);
    const result = await spendFp(amount, spendNote);
    showResult(result.success, result.message);
    if (result.success) {
      setSpendAmount('');
      setSpendNote('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-gradient-to-br from-orange-500/10 to-yellow-500/10 border border-orange-500/30 p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-orange-300 text-sm">Balance</p>
            <h2 className="text-3xl font-bold text-white">{balanceFp.toLocaleString()} FP</h2>
            <p className="text-xs text-orange-200/80 mt-1">1 FP = 1 satoshi</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400 mb-1">Wallet</p>
            <p className="text-sm text-white">{walletAlias ?? 'Not connected'}</p>
          </div>
        </div>
      </div>

      {message && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            message.kind === 'success'
              ? 'border-green-500/30 bg-green-500/10 text-green-300'
              : 'border-red-500/30 bg-red-500/10 text-red-300'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl bg-gray-800/50 border border-gray-700/50 p-5">
          <h3 className="text-white font-semibold mb-4">Connect Wallet Label</h3>
          <form onSubmit={handleConnect} className="space-y-3">
            <input
              value={aliasInput}
              onChange={(e) => setAliasInput(e.target.value)}
              placeholder="e.g. My Cashu Wallet"
              className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm transition-colors disabled:opacity-50"
              >
                Save
              </button>
              {isWalletConnected && (
                <button
                  type="button"
                  onClick={() => void disconnectWallet()}
                  className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm transition-colors"
                >
                  Disconnect
                </button>
              )}
            </div>
          </form>
        </div>

        <div className="rounded-xl bg-gray-800/50 border border-gray-700/50 p-5">
          <h3 className="text-white font-semibold mb-4">Redeem Cashu Token</h3>
          <form onSubmit={handleRedeem} className="space-y-3">
            <textarea
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="Paste token starting with cashuA or cashuB..."
              rows={4}
              className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
            <input
              value={tokenNote}
              onChange={(e) => setTokenNote(e.target.value)}
              placeholder="Optional note"
              className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
            <button
              type="submit"
              disabled={loading || !tokenInput.trim()}
              className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm transition-colors disabled:opacity-50"
            >
              Redeem
            </button>
          </form>
        </div>
      </div>

      <div className="rounded-xl bg-gray-800/50 border border-gray-700/50 p-5">
        <h3 className="text-white font-semibold mb-4">Spend FP</h3>
        <form onSubmit={handleSpend} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input
            value={spendAmount}
            onChange={(e) => setSpendAmount(e.target.value)}
            placeholder="Amount FP"
            inputMode="numeric"
            className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
          <input
            value={spendNote}
            onChange={(e) => setSpendNote(e.target.value)}
            placeholder="Action note"
            className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-sm transition-colors disabled:opacity-50"
          >
            Spend
          </button>
        </form>
      </div>

      <div className="rounded-xl bg-gray-800/50 border border-gray-700/50 overflow-hidden">
        <div className="p-4 border-b border-gray-700/50">
          <h3 className="text-white font-semibold">Wallet Ledger</h3>
          <p className="text-xs text-gray-400 mt-1">Cashu redeems are marked pending until mint verification is added server-side.</p>
        </div>
        <div className="divide-y divide-gray-700/50">
          {ledger.length === 0 && (
            <div className="p-6 text-sm text-gray-400">No wallet entries yet.</div>
          )}
          {ledger.map((entry) => (
            <div key={entry.id} className="p-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm text-white">{entry.note || entry.source}</p>
                <p className="text-xs text-gray-500">
                  {new Date(entry.createdAt).toLocaleString()} - {entry.status}
                </p>
              </div>
              <div className={`text-sm font-semibold ${entry.direction === 'credit' ? 'text-green-400' : 'text-orange-400'}`}>
                {entry.direction === 'credit' ? '+' : '-'}{entry.amountSats.toLocaleString()} FP
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default WalletHub;
