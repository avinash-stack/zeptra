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

  // ── Staleness counter ────────────────────────────────────────────
  //
  // Every loadUserData call increments this counter and captures its
  // own snapshot. After each async step, the call checks whether its
  // snapshot still matches the current counter — if not, a NEWER call
  // has been started and this one's results are stale, so it bails.
  //
  // This is NOT a blocking guard — every call RUNS fully (fetches
  // still happen). It just prevents an older, slower response from
  // overwriting a newer one. Solves the race where onAuthStateChange
  // fires loadUserData (fetching pre-org-creation data) concurrently
  // with reloadAll's loadUserData (fetching post-org-creation data).
  // Whichever STARTED last wins.
  const loadGeneration = useRef(0);

  // ── Data-fetching helpers (pure — return data, no state writes) ──

  const fetchProfileData = async (userId: string): Promise<Profile | null> => {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();
    if (error) console.error('fetchProfile error:', error.message);
    return data as Profile | null;
  };

  const fetchRolesData = async (userId: string): Promise<AppRole[]> => {
    const { data, error } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId);
    if (error) console.error('fetchRoles error:', error.message);
    return (data as { role: AppRole }[] | null)?.map(r => r.role) || [];
  };

  const fetchOrganizationData = async (orgId: string): Promise<Organization | null> => {
    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', orgId)
      .single();
    if (error) console.error('fetchOrg error:', error.message);
    return data as Organization | null;
  };

  const checkIsManagerData = async (userId: string): Promise<boolean> => {
    const { data } = await supabase
      .from('users')
      .select('id')
      .eq('manager_id', userId)
      .limit(1);
    return (data && data.length > 0) || false;
  };

  // ── Helper: clear all auth state ─────────────────────────────────

  const clearState = () => {
    setUser(null);
    setSession(null);
    setProfile(null);
    setOrganization(null);
    setRoles([]);
    setIsManager(false);
    setProfileReady(true);
    setLoading(false);
  };

  // ── Core loader ──────────────────────────────────────────────────
  //
  // Every call runs fully — no call is ever dropped or blocked.
  // The generation counter ensures only the LATEST call's results
  // are written to state. Older concurrent calls discard their
  // results at the write step, not the fetch step.
  //
  // CRITICAL: wrapped in try/finally so that loading and profileReady
  // are ALWAYS resolved — even if a fetch throws. Without this,
  // a network error leaves loading=true forever → permanent blank
  // screen on refresh.

  const loadUserData = useCallback(async (userId: string) => {
    const myGeneration = ++loadGeneration.current;

    try {
      // Fetch profile, roles, manager status in parallel
      const [profileData, fetchedRoles, managerFlag] = await Promise.all([
        fetchProfileData(userId),
        fetchRolesData(userId),
        checkIsManagerData(userId),
      ]);

      // Stale? A newer loadUserData started while we were fetching.
      // Discard our results — the newer call will write state.
      if (myGeneration !== loadGeneration.current) return;

      // Inactive account → sign out and clear everything
      if (profileData && profileData.status === 'inactive') {
        toast.error('Your account has been deactivated');
        await supabase.auth.signOut();
        clearState();
        return;
      }

      // Write profile, roles, manager
      setProfile(profileData);
      setRoles(fetchedRoles);
      setIsManager(managerFlag);

      // Fetch org if profile has one
      if (profileData?.org_id) {
        const orgData = await fetchOrganizationData(profileData.org_id);

        // Stale check again after the org fetch
        if (myGeneration !== loadGeneration.current) return;

        setOrganization(orgData);
      } else {
        setOrganization(null);
      }
    } catch (error) {
      console.error('loadUserData failed:', error);
      // If stale, a newer call will handle state — don't interfere.
      if (myGeneration !== loadGeneration.current) return;
      // If we're still the latest call, we must unblock the UI even
      // on error. Profile/org may be null but at least the app won't
      // be stuck on a blank spinner forever.
    } finally {
      // ONLY set loading/profileReady if we're still the latest call.
      // If a newer call is in flight, let IT be responsible for these.
      if (myGeneration === loadGeneration.current) {
        setProfileReady(true);
        setLoading(false);
      }
    }
  }, []);

  // ── Helpers exposed via context ──────────────────────────────────

  const refreshProfile = async () => {
    if (user) {
      const p = await fetchProfileData(user.id);
      setProfile(p);
      if (p?.org_id) {
        const orgData = await fetchOrganizationData(p.org_id);
        setOrganization(orgData);
      }
    }
  };

  const refreshOrg = async () => {
    if (user) {
      const p = await fetchProfileData(user.id);
      setProfile(p);
      if (p?.org_id) {
        const orgData = await fetchOrganizationData(p.org_id);
        setOrganization(orgData);
      }
    }
  };

  const reloadAll = useCallback(async () => {
    if (!user) {
      // user state may be stale (e.g. first render) — re-check session
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

  // ── Auth lifecycle ───────────────────────────────────────────────

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      setProfileReady(true);
      return;
    }

    let mounted = true;

    // Set to true once initAuth completes. Only purpose: prevent the
    // onAuthStateChange INITIAL_SESSION event from redundantly
    // re-fetching what initAuth already fetched. Does NOT block any
    // future calls.
    const hasInitialized = { current: false };

    const initAuth = async () => {
      try {
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
      } catch (error) {
        console.error('initAuth failed:', error);
        if (mounted) {
          setLoading(false);
          setProfileReady(true);
        }
      }

      hasInitialized.current = true;
    };

    initAuth();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        if (!mounted) return;

        // ── SIGNED_OUT: clear everything, no data fetch ──
        if (event === 'SIGNED_OUT') {
          loadGeneration.current++; // invalidate any in-flight loads
          clearState();
          return;
        }

        // ── INITIAL_SESSION: skip if initAuth already handled it ──
        if (event === 'INITIAL_SESSION' && hasInitialized.current) {
          return;
        }

        // ── SIGNED_IN / TOKEN_REFRESHED / USER_UPDATED ──
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

  // ── Auth actions ─────────────────────────────────────────────────

  const signIn = async (email: string, password: string) => {
    if (!isSupabaseConfigured) throw new Error('Supabase is not configured.');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signOut = async () => {
    if (!isSupabaseConfigured) {
      clearState();
      return;
    }
    await supabase.auth.signOut();
    clearState();
  };

  // ── Role checks ─────────────────────────────────────────────────

  const hasRole = (role: AppRole) => roles.includes(role);
  const hasAnyRole = (r: AppRole[]) => r.some(role => roles.includes(role));

  // ── Render ───────────────────────────────────────────────────────

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
