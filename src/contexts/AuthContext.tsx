import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '@/integrations/supabase/client';
import type { Profile, AppRole, Organization } from '@/types/database';
import { toast } from 'sonner';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  organization: Organization | null;
  roles: AppRole[];
  isManager: boolean;
  loading: boolean;
  profileReady: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  hasRole: (role: AppRole) => boolean;
  hasAnyRole: (roles: AppRole[]) => boolean;
  refreshProfile: () => Promise<void>;
  refreshOrg: () => Promise<void>;
  reloadAll: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [isManager, setIsManager] = useState(false);
  const [loading, setLoading] = useState(true);
  const [profileReady, setProfileReady] = useState(false);

  const fetchProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();
    if (error) console.error('fetchProfile error:', error.message);
    const p = data as Profile | null;
    setProfile(p);
    return p;
  };

  const fetchRoles = async (userId: string) => {
    const { data, error } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId);
    if (error) console.error('fetchRoles error:', error.message);
    const fetchedRoles = (data as { role: AppRole }[] | null)?.map(r => r.role) || [];
    setRoles(fetchedRoles);
    return fetchedRoles;
  };

  const fetchOrganization = async (orgId: string) => {
    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', orgId)
      .single();
    if (error) console.error('fetchOrg error:', error.message);
    setOrganization(data as Organization | null);
  };

  const checkIsManager = async (userId: string) => {
    const { data } = await supabase
      .from('users')
      .select('id')
      .eq('manager_id', userId)
      .limit(1);
    setIsManager((data && data.length > 0) || false);
  };

  const lastLoadedUserId = useRef<string | null>(null);
  const isLoadingUserData = useRef(false);

  const loadUserData = useCallback(async (userId: string) => {
    // Skip if already loaded for this exact user
    if (lastLoadedUserId.current === userId && !isLoadingUserData.current) {
      return;
    }
    // A load is already in flight — don't stack another
    if (isLoadingUserData.current) {
      return;
    }

    isLoadingUserData.current = true;
    try {
      const [profileData] = await Promise.all([
        fetchProfile(userId),
        fetchRoles(userId),
        checkIsManager(userId),
      ]);

      if (profileData && profileData.status === 'inactive') {
        toast.error('Your account has been deactivated');
        await supabase.auth.signOut();
        setUser(null); setSession(null); setProfile(null);
        setOrganization(null); setRoles([]); setIsManager(false);
        lastLoadedUserId.current = null;
        return;
      }

      if (profileData?.org_id) {
        await fetchOrganization(profileData.org_id);
      } else {
        setOrganization(null);
      }

      lastLoadedUserId.current = userId;
    } finally {
      isLoadingUserData.current = false;
      setProfileReady(true);
      setLoading(false);
    }
  }, []);

  const refreshProfile = async () => {
    if (user) {
      const p = await fetchProfile(user.id);
      if (p?.org_id) await fetchOrganization(p.org_id);
    }
  };

  const refreshOrg = async () => {
    if (user) {
      const p = await fetchProfile(user.id);
      if (p?.org_id) await fetchOrganization(p.org_id);
    }
  };

  const reloadAll = useCallback(async () => {
    const currentUser = user;
    // Force a fresh load by clearing the guard
    lastLoadedUserId.current = null;
    if (!currentUser) {
      const { data: { session: s } } = await supabase.auth.getSession();
      if (s?.user) {
        setUser(s.user);
        setSession(s);
        await loadUserData(s.user.id);
      }
      return;
    }
    await loadUserData(currentUser.id);
  }, [user, loadUserData]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      setProfileReady(true);
      return;
    }

    let mounted = true;

    // Actively restore session on mount — don't wait passively
    const initAuth = async () => {
      const { data: { session: existingSession } } =
        await supabase.auth.getSession();

      if (mounted && existingSession?.user) {
        setSession(existingSession);
        setUser(existingSession.user);
        await loadUserData(existingSession.user.id);
      } else if (mounted) {
        setLoading(false);
        setProfileReady(true);
      }
    };

    initAuth();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        if (!mounted) return;

        if (event === 'SIGNED_OUT') {
          lastLoadedUserId.current = null;
          setUser(null);
          setSession(null);
          setProfile(null);
          setOrganization(null);
          setRoles([]);
          setIsManager(false);
          setProfileReady(true);
          setLoading(false);
          return;
        }

        if (newSession?.user) {
          const isNewUser = lastLoadedUserId.current !== newSession.user.id;
          if (isNewUser) {
            setProfileReady(false);
          }
          setSession(newSession);
          setUser(newSession.user);
          await loadUserData(newSession.user.id);
        }
      }
    );

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, [loadUserData]);

  const signIn = async (email: string, password: string) => {
    if (!isSupabaseConfigured) throw new Error('Supabase is not configured.');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signOut = async () => {
    if (!isSupabaseConfigured) {
      setUser(null); setSession(null); setProfile(null);
      setOrganization(null); setRoles([]); setIsManager(false);
      setProfileReady(true);
      return;
    }
    await supabase.auth.signOut();
    setUser(null); setSession(null); setProfile(null);
    setOrganization(null); setRoles([]); setIsManager(false);
    setProfileReady(true);
  };

  const hasRole = (role: AppRole) => roles.includes(role);
  const hasAnyRole = (r: AppRole[]) => r.some(role => roles.includes(role));

  return (
    <AuthContext.Provider value={{
      user, session, profile, organization, roles, isManager,
      loading, profileReady, signIn, signOut, hasRole, hasAnyRole,
      refreshProfile, refreshOrg, reloadAll
    }}>
      {children}
    </AuthContext.Provider>
  );
};
