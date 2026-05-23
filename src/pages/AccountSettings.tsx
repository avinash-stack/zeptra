import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Loader2, User, Mail, Building2, Phone, Lock, Bell } from 'lucide-react';
import type { NotificationPreferences } from '@/types/database';

const AccountSettings: React.FC = () => {
  const { profile, refreshProfile, user } = useAuth();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Sync state when profile loads or updates
  useEffect(() => {
    if (profile) {
      setFirstName(profile.first_name || '');
      setLastName(profile.last_name || '');
      setPhone(profile.phone || '');
    }
  }, [profile]);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  // Notification preferences
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences | null>(null);
  const [notifLoading, setNotifLoading] = useState(true);

  useEffect(() => {
    if (user) fetchNotifPrefs();
  }, [user]);

  const fetchNotifPrefs = async () => {
    if (!user) return;
    setNotifLoading(true);
    const { data } = await supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', user.id)
      .single();
    setNotifPrefs(data as NotificationPreferences | null);
    setNotifLoading(false);
  };

  const toggleNotifPref = async (key: keyof Pick<NotificationPreferences, 'on_expense_submitted' | 'on_expense_approved' | 'on_expense_rejected' | 'on_approval_needed'>) => {
    if (!notifPrefs || !user) return;
    const newVal = !notifPrefs[key];
    // Optimistic update
    setNotifPrefs({ ...notifPrefs, [key]: newVal });

    const { error } = await supabase
      .from('notification_preferences')
      .update({ [key]: newVal })
      .eq('user_id', user.id);

    if (error) {
      // Revert on failure
      setNotifPrefs({ ...notifPrefs, [key]: !newVal });
      toast.error('Failed to update preference');
    } else {
      toast.success('Notification preference updated');
    }
  };

  const handleSaveProfile = async () => {
    if (!user) return;
    setSavingProfile(true);
    const fullName = `${firstName.trim()} ${lastName.trim()}`.trim() || profile?.email || '';

    const { error } = await supabase
      .from('users')
      .update({
        name: fullName,
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
        phone: phone.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Profile updated');
      refreshProfile();
    }
    setSavingProfile(false);
  };

  const handleChangePassword = async () => {
    if (!newPassword || newPassword.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    setSavingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Password updated successfully');
      setNewPassword('');
      setConfirmPassword('');
    }
    setSavingPassword(false);
  };

  if (!profile) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const notifOptions = [
    { key: 'on_approval_needed' as const, label: 'When an expense needs my approval', description: 'Get notified when a new expense is assigned to you for review' },
    { key: 'on_expense_approved' as const, label: 'When my expense is approved', description: 'Get notified when your submitted expense is approved' },
    { key: 'on_expense_rejected' as const, label: 'When my expense is rejected', description: 'Get notified when your submitted expense is rejected' },
    { key: 'on_expense_submitted' as const, label: 'When someone submits an expense', description: 'Get notified about new expense submissions in your org' },
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
          Account Settings
        </h1>
        <p className="text-muted-foreground mt-1">Update your personal information and security</p>
      </div>

      {/* Profile Info */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
              <User className="w-6 h-6 text-primary-foreground" />
            </div>
            <div>
              <CardTitle>Personal Information</CardTitle>
              <CardDescription>Update your name and contact details</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
            <Mail className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm text-muted-foreground">Email</p>
              <p className="font-medium">{profile.email}</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="firstName">First Name</Label>
              <Input id="firstName" value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="First name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last Name</Label>
              <Input id="lastName" value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Last name" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input id="phone" className="pl-9" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+1-555-0123" />
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
            <Building2 className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm text-muted-foreground">Department</p>
              <p className="font-medium">{profile.tag || 'Not assigned'}</p>
            </div>
          </div>

          <Button onClick={handleSaveProfile} disabled={savingProfile} className="w-full bg-gradient-to-r from-primary to-accent">
            {savingProfile && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Profile
          </Button>
        </CardContent>
      </Card>

      {/* Change Password */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-warning to-warning/70 flex items-center justify-center">
              <Lock className="w-6 h-6 text-white" />
            </div>
            <div>
              <CardTitle>Change Password</CardTitle>
              <CardDescription>Update your account password</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="newPassword">New Password</Label>
            <Input id="newPassword" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Min. 8 characters" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm New Password</Label>
            <Input id="confirmPassword" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Re-enter password" />
          </div>
          <Button onClick={handleChangePassword} disabled={savingPassword} variant="outline" className="w-full">
            {savingPassword && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Update Password
          </Button>
        </CardContent>
      </Card>

      {/* Email Notifications */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-info to-info/70 flex items-center justify-center">
              <Bell className="w-6 h-6 text-white" />
            </div>
            <div>
              <CardTitle>Email Notifications</CardTitle>
              <CardDescription>Choose which email notifications you receive</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {notifLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : !notifPrefs ? (
            <p className="text-sm text-muted-foreground py-4">Notification preferences not found. They will be created automatically on next login.</p>
          ) : (
            <div className="space-y-1">
              {notifOptions.map(opt => (
                <div key={opt.key} className="flex items-center justify-between py-3 border-b last:border-b-0">
                  <div className="space-y-0.5 pr-4">
                    <p className="text-sm font-medium">{opt.label}</p>
                    <p className="text-xs text-muted-foreground">{opt.description}</p>
                  </div>
                  <Switch
                    checked={notifPrefs[opt.key]}
                    onCheckedChange={() => toggleNotifPref(opt.key)}
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AccountSettings;
