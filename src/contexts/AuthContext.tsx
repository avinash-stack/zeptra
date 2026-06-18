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
    const org = data as Organization | null;
    setOrganization(org);
    return org;
  };

  const checkIsManager = async (userId: string) => {
    const { data } = await supabase
      .from('users')
      .select('id')
      .eq('manager_id', userId)
      .limit(1);
    const result = (data && data.length > 0) || false;
    setIsManager(result);
    return result;
  };

  // loadUserData ALWAYS runs to completion. No guard, no dropping.
  // Every call fetches fresh truth from the DB and updates state.
  // This is intentional: correctness over micro-optimization.
  // The previous version had a ref-based guard that silently dropped
  // calls arriving while another was in flight — this broke org
  // creation (the reload after creating an org got dropped) and left
  // stale state that crashed other pages on navigation. Never repeat
  // that pattern here.
  const loadUserData = useCallback(async (userId: string) => {
    try {
      const [profileData] = await Promise.all([
        fetchProfile(userId),
        fetchRoles(userId),
        checkIsManager(userId),
      ]);

      if (profileData && profileData.status === 'inactive') {
        toast.error('Your account has been deactivated');
        await supabase.auth.signOut();
        setUser(null);
        setSession(null);
        setProfile(null);
        setOrganization(null);
        setRoles([]);
        setIsManager(false);
        return;
      }

      if (profileData?.org_id) {
        await fetchOrganization(profileData.org_id);
      } else {
        setOrganization(null);
      }
    } catch (err) {
      console.error('loadUserData error:', err);
    } finally {
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

  // reloadAll ALWAYS runs to completion — this is what OrganizationProfile.tsx
  // calls right after creating a new org, to pick up the new org_id and
  // admin role. It must never be silently dropped.
  const reloadAll = useCallback(async () => {
    if (!user) {
      const { data: { session: s } } = await supabase.auth.getSession();
      if (s?.user) {
        setSession(s);
        setUser(s.user);
        await loadUserData(s.user.id);
      }
      return;
    }
    await loadUserData(user.id);
  }, [user, loadUserData]);

  // Prevents only ONE specific redundant fetch: getSession() on mount
  // and the subsequent INITIAL auth event both firing for the exact
  // same session. This does NOT block any future legitimate call —
  // it only matters during the very first mount.
  const hasHandledInitialSession = useRef(false);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      setProfileReady(true);
      return;
    }

    let mounted = true;

    const initAuth = async () => {
      console.log('[AuthContext] initAuth: starting getSession()');
      try {
        const { data: { session: existingSession } } = await supabase.auth.getSession();

        console.log('[AuthContext] initAuth: getSession resolved, session:', !!existingSession);

        if (!mounted) return;

        hasHandledInitialSession.current = true;

        if (existingSession?.user) {
          console.log('[AuthContext] initAuth: session found, loading user data for', existingSession.user.id);
          setSession(existingSession);
          setUser(existingSession.user);
          await loadUserData(existingSession.user.id);
          console.log('[AuthContext] initAuth: loadUserData complete');
        } else {
          console.log('[AuthContext] initAuth: no session, setting loading=false');
          setLoading(false);
          setProfileReady(true);
        }
      } catch (error) {
        console.error('[AuthContext] initAuth FAILED:', error);
        if (mounted) {
          setLoading(false);
          setProfileReady(true);
        }
      }
    };

    initAuth();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        console.log('[AuthContext] onAuthStateChange:', event, 'user:', !!newSession?.user, 'hasHandled:', hasHandledInitialSession.current);
        if (!mounted) return;

        if (event === 'SIGNED_OUT') {
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

        // Skip only the very first INITIAL_SESSION-equivalent event if
        // initAuth() above already handled it. Every subsequent event
        // (including a second SIGNED_IN for the same user, e.g. after
        // creating an org) runs loadUserData fully — no exceptions.
        if (event === 'INITIAL_SESSION' && hasHandledInitialSession.current) {
          return;
        }

        if (newSession?.user) {
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
      setUser(null);
      setSession(null);
      setProfile(null);
      setOrganization(null);
      setRoles([]);
      setIsManager(false);
      setProfileReady(true);
      return;
    }
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setOrganization(null);
    setRoles([]);
    setIsManager(false);
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
