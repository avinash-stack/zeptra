import React, { useEffect, useState } from 'react';
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
import { Loader2, Mail, Pencil, Plus, Search, Trash2, UserCheck, UserX } from 'lucide-react';
import type { Profile, AppRole } from '@/types/database';

interface UserWithRoles extends Profile {
  roles: AppRole[];
  managerName?: string;
}

const UserManagement: React.FC = () => {
  const { profile: currentProfile, roles } = useAuth();
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

  useEffect(() => {
    fetchUsers();
  }, []);

  const isAdmin = roles.includes('admin');
  const isHr = roles.includes('hr');
  const canInviteUsers = isAdmin || isHr;
  const canToggleUsers = isAdmin || isHr;
  const canEditUsers = isAdmin;
  const canResetPasswords = isAdmin;
  const canDeleteUsers = isAdmin;

  const fetchUsers = async () => {
    const { data: profiles } = await supabase.from('users').select('*').order('name');
    const { data: roles } = await supabase.from('user_roles').select('*');

    if (profiles) {
      const usersWithRoles: UserWithRoles[] = (profiles as Profile[]).map(p => ({
        ...p,
        roles: (roles as any[] || []).filter(r => r.user_id === p.id).map(r => r.role),
        managerName: profiles.find(pp => pp.id === p.manager_id)?.name || undefined,
      }));
      // Show ALL users including Owner/Admin
      setUsers(usersWithRoles);
    }
    setLoading(false);
  };

  const handleCreateUser = async () => {
    if (!newName.trim() || !newEmail.trim()) {
      toast.error('Name and email are required');
      return;
    }

    setCreatingUser(true);
    try {
      const redirectTo = (import.meta.env.VITE_INVITE_REDIRECT_TO as string | undefined) || `${window.location.origin}/set-password`;
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

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success(`Invite sent to ${newEmail}. User can activate from email.`);
      setShowCreateDialog(false);
      resetForm();
      fetchUsers();
    } catch (error: unknown) {
      let message = error instanceof Error ? error.message : 'Failed to send invite';

      if (error instanceof Error && error.name === 'FunctionsFetchError') {
        message = 'Could not reach the invite Edge Function. Redeploy `invite-user` and confirm its CORS/env settings are configured in Supabase.';
      }

      toast.error(message);
    } finally {
      setCreatingUser(false);
    }
  };

  const toggleUserStatus = async (userId: string, currentStatus: string) => {
    setActionUserId(userId);
    const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
    const { error } = await supabase.from('users').update({ status: newStatus }).eq('id', userId);
    if (error) {
      toast.error('Failed to update user status');
    } else {
      toast.success(`User ${newStatus === 'active' ? 'activated' : 'deactivated'}`);
      fetchUsers();
    }
    setActionUserId(null);
  };

  const updateUserRole = async (userId: string, role: AppRole) => {
    // Delete existing roles and insert new one
    await supabase.from('user_roles').delete().eq('user_id', userId);
    await supabase.from('user_roles').insert({ user_id: userId, role });
    toast.success('Role updated');
    fetchUsers();
    setEditUser(null);
  };

  const resetUserPassword = async (user: UserWithRoles) => {
    setActionUserId(user.id);
    try {
      const redirectTo = (import.meta.env.VITE_INVITE_REDIRECT_TO as string | undefined) || `${window.location.origin}/set-password`;
      const { data, error } = await supabase.functions.invoke('manage-user', {
        body: {
          action: 'reset_password',
          user_id: user.id,
          email: user.email,
          redirect_to: redirectTo,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success(`Password reset email sent to ${user.email}`);
    } catch (error: unknown) {
      let message = error instanceof Error ? error.message : 'Failed to reset password';

      if (error instanceof Error && error.name === 'FunctionsFetchError') {
        message = 'Could not reach the `manage-user` Edge Function. Deploy `manage-user` and confirm its CORS/env settings are configured in Supabase.';
      }

      toast.error(message);
    } finally {
      setActionUserId(null);
    }
  };

  const confirmDeleteUser = async () => {
    if (!deleteUser) return;

    setActionUserId(deleteUser.id);
    try {
      const { data, error } = await supabase.functions.invoke('manage-user', {
        body: {
          action: 'delete',
          user_id: deleteUser.id,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success(`Deleted ${deleteUser.email}`);
      setDeleteUser(null);
      fetchUsers();
    } catch (error: unknown) {
      let message = error instanceof Error ? error.message : 'Failed to delete user';

      if (error instanceof Error && error.name === 'FunctionsFetchError') {
        message = 'Could not reach the `manage-user` Edge Function. Deploy `manage-user` and confirm its CORS/env settings are configured in Supabase.';
      }

      toast.error(message);
    } finally {
      setActionUserId(null);
    }
  };

  const updateUserManager = async (userId: string, managerId: string) => {
    await supabase.from('users').update({ manager_id: managerId || null }).eq('id', userId);
    toast.success('Manager updated');
    fetchUsers();
    setEditUser(null);
  };

  const resetForm = () => {
    setNewName('');
    setNewEmail('');
    setNewRole('employee');
    setNewManagerId('none');
    setNewTag('');
  };

  const filtered = users.filter(u =>
    u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

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
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-info bg-clip-text text-transparent">User Management</h1>
          <p className="text-muted-foreground mt-1">{isAdmin ? 'Manage users, roles, and assignments' : 'Invite users and manage active status'}</p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} className="bg-gradient-to-r from-primary to-info" disabled={!canInviteUsers}>
          <Plus className="h-4 w-4 mr-2" />
          Invite User
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search users..." className="pl-9" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
        </CardHeader>
        <CardContent>
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
                      {canEditUsers && (
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
        </CardContent>
      </Card>

      {/* Create User Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
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
                  {users.filter(u => u.status === 'active').map(m => (
                    <SelectItem key={m.id} value={m.id}>{m.name} ({m.roles.join(', ')})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleCreateUser} disabled={creatingUser} className="w-full bg-gradient-to-r from-primary to-info">
              {creatingUser && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send Activation Invite
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={!!editUser} onOpenChange={open => !open && setEditUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User - {editUser?.name}</DialogTitle>
          </DialogHeader>
          {editUser && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Role</Label>
                <Select defaultValue={editUser.roles[0]} onValueChange={v => updateUserRole(editUser.id, v as AppRole)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {adminAssignableRoles.map(role => (
                      <SelectItem key={role} value={role}>
                        {role === 'hr' ? 'HR' : role.charAt(0).toUpperCase() + role.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Manager</Label>
                <Select defaultValue={editUser.manager_id || 'none'} onValueChange={v => updateUserManager(editUser.id, v === 'none' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Select manager" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Manager</SelectItem>
                    {/* All active users except the user being edited can be a manager */}
                    {users.filter(u => u.id !== editUser.id && u.status === 'active').map(m => (
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
