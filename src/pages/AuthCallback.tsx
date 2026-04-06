import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';

const AuthCallback: React.FC = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState('Completing sign-in...');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const completeSignIn = async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const authCode = params.get('code');
        const authError = params.get('error_description') || params.get('error');

        if (authError) {
          throw new Error(authError);
        }

        if (authCode) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(authCode);
          if (exchangeError) {
            throw exchangeError;
          }
        }

        setStatus('Sign-in complete. Redirecting...');
        navigate('/', { replace: true });
      } catch (err: any) {
        setError(err?.message || 'Unable to complete sign-in');
      }
    };

    completeSignIn();
  }, [navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-900 to-gray-950 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-gray-700/50 bg-gray-900/80 backdrop-blur-xl p-6 text-center">
        <h1 className="text-xl font-semibold text-white mb-3">Account Sign-In</h1>
        {error ? (
          <>
            <p className="text-sm text-red-400 mb-4">{error}</p>
            <button
              onClick={() => navigate('/', { replace: true })}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-white transition-colors"
            >
              Return to App
            </button>
          </>
        ) : (
          <p className="text-sm text-gray-300">{status}</p>
        )}
      </div>
    </div>
  );
};

export default AuthCallback;
