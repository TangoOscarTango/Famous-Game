// TimeQuest App - Mobile-first web application
import React, { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { WalletProvider, useWallet } from '@/contexts/WalletContext';
import { supabase } from '@/lib/supabase';
import Sidebar from '@/components/Sidebar';
import AuthModal from '@/components/AuthModal';
import Dashboard from '@/components/Dashboard';
import RandomTiming from '@/components/RandomTiming';
import ZeldaGame from '@/components/ZeldaGame';
import Chat from '@/components/Chat';
import WalletHub from '@/components/WalletHub';
import VoxCity from '@/components/VoxCity';
import ChatDock from '@/components/ChatDock';

const GenderIcon: React.FC<{ gender: 'male' | 'female' }> = ({ gender }) => {
  const color = gender === 'female' ? '#f472b6' : '#60a5fa';
  return (
    <span title={gender === 'female' ? 'Female' : 'Male'} className="inline-flex h-4 w-4 items-center justify-center">
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="7" cy="7" r="3.5" />
        {gender === 'female' ? (
          <>
            <path d="M7 10.5v4" />
            <path d="M5 13h4" />
          </>
        ) : (
          <>
            <path d="M9.8 4.2L14 0" />
            <path d="M11.5 0H14v2.5" />
          </>
        )}
      </svg>
    </span>
  );
};

const AppContent: React.FC = () => {
  const { loading, user } = useAuth();
  const { balanceFp } = useWallet();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [globalStatus, setGlobalStatus] = useState<{
    gender: 'male' | 'female';
    cooldowns: { medicalSeconds: number; medicalMaxSeconds: number; boosterSeconds: number; boosterMaxSeconds: number; drugSeconds: number };
  }>({
    gender: 'male',
    cooldowns: { medicalSeconds: 0, medicalMaxSeconds: 21600, boosterSeconds: 0, boosterMaxSeconds: 86400, drugSeconds: 0 },
  });

  useEffect(() => {
    if (!user) return;
    const fetchStatus = async () => {
      const { data } = await supabase.rpc('vox_city_get_state', { p_user_id: user.id });
      if (!data) return;
      setGlobalStatus({
        gender: (data as any).gender ?? 'male',
        cooldowns: (data as any).cooldowns ?? { medicalSeconds: 0, medicalMaxSeconds: 21600, boosterSeconds: 0, boosterMaxSeconds: 86400, drugSeconds: 0 },
      });
    };
    void fetchStatus();
    const timer = window.setInterval(() => void fetchStatus(), 20000);
    return () => window.clearInterval(timer);
  }, [user?.id]);

  const fmt = (seconds: number) => {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  };
  const heat = (current: number, max: number) => {
    const p = Math.max(0, Math.min(1, current / Math.max(1, max)));
    const r = Math.round(64 + p * 191);
    const g = Math.round(205 - p * 150);
    return `rgb(${r},${g},90)`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-900 to-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-cyan-500 to-purple-600 flex items-center justify-center mx-auto mb-4 animate-pulse">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <p className="text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (currentPage === 'vox-city') {
    return (
      <>
        <VoxCity
          onBackToHub={() => setCurrentPage('dashboard')}
          onOpenAuth={() => setAuthModalOpen(true)}
        />
        <ChatDock />
        <AuthModal
          isOpen={authModalOpen}
          onClose={() => setAuthModalOpen(false)}
        />
      </>
    );
  }

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <Dashboard />;
      case 'random-timing':
        return <RandomTiming />;
      case 'the-game':
        return <ZeldaGame />;
      case 'chat':
        return <Chat />;
      case 'wallet':
        return <WalletHub />;
      case 'vox-city':
        return <VoxCity onBackToHub={() => setCurrentPage('dashboard')} onOpenAuth={() => setAuthModalOpen(true)} />;
      default:
        return <Dashboard />;
    }
  };

  const getPageTitle = () => {
    switch (currentPage) {
      case 'dashboard':
        return 'Dashboard';
      case 'random-timing':
        return 'Random Timing';
      case 'the-game':
        return 'The Game';
      case 'chat':
        return 'Chat';
      case 'wallet':
        return 'Wallet';
      case 'vox-city':
        return 'Vox City';
      default:
        return 'Dashboard';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-900 to-gray-950">
      {/* Sidebar */}
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        currentPage={currentPage}
        onNavigate={setCurrentPage}
        onOpenAuth={() => setAuthModalOpen(true)}
      />

      {/* Main Content */}
      <div className="lg:ml-72 min-h-screen">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 bg-gray-900/80 backdrop-blur-xl border-b border-gray-800/50">
          <div className="flex items-center justify-between px-4 sm:px-6 py-4">
            <div className="flex items-center gap-4">
              {/* Mobile Menu Button */}
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden p-2 text-gray-400 hover:text-white hover:bg-gray-800/50 rounded-lg transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              
              {/* Page Title */}
              <h1 className="text-lg font-semibold text-white">{getPageTitle()}</h1>
            </div>

            {/* Right side - can add notifications, etc */}
            <div className="flex items-center gap-2">
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-orange-500/10 border border-orange-500/30">
                <span className="text-xs text-orange-300 font-medium">{balanceFp.toLocaleString()} FP</span>
              </div>
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-800/50 border border-gray-700/50">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-xs text-gray-400">Online</span>
              </div>
            </div>
          </div>
          <div className="border-t border-gray-800/70 px-4 py-2 sm:px-6">
            <div className="flex items-center gap-3 text-xs">
              <GenderIcon gender={globalStatus.gender} />
              {globalStatus.cooldowns.medicalSeconds > 0 && (
                <span title={`Medical: ${fmt(globalStatus.cooldowns.medicalSeconds)}`} style={{ color: heat(globalStatus.cooldowns.medicalSeconds, globalStatus.cooldowns.medicalMaxSeconds) }}>
                  [M]
                </span>
              )}
              {globalStatus.cooldowns.boosterSeconds > 0 && (
                <span title={`Booster: ${fmt(globalStatus.cooldowns.boosterSeconds)}`} style={{ color: heat(globalStatus.cooldowns.boosterSeconds, globalStatus.cooldowns.boosterMaxSeconds) }}>
                  [B]
                </span>
              )}
              {globalStatus.cooldowns.drugSeconds > 0 && (
                <span title={`Stimulant: ${fmt(globalStatus.cooldowns.drugSeconds)}`} style={{ color: heat(globalStatus.cooldowns.drugSeconds, 21600) }}>
                  [S]
                </span>
              )}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="p-4 pb-24 sm:p-6 sm:pb-28">
          {renderPage()}
        </main>
      </div>

      {/* Auth Modal */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
      />
      <ChatDock />
    </div>
  );
};

const AppLayout: React.FC = () => {
  return (
    <AuthProvider>
      <WalletProvider>
        <AppContent />
      </WalletProvider>
    </AuthProvider>
  );
};

export default AppLayout;

