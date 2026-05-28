import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle, XCircle, ArrowRight, Search } from 'lucide-react';
import { RiskBadge } from '@/components/RiskBadge';
import type { ExpenseWithDetails, Profile } from '@/types/database';

const Approvals: React.FC = () => {
  const { user, hasAnyRole, hasRole } = useAuth();
  const [expenses, setExpenses] = useState<ExpenseWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionExpense, setActionExpense] = useState<ExpenseWithDetails | null>(null);
  const [actionType, setActionType] = useState<'approve' | 'reject' | 'reassign'>('approve');
  const [comments, setComments] = useState('');
  const [reassignTo, setReassignTo] = useState('');
  const [reassignCandidates, setReassignCandidates] = useState<Profile[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const PAGE_SIZE = 25;

  const formatAmount = (amount: number | string, currency?: string) => {
    try {
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: currency || 'INR',
        minimumFractionDigits: 2,
      }).format(Number(amount));
    } catch {
      return `${currency || '₹'} ${Number(amount).toFixed(2)}`;
    }
  };

  const analyzeExpense = async (expenseId: string) => {
    setAnalyzingIds(prev => new Set(prev).add(expenseId));
    try {
      const { data } = await supabase.functions.invoke('analyze-expense', {
        body: { expense_id: expenseId },
      });
      if (data) {
        setExpenses(prev =>
          prev.map(e => e.id === expenseId ? { ...e, ai_analysis: data } : e)
        );
      }
    } catch {
      // Silent fail — AI analysis is advisory only
    } finally {
      setAnalyzingIds(prev => {
        const next = new Set(prev);
        next.delete(expenseId);
        return next;
      });
    }
  };

  useEffect(() => {
    fetchPendingExpenses();
    fetchReassignCandidates();
  }, [user, page]);

  const fetchPendingExpenses = async () => {
    if (!user) return;
    const isFinance = hasAnyRole(['finance']);

    let query = supabase
      .from('expenses')
      .select('*, expense_categories(name), version')
      .in('status', ['pending_l1', 'pending_l2'])
      .order('submitted_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (!isFinance) {
      query = query.eq('current_approver_id', user.id);
    }

    const { data } = await query;
    setHasMore((data || []).length === PAGE_SIZE);

    if (data && data.length > 0) {
      // Enrich with submitter names from public.users
      const userIds = [...new Set(data.map((e: any) => e.user_id))];
      const { data: profiles } = await supabase
        .from('users')
        .select('id, name, email')
        .in('id', userIds);
      const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));
      const enriched = data.map((e: any) => ({
        ...e,
        users: profileMap.get(e.user_id) || null,
      }));
      setExpenses(enriched as ExpenseWithDetails[]);
    } else {
      setExpenses([]);
    }
    setLoading(false);
  };

  const fetchReassignCandidates = async () => {
    // Any active user can be a reassignment target (not just 'manager' role)
    const { data: profiles } = await supabase
      .from('users')
      .select('*')
      .eq('status', 'active')
      .neq('id', user?.id || '')
      .limit(200);
    setReassignCandidates((profiles as Profile[]) || []);
  };

  const handleApprove = async (expense: ExpenseWithDetails) => {
    if (expense.user_id === user!.id) {
      toast.error("You cannot approve or reject your own expense");
      return;
    }
    try {
      let newStatus: string;
      let newApprover: string | null = null;

      if (expense.status === 'pending_l1') {
        const { data: managerProfile } = await supabase
          .from('users')
          .select('manager_id')
          .eq('id', user!.id)
          .single();

        if (!managerProfile?.manager_id) {
          toast.error('No level 2 approver is assigned to your profile');
          return;
        }

        newStatus = 'pending_l2';
        newApprover = managerProfile.manager_id;
      } else if (expense.status === 'pending_l2') {
        newStatus = 'approved';
      } else {
        toast.error('This expense is not pending approval');
        return;
      }

      // Optimistic lock: only update if version and status match what we loaded
      const updatePayload: Record<string, unknown> = {
        status: newStatus,
        current_approver_id: newApprover,
      };
      if (newStatus === 'approved') {
        updatePayload.decided_at = new Date().toISOString();
      }

      const { data: updated, error } = await supabase
        .from('expenses')
        .update(updatePayload)
        .eq('id', expense.id)
        .eq('version', (expense as any).version)
        .eq('status', expense.status)
        .select('id')
        .single();

      if (error || !updated) {
        toast.error('This expense was already actioned by another approver. Refreshing...');
        fetchPendingExpenses();
        return;
      }

      await supabase.from('approval_history').insert({
        expense_id: expense.id,
        approver_id: user!.id,
        action: 'approved',
        level: expense.status === 'pending_l1' ? 1 : 2,
        comments,
      });

      toast.success('Expense approved');
      setActionExpense(null);
      setComments('');
      fetchPendingExpenses();
    } catch (error: any) {
      toast.error(error.message || 'Failed to approve');
    }
  };

  const handleReject = async (expense: ExpenseWithDetails) => {
    if (expense.user_id === user!.id) {
      toast.error("You cannot approve or reject your own expense");
      return;
    }
    try {
      // Optimistic lock: only update if version and status match what we loaded
      const { data: updated, error } = await supabase
        .from('expenses')
        .update({
          status: 'rejected',
          current_approver_id: null,
          decided_at: new Date().toISOString(),
        })
        .eq('id', expense.id)
        .eq('version', (expense as any).version)
        .eq('status', expense.status)
        .select('id')
        .single();

      if (error || !updated) {
        toast.error('This expense was already actioned by another approver. Refreshing...');
        fetchPendingExpenses();
        return;
      }

      await supabase.from('approval_history').insert({
        expense_id: expense.id,
        approver_id: user!.id,
        action: 'rejected',
        level: expense.status === 'pending_l1' ? 1 : 2,
        comments,
      });

      toast.success('Expense rejected');
      setActionExpense(null);
      setComments('');
      fetchPendingExpenses();
    } catch (error: any) {
      toast.error(error.message || 'Failed to reject');
    }
  };

  const handleReassign = async (expense: ExpenseWithDetails) => {
    if (!reassignTo) return;
    try {
      // Optimistic lock: only update if version and status match what we loaded
      const { data: updated, error } = await supabase
        .from('expenses')
        .update({
          current_approver_id: reassignTo,
        })
        .eq('id', expense.id)
        .eq('version', (expense as any).version)
        .eq('status', expense.status)
        .select('id')
        .single();

      if (error || !updated) {
        toast.error('This expense was already actioned by another approver. Refreshing...');
        fetchPendingExpenses();
        return;
      }

      await supabase.from('approval_history').insert({
        expense_id: expense.id,
        approver_id: user!.id,
        action: 'reassigned',
        level: expense.status === 'pending_l1' ? 1 : 2,
        reassigned_to: reassignTo,
        comments,
      });

      toast.success('Expense reassigned');
      setActionExpense(null);
      setComments('');
      setReassignTo('');
      fetchPendingExpenses();
    } catch (error: any) {
      toast.error(error.message || 'Failed to reassign');
    }
  };

  const handleViewReceipt = async (receiptKey: string | null) => {
    if (!receiptKey) return;
    try {
      const { data, error } = await supabase.functions.invoke('get-upload-url', {
        body: { action: 'get_download_url', receipt_key: receiptKey },
      });
      if (error || !data?.download_url) {
        throw new Error(error?.message || 'Failed to get download URL');
      }
      window.open(data.download_url, '_blank');
    } catch (e: any) {
      toast.error(e.message || 'Could not fetch receipt image');
    }
  };

  const openAction = (expense: ExpenseWithDetails, type: 'approve' | 'reject' | 'reassign') => {
    setActionExpense(expense);
    setActionType(type);
    setComments('');
    setReassignTo('');
  };

  // Reset to first page when search changes
  useEffect(() => {
    setPage(0);
  }, [searchTerm]);

  const filtered = expenses.filter(e =>
    (e as any).users?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">Approvals</h1>
        <p className="text-muted-foreground mt-1">Review and approve pending expense requests</p>
      </div>

      <Card>
        <CardHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search by name or description..." className="pl-9" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Submitter</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead>Receipt</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                      Loading approvals...
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                      No pending approvals
                    </TableCell>
                  </TableRow>
                ) : filtered.map(expense => (
                  <TableRow key={expense.id}>
                    <TableCell>{(expense as any).users?.name || '-'}</TableCell>
                    <TableCell>{new Date(expense.submitted_at).toLocaleDateString()}</TableCell>
                    <TableCell>{(expense as any).expense_categories?.name || '-'}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{expense.description}</TableCell>
                    <TableCell>
                      {formatAmount(expense.amount, expense.currency)}
                      <span className="text-xs text-muted-foreground ml-1">{expense.currency}</span>
                    </TableCell>
                    <TableCell>
                      {(expense as any).ai_analysis ? (
                        <RiskBadge analysis={(expense as any).ai_analysis} />
                      ) : analyzingIds.has(expense.id) ? (
                        <RiskBadge analysis={null} loading={true} />
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => analyzeExpense(expense.id)}
                        >
                          Analyze
                        </Button>
                      )}
                    </TableCell>
                    <TableCell>
                      {expense.receipt_url ? (
                        <Button
                          size="sm"
                          variant="link"
                          onClick={() => handleViewReceipt(expense.receipt_url)}
                          className="h-7 px-0 text-xs font-semibold text-primary"
                        >
                          View
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge status={expense.status} managerView={true} />
                        {expense.is_policy_exception && (
                          <Badge variant="outline" className="bg-warning/15 text-warning border-warning/30">
                            <AlertTriangle className="mr-1 h-3 w-3" />
                            Policy exception
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" className="text-success" onClick={() => openAction(expense, 'approve')}>
                          <CheckCircle className="h-4 w-4" />
                        </Button>
                        {(hasAnyRole(['finance']) || hasRole('admin')) && (
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => openAction(expense, 'reject')}>
                            <XCircle className="h-4 w-4" />
                          </Button>
                        )}
                        {!hasAnyRole(['finance']) && (
                          <Button size="sm" variant="ghost" onClick={() => openAction(expense, 'reassign')}>
                            <ArrowRight className="h-4 w-4" />
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

      <Dialog open={!!actionExpense} onOpenChange={open => !open && setActionExpense(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="capitalize">{actionType} Expense</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {actionExpense && (
              <div className="p-3 bg-muted rounded-lg">
                <p className="font-medium">
                  {formatAmount(actionExpense.amount, actionExpense.currency)} {actionExpense.currency}
                </p>
                <p className="text-sm text-muted-foreground">{actionExpense.description}</p>
                {actionExpense.is_policy_exception && (
                  <Badge variant="outline" className="mt-2 bg-warning/15 text-warning border-warning/30">
                    <AlertTriangle className="mr-1 h-3 w-3" />
                    Policy exception
                  </Badge>
                )}
              </div>
            )}
            {actionType === 'reassign' && (
              <div className="space-y-2">
                <Label>Reassign to</Label>
                <Select value={reassignTo} onValueChange={setReassignTo}>
                  <SelectTrigger><SelectValue placeholder="Select user" /></SelectTrigger>
                  <SelectContent>
                    {reassignCandidates.map(m => (
                      <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Comments</Label>
              <Textarea value={comments} onChange={e => setComments(e.target.value)} placeholder="Add comments..." />
            </div>
            <Button
              className={`w-full ${actionType === 'reject' ? 'bg-destructive hover:bg-destructive/90' : 'bg-gradient-to-r from-primary to-accent'}`}
              onClick={() => {
                if (!actionExpense) return;
                if (actionType === 'approve') handleApprove(actionExpense);
                else if (actionType === 'reject' && (hasAnyRole(['finance']) || hasRole('admin'))) handleReject(actionExpense);
                else if (actionType === 'reassign' && !hasAnyRole(['finance'])) handleReassign(actionExpense);
              }}
            >
              {actionType === 'approve' ? 'Approve' : actionType === 'reject' ? 'Reject' : 'Reassign'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Approvals;
