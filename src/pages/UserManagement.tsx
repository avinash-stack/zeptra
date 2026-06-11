import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Loader2, Mail, Pencil, Plus, Search, Trash2, UserCheck, UserX, AlertTriangle } from 'lucide-react';
import { usePlanLimit } from '@/hooks/usePlanLimit';
import type { Profile, AppRole } from '@/types/database';

interface UserWithRoles extends Profile {
  roles: AppRole[];
  managerName?: string;
}

type UserRoleRow = {
  user_id: string;
  role: AppRole;
};

type ManageUserPayload = {
  action: 'delete' | 'reset_password' | 'update_role' | 'update_profile' | 'update_status';
  target_user_id: string;
  email?: string;
  redirect_to?: string;
  role?: AppRole;
  manager_id?: string | null;
  status?: 'active' | 'inactive';
};

const getFunctionErrorMessage = async (error: unknown, fallback: string, functionName = 'manage-user') => {
  const maybeContext = error as { context?: Response };
  if (maybeContext?.context) {
    try {
      const body = await maybeContext.context.clone().json();
      if (body?.error) return String(body.error);
    } catch {
      // Fall back to the SDK error message below.
    }
  }

  if (error instanceof Error && error.name === 'FunctionsFetchError') {
    return `Could not reach the \`${functionName}\` Edge Function. Deploy \`${functionName}\` and confirm its CORS/env settings are configured in Supabase.`;
  }

  return error instanceof Error ? error.message : fallback;
};

const invokeManageUser = async (body: ManageUserPayload) => {
  const { data, error } = await supabase.functions.invoke('manage-user', { body });
  if (error) {
    throw new Error(await getFunctionErrorMessage(error, 'User update failed'));
  }
  if (data?.error) {
    throw new Error(data.error);
  }
  return data;
};

