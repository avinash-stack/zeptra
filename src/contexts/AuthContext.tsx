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
  // calls right after creating a new org. It must never be silently dropped.
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

  // ── Effect 1: Auth event handling ────────────────────────────────
  //
  // CRITICAL RULE: The onAuthStateChange callback must be SYNCHRONOUS.
  // Supabase v2 holds an internal session lock while this callback
  // executes. Any Supabase API call (DB queries, getSession) made
  // inside this callback will try to acquire the SAME lock → DEADLOCK.
  //
  // So we ONLY do synchronous React state updates here (setUser,
  // setSession). The actual data loading (loadUserData) is triggered
  // by Effect 2 below, which runs OUTSIDE the Supabase lock.
  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      setProfileReady(true);
      return;
    }

    let mounted = true;

    // Register the listener FIRST (Supabase recommended pattern)
    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
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

        // For SIGNED_IN, TOKEN_REFRESHED, INITIAL_SESSION, USER_UPDATED:
        // just update session/user. Data loading happens in Effect 2.
        if (newSession?.user) {
          setSession(newSession);
          setUser(newSession.user);
        }
      }
    );

    // Then actively restore session
    supabase.auth.getSession().then(({ data: { session: existingSession } }) => {
      if (!mounted) return;
      if (existingSession?.user) {
        setSession(existingSession);
        setUser(existingSession.user);
      } else {
        // No session at all — stop loading immediately
        setLoading(false);
        setProfileReady(true);
      }
    }).catch((error) => {
      console.error('getSession failed:', error);
      if (mounted) {
        setLoading(false);
        setProfileReady(true);
      }
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  // ── Effect 2: Load user data when user changes ───────────────────
  //
  // This runs OUTSIDE the Supabase auth lock, so DB queries work
  // without deadlocking. It fires when user.id changes (login,
  // logout→login as different user). For same-user reloads (e.g.
  // after org creation), reloadAll() calls loadUserData directly.
  const prevUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (user && user.id !== prevUserIdRef.current) {
      prevUserIdRef.current = user.id;
      loadUserData(user.id);
    } else if (!user) {
      prevUserIdRef.current = null;
    }
  }, [user, loadUserData]);

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
