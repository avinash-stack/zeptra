import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
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

  const loadUserData = useCallback(async (userId: string) => {
    const profileData = await fetchProfile(userId);
    
    if (profileData && profileData.status === 'inactive') {
      toast.error('Your account has been deactivated');
      await supabase.auth.signOut();
      setUser(null); setSession(null); setProfile(null);
      setOrganization(null); setRoles([]); setIsManager(false);
      return;
    }

    await fetchRoles(userId);
    await checkIsManager(userId);
    if (profileData?.org_id) {
      await fetchOrganization(profileData.org_id);
    } else {
      setOrganization(null);
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
      return;
    }

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        loadUserData(s.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        setSession(newSession);
        setUser(newSession?.user ?? null);

        if (newSession?.user) {
          setTimeout(() => {
            loadUserData(newSession.user.id);
          }, 500);
        } else {
          setProfile(null);
          setOrganization(null);
          setRoles([]);
          setIsManager(false);
        }
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    if (!isSupabaseConfigured) throw new Error('Supabase is not configured.');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signOut = async () => {
    if (!isSupabaseConfigured) {
      setUser(null); setSession(null); setProfile(null);
      setOrganization(null); setRoles([]); setIsManager(false);
      return;
    }
    await supabase.auth.signOut();
    setUser(null); setSession(null); setProfile(null);
    setOrganization(null); setRoles([]); setIsManager(false);
  };

  const hasRole = (role: AppRole) => roles.includes(role);
  const hasAnyRole = (r: AppRole[]) => r.some(role => roles.includes(role));

  return (
    <AuthContext.Provider value={{
      user, session, profile, organization, roles, isManager,
      loading, signIn, signOut, hasRole, hasAnyRole,
      refreshProfile, refreshOrg, reloadAll
    }}>
      {children}
    </AuthContext.Provider>
  );
};
