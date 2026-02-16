import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

interface GeneratedTime {
  id: string;
  generated_time: string;
  created_at: string;
}

const RandomTiming: React.FC = () => {
  const { user, updateUserStats } = useAuth();
  const [generatedTime, setGeneratedTime] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState<string>('');
  const [history, setHistory] = useState<GeneratedTime[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (user) {
      fetchHistory();
    }
  }, [user]);

  useEffect(() => {
    if (!generatedTime) return;

    const interval = setInterval(() => {
      const now = new Date();
      const diff = generatedTime.getTime() - now.getTime();

      if (diff <= 0) {
        setCountdown('Time has arrived!');
        clearInterval(interval);
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setCountdown(`${hours}h ${minutes}m ${seconds}s`);
    }, 1000);

    return () => clearInterval(interval);
  }, [generatedTime]);

  const fetchHistory = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('random_times')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      if (data) setHistory(data);
    } catch (error) {
      console.error('Error fetching history:', error);
    }
  };

  const generateRandomTime = async () => {
    setIsGenerating(true);

    // Generate random hours between 48 and 100
    const minHours = 48;
    const maxHours = 100;
    const randomHours = Math.random() * (maxHours - minHours) + minHours;
    const randomMinutes = Math.floor(Math.random() * 60);
    const randomSeconds = Math.floor(Math.random() * 60);

    const futureTime = new Date();
    futureTime.setHours(futureTime.getHours() + Math.floor(randomHours));
    futureTime.setMinutes(futureTime.getMinutes() + randomMinutes);
    futureTime.setSeconds(futureTime.getSeconds() + randomSeconds);

    setGeneratedTime(futureTime);

    // Save to database if user is logged in
    if (user) {
      try {
        const { error } = await supabase
          .from('random_times')
          .insert({
            user_id: user.id,
            generated_time: futureTime.toISOString(),
          });

        if (error) throw error;

        // Update user stats
        await updateUserStats({ timesGenerated: (user.timesGenerated || 0) + 1 });

        // Refresh history
        fetchHistory();
      } catch (error) {
        console.error('Error saving time:', error);
      }
    }

    setTimeout(() => setIsGenerating(false), 500);
  };

  const copyToClipboard = () => {
    if (!generatedTime) return;

    const formattedTime = generatedTime.toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    navigator.clipboard.writeText(formattedTime);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-orange-500/10 via-red-500/10 to-pink-500/10 border border-orange-500/20 p-6 sm:p-8">
        <div className="absolute -top-20 -right-20 w-40 h-40 bg-orange-500/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-red-500/20 rounded-full blur-3xl" />
        
        <div className="relative">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-orange-500/20">
              <svg className="w-6 h-6 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white">Random Timing</h1>
          </div>
          <p className="text-gray-400">Generate a completely random date and time 48-100 hours in the future.</p>
        </div>
      </div>

      {/* Generator Card */}
      <div className="rounded-2xl bg-gray-800/50 border border-gray-700/50 overflow-hidden">
        <div className="p-6 sm:p-8 text-center">
          {generatedTime ? (
            <div className="space-y-6">
              {/* Generated Time Display */}
              <div className="space-y-2">
                <p className="text-sm text-gray-400 uppercase tracking-wider">Your Random Time</p>
                <div className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-orange-400 via-red-400 to-pink-400 bg-clip-text text-transparent">
                  {generatedTime.toLocaleDateString('en-US', {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                  })}
                </div>
                <div className="text-2xl sm:text-3xl font-mono text-white">
                  {generatedTime.toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </div>
              </div>

              {/* Countdown */}
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gray-700/50 border border-gray-600/50">
                <svg className="w-4 h-4 text-cyan-400 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm font-mono text-white">{countdown}</span>
              </div>

              {/* Copy Button */}
              <button
                onClick={copyToClipboard}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-gray-700/50 rounded-lg transition-colors"
              >
                {copied ? (
                  <>
                    <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Copied!
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy to Clipboard
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="py-8">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-orange-500/20 to-red-500/20 flex items-center justify-center mx-auto mb-4">
                <svg className="w-10 h-10 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-gray-400 mb-2">No time generated yet</p>
              <p className="text-sm text-gray-500">Click the button below to generate a random future time</p>
            </div>
          )}
        </div>

        {/* Generate Button */}
        <div className="p-6 border-t border-gray-700/50 bg-gray-900/30">
          <button
            onClick={generateRandomTime}
            disabled={isGenerating}
            className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-400 hover:to-red-400 text-white font-semibold rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isGenerating ? (
              <>
                <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Generating...
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Generate Random Time
              </>
            )}
          </button>
        </div>
      </div>

      {/* History */}
      {user && (
        <div className="rounded-xl bg-gray-800/50 border border-gray-700/50 overflow-hidden">
          <div className="p-5 border-b border-gray-700/50 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">History</h2>
            <span className="text-sm text-gray-500">Last 10 generations</span>
          </div>
          <div className="divide-y divide-gray-700/50">
            {history.length > 0 ? (
              history.map((item, index) => (
                <div key={item.id} className="p-4 hover:bg-gray-700/20 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-500/20 to-red-500/20 flex items-center justify-center text-orange-400 text-sm font-bold">
                        {index + 1}
                      </div>
                      <div>
                        <p className="font-medium text-white">
                          {new Date(item.generated_time).toLocaleDateString('en-US', {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </p>
                        <p className="text-sm text-gray-400">
                          {new Date(item.generated_time).toLocaleTimeString('en-US', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs text-gray-500">
                      Generated {formatDate(item.created_at)}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-8 text-center">
                <p className="text-gray-500 text-sm">No history yet</p>
                <p className="text-gray-600 text-xs mt-1">Generate some times to see them here</p>
              </div>
            )}
          </div>
        </div>
      )}

      {!user && (
        <div className="rounded-xl bg-gray-800/30 border border-gray-700/30 p-6 text-center">
          <p className="text-gray-400 text-sm">Sign in to save your generated times and view history</p>
        </div>
      )}
    </div>
  );
};

export default RandomTiming;