const UserManagement: React.FC = () => {
  const { profile: currentProfile, roles } = useAuth();
  const billing = usePlanLimit();
  const [users, setUsers] = useState<UserWithRoles[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingUser, setCreatingUser] = useState(false);
  const [actionUserId, setActionUserId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editUser, setEditUser] = useState<UserWithRoles | null>(null);
  const [deleteUser, setDeleteUser] = useState<UserWithRoles | null>(null);

  // Create form
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<AppRole>('employee');
  const [newManagerId, setNewManagerId] = useState('none');
  const [newTag, setNewTag] = useState('');

  // Pagination states
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const PAGE_SIZE = 10;

  interface ManagerUser {
    id: string;
    name: string;
    roles: AppRole[];
  }
  const [managers, setManagers] = useState<ManagerUser[]>([]);

  const isAdmin = roles.includes('admin');
  const isHr = roles.includes('hr');
  const canInviteUsers = isAdmin || isHr;
  const canToggleUsers = isAdmin || isHr;
  const canEditUsers = isAdmin || isHr;
  const canResetPasswords = isAdmin;
  const canDeleteUsers = isAdmin;

  const fetchManagers = useCallback(async () => {
    try {
      const { data: profiles } = await supabase
        .from('users')
        .select('id, name')
        .eq('status', 'active')
        .order('name')
        .limit(200);
      
      if (profiles) {
        const userIds = profiles.map(p => p.id);
        let rolesData: UserRoleRow[] = [];
        if (userIds.length > 0) {
          const { data: fetchedRoles } = await supabase
            .from('user_roles')
            .select('user_id, role')
            .in('user_id', userIds);
          rolesData = (fetchedRoles || []) as UserRoleRow[];
        }
        
        const managersList: ManagerUser[] = profiles.map(p => ({
          id: p.id,
          name: p.name,
          roles: rolesData.filter(r => r.user_id === p.id).map(r => r.role as AppRole),
        }));
        setManagers(managersList);
      }
    } catch (err) {
      console.error('Failed to fetch managers:', err);
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('users')
        .select('*', { count: 'exact' });

      if (searchTerm.trim() !== '') {
        query = query.or(`name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`);
      }

      const start = page * PAGE_SIZE;
      const end = start + PAGE_SIZE - 1;

      const { data: profiles, count, error } = await query
        .order('name')
        .range(start, end);

      if (error) throw error;

      if (profiles) {
        const userIds = profiles.map(p => p.id);
        
        let rolesData: UserRoleRow[] = [];
        if (userIds.length > 0) {
          const { data: fetchedRoles } = await supabase
            .from('user_roles')
            .select('user_id, role')
            .in('user_id', userIds);
          rolesData = (fetchedRoles || []) as UserRoleRow[];
        }

        const managerIds = [...new Set(profiles.map(p => p.manager_id).filter(Boolean))];
        const managerMap = new Map<string, string>();
        if (managerIds.length > 0) {
          const { data: managersData } = await supabase
            .from('users')
            .select('id, name')
            .in('id', managerIds);
          if (managersData) {
            managersData.forEach(m => managerMap.set(m.id, m.name));
          }
        }

        const usersWithRoles: UserWithRoles[] = (profiles as Profile[]).map(p => ({
          ...p,
          roles: rolesData.filter(r => r.user_id === p.id).map(r => r.role),
          managerName: managerMap.get(p.manager_id || '') || undefined,
        }));
        setUsers(usersWithRoles);
        setHasMore(count ? (start + profiles.length < count) : (profiles.length === PAGE_SIZE));
      } else {
        setUsers([]);
        setHasMore(false);
      }
    } catch (err) {
      console.error('Failed to fetch users:', err);
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [page, searchTerm]);

  useEffect(() => {
    fetchManagers();
  }, [fetchManagers]);

  useEffect(() => {
    const handler = setTimeout(() => {
      fetchUsers();
    }, 300);

    return () => {
      clearTimeout(handler);
    };
  }, [fetchUsers]);

  const handleCreateUser = async () => {
    if (!newName.trim() || !newEmail.trim()) {
      toast.error('Name and email are required');
      return;
    }

    setCreatingUser(true);
    try {
      const redirectTo = `${window.location.origin}/set-password`;
      const roleToInvite = !isAdmin && newRole === 'admin' ? 'employee' : newRole;

      const { data, error } = await supabase.functions.invoke('invite-user', {
        body: {
          email: newEmail.trim().toLowerCase(),
          name: newName.trim(),
          role: roleToInvite,
          manager_id: newManagerId && newManagerId !== 'none' ? newManagerId : null,
          tag: newTag.trim() || null,
          redirect_to: redirectTo,
        },
      });

      if (error) {
        throw new Error(await getFunctionErrorMessage(error, 'Failed to send invite', 'invite-user'));
      }
      if (data?.error) throw new Error(data.error);

      toast.success(`Invite sent to ${newEmail}. User can activate from email.`);
      setShowCreateDialog(false);
      resetForm();
      fetchUsers();
      fetchManagers();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to send invite';
      toast.error(message);
    } finally {
      setCreatingUser(false);
    }
  };

  const toggleUserStatus = async (userId: string, currentStatus: string) => {
    setActionUserId(userId);
    const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
    try {
      await invokeManageUser({
        action: 'update_status',
        target_user_id: userId,
        status: newStatus,
      });
      toast.success(`User ${newStatus === 'active' ? 'activated' : 'deactivated'}`);
      fetchUsers();
      fetchManagers();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to update user status');
    } finally {
      setActionUserId(null);
    }
  };

  const updateUserRole = async (userId: string, role: AppRole) => {
    setActionUserId(userId);
    try {
      await invokeManageUser({
        action: 'update_role',
        target_user_id: userId,
        role,
      });
      toast.success('Role updated');
      fetchUsers();
      fetchManagers();
      setEditUser(null);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to update role');
    } finally {
      setActionUserId(null);
    }
  };

  const resetUserPassword = async (user: UserWithRoles) => {
    setActionUserId(user.id);
    try {
      const redirectTo = (import.meta.env.VITE_INVITE_REDIRECT_TO as string | undefined) || `${window.location.origin}/set-password`;
      await invokeManageUser({
        action: 'reset_password',
        target_user_id: user.id,
        email: user.email,
        redirect_to: redirectTo,
      });

      toast.success(`Password reset email sent to ${user.email}`);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to reset password');
    } finally {
      setActionUserId(null);
    }
  };

  const confirmDeleteUser = async () => {
    if (!deleteUser) return;

    setActionUserId(deleteUser.id);
    try {
      await invokeManageUser({
        action: 'delete',
        target_user_id: deleteUser.id,
      });

      toast.success(`Deleted ${deleteUser.email}`);
      setDeleteUser(null);
      fetchUsers();
      fetchManagers();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete user');
    } finally {
      setActionUserId(null);
    }
  };

  const updateUserManager = async (userId: string, managerId: string) => {
    setActionUserId(userId);
    try {
      await invokeManageUser({
        action: 'update_profile',
        target_user_id: userId,
        manager_id: managerId || null,
      });
      toast.success('Manager updated');
      fetchUsers();
      fetchManagers();
      setEditUser(null);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to update manager');
    } finally {
      setActionUserId(null);
    }
  };

  const resetForm = () => {
    setNewName('');
    setNewEmail('');
    setNewRole('employee');
    setNewManagerId('none');
    setNewTag('');
  };

  const filtered = users;

  const roleColors: Record<AppRole, string> = {
    admin: 'bg-destructive/15 text-destructive border-destructive/30',
    employee: 'bg-info/15 text-info border-info/30',
    hr: 'bg-warning/15 text-warning border-warning/30',
    finance: 'bg-success/15 text-success border-success/30',
  };

  const adminAssignableRoles: AppRole[] = ['employee', 'hr', 'finance', 'admin'];
  const hrAssignableRoles: AppRole[] = ['employee', 'hr', 'finance'];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">User Management</h1>
          <p className="text-muted-foreground mt-1">{isAdmin ? 'Manage users, roles, and assignments' : 'Invite users and manage active status'}</p>
        </div>
        <Button
          onClick={() => setShowCreateDialog(true)}
          className="bg-gradient-to-r from-primary to-accent"
          disabled={!canInviteUsers || billing.userLimitReached}
          title={billing.userLimitReached ? 'User limit reached for your plan' : undefined}
        >
          <Plus className="h-4 w-4 mr-2" />
          Invite User
        </Button>
      </div>

      {billing.userLimitReached && (
        <Card className="border-warning/30 bg-warning/5">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertTriangle className="h-5 w-5 text-warning shrink-0" />
            <p className="text-sm">
              Your <span className="font-semibold">{billing.plan}</span> plan allows up to{' '}
              <span className="font-semibold">{billing.limits?.max_users}</span> users.
              {' '}Upgrade your plan in <span className="font-semibold">Organization Settings → Billing</span> to add more.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search users..." className="pl-9" value={searchTerm} onChange={e => { setSearchTerm(e.target.value); setPage(0); }} />
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Manager</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(u => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.name}</TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {u.roles.map(role => (
                        <Badge key={role} variant="outline" className={roleColors[role]}>{role}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>{u.managerName || '-'}</TableCell>
                  <TableCell>{u.tag || '-'}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={u.status === 'active' ? 'bg-success/15 text-success border-success/30' : 'bg-muted text-muted-foreground'}>
                      {u.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {canEditUsers && u.id !== currentProfile?.id && (
                        <Button variant="ghost" size="icon" onClick={() => setEditUser(u)} title="Edit user">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {canToggleUsers && u.id !== currentProfile?.id && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => toggleUserStatus(u.id, u.status)}
                          disabled={actionUserId === u.id}
                          title={u.status === 'active' ? 'Deactivate user' : 'Activate user'}
                        >
                          {u.status === 'active' ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                        </Button>
                      )}
                      {canResetPasswords && u.id !== currentProfile?.id && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => resetUserPassword(u)}
                          disabled={actionUserId === u.id}
                          title="Send password reset"
                        >
                          <Mail className="h-4 w-4" />
                        </Button>
                      )}
                      {canDeleteUsers && u.id !== currentProfile?.id && (
                        <Button variant="ghost" size="icon" onClick={() => setDeleteUser(u)} title="Delete user">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
          <div className="flex items-center justify-between mt-4">
            <Button variant="outline" size="sm" onClick={() => setPage(p => p - 1)} disabled={page === 0}>
              ← Previous
            </Button>
            <span className="text-sm text-muted-foreground">Page {page + 1}</span>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={!hasMore}>
              Next →
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Create User Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={open => { if (!open && creatingUser) return; setShowCreateDialog(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite User</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Full name" />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="email@company.com" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={newRole} onValueChange={v => setNewRole(v as AppRole)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(isAdmin ? adminAssignableRoles : hrAssignableRoles).map(role => (
                      <SelectItem key={role} value={role}>
                        {role === 'hr' ? 'HR' : role.charAt(0).toUpperCase() + role.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Department</Label>
                <Input value={newTag} onChange={e => setNewTag(e.target.value)} placeholder="Engineering" />
              </div>
            </div>
              <div className="space-y-2">
                <Label>Manager (Optional)</Label>
                <Select value={newManagerId} onValueChange={setNewManagerId}>
                  <SelectTrigger><SelectValue placeholder="Select manager" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Manager</SelectItem>
                  {/* All active users can be a manager */}
                  {managers.map(m => (
                    <SelectItem key={m.id} value={m.id}>{m.name} ({m.roles.join(', ')})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleCreateUser} disabled={creatingUser} className="w-full bg-gradient-to-r from-primary to-accent">
              {creatingUser && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send Activation Invite
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={!!editUser} onOpenChange={open => !open && setEditUser(null)}>
        <DialogContent key={editUser?.id}>
          <DialogHeader>
            <DialogTitle>Edit User - {editUser?.name}</DialogTitle>
          </DialogHeader>
          {editUser && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Role</Label>
                <Select defaultValue={editUser.roles[0]} onValueChange={v => updateUserRole(editUser.id, v as AppRole)} disabled={actionUserId === editUser.id}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(isAdmin ? adminAssignableRoles : hrAssignableRoles).map(role => (
                      <SelectItem key={role} value={role}>
                        {role === 'hr' ? 'HR' : role.charAt(0).toUpperCase() + role.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Manager</Label>
                <Select defaultValue={editUser.manager_id || 'none'} onValueChange={v => updateUserManager(editUser.id, v === 'none' ? '' : v)} disabled={actionUserId === editUser.id}>
                  <SelectTrigger><SelectValue placeholder="Select manager" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Manager</SelectItem>
                    {/* All active users except the user being edited can be a manager */}
                    {managers.filter(u => u.id !== editUser.id).map(m => (
                      <SelectItem key={m.id} value={m.id}>{m.name} ({m.roles.join(', ')})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteUser} onOpenChange={open => !open && setDeleteUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteUser
                ? `This will permanently delete ${deleteUser.name} (${deleteUser.email}). This action cannot be undone.`
                : 'This action cannot be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionUserId === deleteUser?.id}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDeleteUser}
              disabled={actionUserId === deleteUser?.id}
            >
              {actionUserId === deleteUser?.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete User
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default UserManagement;
