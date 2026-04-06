import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';

interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  gamesPlayed: number;
  messagesSent: number;
  timesGenerated: number;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signInWithMagicLink: (email: string) => Promise<{ success: boolean; message: string }>;
  signOut: () => Promise<void>;
  updateUserStats: (stats: Partial<Pick<User, 'gamesPlayed' | 'messagesSent' | 'timesGenerated'>>) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for existing session
    checkUser();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        await fetchOrCreateProfile(session.user);
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const checkUser = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        await fetchOrCreateProfile(session.user);
      }
    } catch (error) {
      console.error('Error checking user:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchOrCreateProfile = async (authUser: any) => {
    try {
      // Try to fetch existing profile
      const { data: profile, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', authUser.id)
        .single();

      if (error && error.code === 'PGRST116') {
        // Profile doesn't exist, create one
        const newProfile = {
          user_id: authUser.id,
          email: authUser.email,
          display_name: authUser.user_metadata?.full_name || authUser.email?.split('@')[0] || 'Anonymous',
          avatar_url: authUser.user_metadata?.avatar_url || null,
          games_played: 0,
          messages_sent: 0,
          times_generated: 0,
        };

        const { data: createdProfile, error: createError } = await supabase
          .from('user_profiles')
          .insert(newProfile)
          .select()
          .single();

        if (createError) throw createError;

        setUser({
          id: authUser.id,
          email: createdProfile.email,
          displayName: createdProfile.display_name,
          avatarUrl: createdProfile.avatar_url,
          gamesPlayed: createdProfile.games_played,
          messagesSent: createdProfile.messages_sent,
          timesGenerated: createdProfile.times_generated,
        });
      } else if (profile) {
        setUser({
          id: authUser.id,
          email: profile.email,
          displayName: profile.display_name,
          avatarUrl: profile.avatar_url,
          gamesPlayed: profile.games_played,
          messagesSent: profile.messages_sent,
          timesGenerated: profile.times_generated,
        });
      }
    } catch (error) {
      console.error('Error fetching/creating profile:', error);
    }
  };

  const signInWithMagicLink = async (email: string): Promise<{ success: boolean; message: string }> => {
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;
      return { success: true, message: 'Check your email for the magic link!' };
    } catch (error: any) {
      console.error('Error sending magic link:', error);
      return { success: false, message: error.message || 'Failed to send magic link' };
    }
  };

  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setUser(null);
    } catch (error) {
      console.error('Error signing out:', error);
      throw error;
    }
  };

  const updateUserStats = async (stats: Partial<Pick<User, 'gamesPlayed' | 'messagesSent' | 'timesGenerated'>>) => {
    if (!user) return;

    try {
      const updates: any = {};
      if (stats.gamesPlayed !== undefined) updates.games_played = stats.gamesPlayed;
      if (stats.messagesSent !== undefined) updates.messages_sent = stats.messagesSent;
      if (stats.timesGenerated !== undefined) updates.times_generated = stats.timesGenerated;

      const { error } = await supabase
        .from('user_profiles')
        .update(updates)
        .eq('user_id', user.id);

      if (error) throw error;

      setUser(prev => prev ? { ...prev, ...stats } : null);
    } catch (error) {
      console.error('Error updating user stats:', error);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, signInWithMagicLink, signOut, updateUserStats }}>
      {children}
    </AuthContext.Provider>
  );
};
