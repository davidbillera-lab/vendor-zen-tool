import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

export interface UserPlatform {
  platform: string;
  enabled: boolean;
  display_order: number;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isAdmin: boolean;
  userPlatforms: UserPlatform[];
  refreshPlatforms: () => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userPlatforms, setUserPlatforms] = useState<UserPlatform[]>([]);

  const fetchProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from('user_profiles' as any)
      .select('is_admin')
      .eq('id', userId)
      .single();
    if (error) console.error('[AuthContext] fetchProfile error:', error);
    console.log('[AuthContext] fetchProfile result:', data);
    setIsAdmin(!!(data as any)?.is_admin);
  };

  const fetchPlatforms = async (userId: string) => {
    const { data } = await supabase
      .from('user_platforms' as any)
      .select('platform, enabled, display_order')
      .eq('user_id', userId)
      .order('display_order');
    setUserPlatforms((data as unknown as UserPlatform[]) || []);
  };

  const refreshPlatforms = async () => {
    if (user) await fetchPlatforms(user.id);
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        if (event === 'SIGNED_OUT') {
          setSession(null);
          setUser(null);
          setIsAdmin(false);
          setUserPlatforms([]);
          setLoading(false);
          return;
        }
        setSession(newSession);
        setUser(newSession?.user ?? null);
        setLoading(false);

        if (newSession?.user) {
          setTimeout(() => {
            fetchProfile(newSession.user.id);
            fetchPlatforms(newSession.user.id);
          }, 0);
        }
      }
    );

    supabase.auth.getSession().then(({ data: { session: existingSession } }) => {
      setSession(existingSession);
      setUser(existingSession?.user ?? null);
      setLoading(false);
      if (existingSession?.user) {
        fetchProfile(existingSession.user.id);
        fetchPlatforms(existingSession.user.id);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string) => {
    const redirectUrl = `${window.location.origin}/`;
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirectUrl }
    });
    return { error: error as Error | null };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    setUser(null);
    setSession(null);
    setIsAdmin(false);
    setUserPlatforms([]);
    await supabase.auth.signOut({ scope: 'global' });
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, isAdmin, userPlatforms, refreshPlatforms, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
