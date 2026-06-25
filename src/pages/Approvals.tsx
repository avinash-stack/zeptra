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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle, XCircle, ArrowRight, Search } from 'lucide-react';
import { RiskBadge } from '@/components/RiskBadge';
import type { ExpenseWithDetails, Profile } from '@/types/database';

type TeamHistoryStatus = 'all' | 'pending_l1' | 'pending_l2' | 'approved' | 'rejected' | 'reimbursed';
type DecisionStatus = 'approved' | 'rejected';
type TeamHistoryExpenseRow = Omit<ExpenseWithDetails, 'status'> & { status: string };
type SubmitterProfile = Pick<Profile, 'id' | 'name' | 'email'>;
type DecisionHistoryRow = { expense_id: string; level: number; acted_at: string };

const getErrorMessage = (error: unknown, fallback: string) => {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return fallback;
};

const Approvals: React.FC = () => {
  const { user, hasAnyRole, hasRole, profileReady, roles } = useAuth();
  const [activeTab, setActiveTab] = useState('pending');
  const [expenses, setExpenses] = useState<ExpenseWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionExpense, setActionExpense] = useState<ExpenseWithDetails | null>(null);
  const [actionType, setActionType] = useState<'approve' | 'reject' | 'reassign' | 'reverse'>('approve');
  const [comments, setComments] = useState('');
  const [reassignTo, setReassignTo] = useState('');
  const [reassignCandidates, setReassignCandidates] = useState<Profile[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [teamMembers, setTeamMembers] = useState<Profile[]>([]);
  const [teamMembersLoaded, setTeamMembersLoaded] = useState(false);
  const [teamHistoryExpenses, setTeamHistoryExpenses] = useState<ExpenseWithDetails[]>([]);
  const [teamHistoryLoading, setTeamHistoryLoading] = useState(false);
  const [teamHistoryPage, setTeamHistoryPage] = useState(0);
  const [teamHistoryTotalCount, setTeamHistoryTotalCount] = useState(0);
  const [teamEmployeeFilter, setTeamEmployeeFilter] = useState('all');
  const [teamStatusFilter, setTeamStatusFilter] = useState<TeamHistoryStatus>('all');
  const [reversibleExpenseLevels, setReversibleExpenseLevels] = useState<Map<string, number>>(new Map());
  const [reverseStatus, setReverseStatus] = useState<DecisionStatus>('approved');
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

  const renderStatusBadge = (status: string) => {
    if (status === 'reimbursed') {
      return (
        <Badge variant="outline" className="bg-primary/15 text-primary border-primary/30 font-medium">
          Reimbursed
        </Badge>
      );
    }

    return <StatusBadge status={status as ExpenseWithDetails['status']} managerView={true} />;
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
    if (!profileReady) return; // wait until auth data (roles) is ready
    fetchPendingExpenses();
    fetchReassignCandidates();
  }, [user, page, profileReady, roles]);

  useEffect(() => {
    if (!profileReady || !user) return;
    fetchTeamMembers();
  }, [user, profileReady]);

  useEffect(() => {
    if (activeTab !== 'team-history' || !profileReady || !teamMembersLoaded) return;
    fetchTeamHistoryExpenses();
  }, [
    activeTab,
    profileReady,
    teamMembersLoaded,
    teamMembers,
    teamHistoryPage,
    teamEmployeeFilter,
    teamStatusFilter,
  ]);

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

  const fetchTeamMembers = async () => {
    if (!user) return;
    setTeamMembersLoaded(false);

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('manager_id', user.id)
      .order('name', { ascending: true });

    if (error) {
      toast.error(error.message || 'Failed to load team members');
      setTeamMembers([]);
    } else {
      setTeamMembers((data as Profile[]) || []);
    }
    setTeamMembersLoaded(true);
  };

  const fetchTeamHistoryExpenses = async () => {
    if (!user) return;

    const teamMemberIds = teamMembers.map(member => member.id);
    if (teamMemberIds.length === 0) {
      setTeamHistoryExpenses([]);
      setTeamHistoryTotalCount(0);
      setReversibleExpenseLevels(new Map());
      setTeamHistoryLoading(false);
      return;
    }

    setTeamHistoryLoading(true);

    try {
      let query = supabase
        .from('expenses')
        .select('*, expense_categories(name), version', { count: 'exact' })
        .in('user_id', teamMemberIds)
        .order('submitted_at', { ascending: false });

      if (teamEmployeeFilter !== 'all') {
        query = query.eq('user_id', teamEmployeeFilter);
      }

      if (teamStatusFilter !== 'all') {
        query = query.eq('status', teamStatusFilter);
      }

      const { data, error, count } = await query.range(
        teamHistoryPage * PAGE_SIZE,
        (teamHistoryPage + 1) * PAGE_SIZE - 1
      );

      if (error) {
        throw error;
      }

      setTeamHistoryTotalCount(count ?? 0);

      if (data && data.length > 0) {
        const historyRows = data as TeamHistoryExpenseRow[];

        // Enrich with submitter names from public.users
        const userIds = [...new Set(historyRows.map(expense => expense.user_id))];
        const { data: profiles, error: profilesError } = await supabase
          .from('users')
          .select('id, name, email')
          .in('id', userIds);

        if (profilesError) {
          throw profilesError;
        }

        const profileRows = (profiles || []) as SubmitterProfile[];
        const profileMap = new Map(profileRows.map(profile => [profile.id, profile]));
        const enriched = historyRows.map(expense => ({
          ...expense,
          users: profileMap.get(expense.user_id) || null,
        }));
        setTeamHistoryExpenses(enriched as unknown as ExpenseWithDetails[]);

        const decidedExpenseIds = historyRows
          .filter(expense => expense.status === 'approved' || expense.status === 'rejected')
          .map(expense => expense.id);

        if (decidedExpenseIds.length > 0) {
          const { data: decisionHistory, error: historyError } = await supabase
            .from('approval_history')
            .select('expense_id, level, acted_at')
            .eq('approver_id', user.id)
            .in('expense_id', decidedExpenseIds)
            .in('action', ['approved', 'rejected'])
            .order('acted_at', { ascending: false });

          if (historyError) {
            throw historyError;
          }

          const decisionLevels = new Map<string, number>();
          const decisionHistoryRows = (decisionHistory || []) as DecisionHistoryRow[];
          decisionHistoryRows.forEach(entry => {
            if (!decisionLevels.has(entry.expense_id)) {
              decisionLevels.set(entry.expense_id, entry.level);
            }
          });
          setReversibleExpenseLevels(decisionLevels);
        } else {
          setReversibleExpenseLevels(new Map());
        }
      } else {
        setTeamHistoryExpenses([]);
        setReversibleExpenseLevels(new Map());
      }
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to load team history'));
      setTeamHistoryExpenses([]);
      setTeamHistoryTotalCount(0);
      setReversibleExpenseLevels(new Map());
    } finally {
      setTeamHistoryLoading(false);
    }
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
        const isFinance = hasAnyRole(['finance']);

        if (isFinance) {
          newStatus = 'approved';
          newApprover = null;
        } else {
          const { data: managerProfile } = await supabase
            .from('users')
            .select('manager_id')
            .eq('id', user!.id)
            .single();

          if (!managerProfile?.manager_id) {
            newStatus = 'approved';
            newApprover = null;
          } else {
            newStatus = 'pending_l2';
            newApprover = managerProfile.manager_id;
          }
        }
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

  const handleReverseDecision = async (
    expense: ExpenseWithDetails,
    newStatus: DecisionStatus,
    note: string
  ) => {
    const currentStatus = expense.status as string;

    if (currentStatus === 'reimbursed') {
      toast.error('Reimbursed expenses are final and cannot be changed');
      return;
    }

    if (currentStatus !== 'approved' && currentStatus !== 'rejected') {
      toast.error('Only approved or rejected decisions can be changed');
      return;
    }

    if (currentStatus === newStatus) {
      toast.error(`This expense is already ${newStatus}`);
      return;
    }

    if (!note.trim()) {
      toast.error('A comment explaining the change is required');
      return;
    }

    if (!reversibleExpenseLevels.has(expense.id)) {
      toast.error('You can only edit a decision that you previously made');
      return;
    }

    try {
      const { data: updated, error: updateError } = await supabase
        .from('expenses')
        .update({
          status: newStatus,
          current_approver_id: null,
        })
        .eq('id', expense.id)
        .eq('version', (expense as any).version)
        .eq('status', expense.status)
        .select('id')
        .single();

      if (updateError || !updated) {
        toast.error('This expense was changed by someone else. Refreshing...');
        fetchTeamHistoryExpenses();
        return;
      }

      const auditComment = `Changed from ${currentStatus} to ${newStatus}: ${note.trim()}`;
      const { error: historyError } = await supabase.from('approval_history').insert({
        expense_id: expense.id,
        approver_id: user!.id,
        action: 'decision_reversed',
        level: reversibleExpenseLevels.get(expense.id) ?? 1,
        comments: auditComment,
      });

      if (historyError) {
        throw historyError;
      }

      toast.success(`Expense decision changed to ${newStatus}`);
      setActionExpense(null);
      setComments('');
      fetchTeamHistoryExpenses();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to change expense decision'));
      fetchTeamHistoryExpenses();
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

  const openReverseAction = (expense: ExpenseWithDetails) => {
    if ((expense.status as string) === 'reimbursed') {
      toast.error('Reimbursed expenses are final and cannot be changed');
      return;
    }

    setActionExpense(expense);
    setActionType('reverse');
    setReverseStatus(expense.status === 'approved' ? 'rejected' : 'approved');
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
  const teamHistoryHasMore = (teamHistoryPage + 1) * PAGE_SIZE < teamHistoryTotalCount;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">Approvals</h1>
        <p className="text-muted-foreground mt-1">Review and approve pending expense requests</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full max-w-sm grid-cols-2">
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="team-history">Team History</TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
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
                            {(expense.status === 'pending_l1' || expense.status === 'pending_l2') && (
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
        </TabsContent>

        <TabsContent value="team-history">
          <Card>
            <CardHeader>
              <CardTitle>Team History</CardTitle>
              <div className="grid gap-3 pt-2 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Employee</Label>
                  <Select
                    value={teamEmployeeFilter}
                    onValueChange={value => {
                      setTeamEmployeeFilter(value);
                      setTeamHistoryPage(0);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All employees" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All employees</SelectItem>
                      {teamMembers.map(member => (
                        <SelectItem key={member.id} value={member.id}>
                          {member.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select
                    value={teamStatusFilter}
                    onValueChange={(value: TeamHistoryStatus) => {
                      setTeamStatusFilter(value);
                      setTeamHistoryPage(0);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="pending_l1">{renderStatusBadge('pending_l1')}</SelectItem>
                      <SelectItem value="pending_l2">{renderStatusBadge('pending_l2')}</SelectItem>
                      <SelectItem value="approved">{renderStatusBadge('approved')}</SelectItem>
                      <SelectItem value="rejected">{renderStatusBadge('rejected')}</SelectItem>
                      <SelectItem value="reimbursed">{renderStatusBadge('reimbursed')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
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
                    {!teamMembersLoaded || teamHistoryLoading ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                          Loading team history...
                        </TableCell>
                      </TableRow>
                    ) : teamHistoryExpenses.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                          No team expense history
                        </TableCell>
                      </TableRow>
                    ) : teamHistoryExpenses.map(expense => (
                      <TableRow key={expense.id}>
                        <TableCell>{expense.users?.name || '-'}</TableCell>
                        <TableCell>{new Date(expense.submitted_at).toLocaleDateString()}</TableCell>
                        <TableCell>{expense.expense_categories?.name || '-'}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{expense.description}</TableCell>
                        <TableCell>
                          {formatAmount(expense.amount, expense.currency)}
                          <span className="text-xs text-muted-foreground ml-1">{expense.currency}</span>
                        </TableCell>
                        <TableCell>
                          {expense.ai_analysis ? (
                            <RiskBadge
                              analysis={expense.ai_analysis as React.ComponentProps<typeof RiskBadge>['analysis']}
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
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
                            {renderStatusBadge(expense.status as string)}
                            {expense.is_policy_exception && (
                              <Badge variant="outline" className="bg-warning/15 text-warning border-warning/30">
                                <AlertTriangle className="mr-1 h-3 w-3" />
                                Policy exception
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {((expense.status as string) === 'approved' || (expense.status as string) === 'rejected') &&
                            (expense.status as string) !== 'reimbursed' &&
                            reversibleExpenseLevels.has(expense.id) && (
                              <Button size="sm" variant="outline" onClick={() => openReverseAction(expense)}>
                                Edit Decision
                              </Button>
                            )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-between mt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setTeamHistoryPage(p => p - 1)}
                  disabled={teamHistoryPage === 0}
                >
                  ← Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {teamHistoryPage + 1} · {teamHistoryTotalCount} expenses
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setTeamHistoryPage(p => p + 1)}
                  disabled={!teamHistoryHasMore}
                >
                  Next →
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!actionExpense} onOpenChange={open => !open && setActionExpense(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="capitalize">
              {actionType === 'reverse' ? 'Edit Decision' : `${actionType} Expense`}
            </DialogTitle>
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
            {actionType === 'reverse' && actionExpense && (
              <div className="space-y-2">
                <Label>New status</Label>
                <Select value={reverseStatus} onValueChange={(value: DecisionStatus) => setReverseStatus(value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select new status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="approved" disabled={actionExpense.status === 'approved'}>
                      {renderStatusBadge('approved')}
                    </SelectItem>
                    <SelectItem value="rejected" disabled={actionExpense.status === 'rejected'}>
                      {renderStatusBadge('rejected')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>{actionType === 'reverse' ? 'Comments (required)' : 'Comments'}</Label>
              <Textarea
                value={comments}
                onChange={e => setComments(e.target.value)}
                placeholder={actionType === 'reverse' ? 'Explain why this decision is changing...' : 'Add comments...'}
              />
            </div>
            <Button
              className={`w-full ${
                actionType === 'reject' || (actionType === 'reverse' && reverseStatus === 'rejected')
                  ? 'bg-destructive hover:bg-destructive/90'
                  : 'bg-gradient-to-r from-primary to-accent'
              }`}
              disabled={
                actionType === 'reverse' &&
                (!comments.trim() || !actionExpense || actionExpense.status === reverseStatus)
              }
              onClick={() => {
                if (!actionExpense) return;
                if (actionType === 'approve') handleApprove(actionExpense);
                else if (actionType === 'reject') handleReject(actionExpense);
                else if (actionType === 'reassign' && !hasAnyRole(['finance'])) handleReassign(actionExpense);
                else if (actionType === 'reverse') handleReverseDecision(actionExpense, reverseStatus, comments);
              }}
            >
              {actionType === 'approve'
                ? 'Approve'
                : actionType === 'reject'
                  ? 'Reject'
                  : actionType === 'reassign'
                    ? 'Reassign'
                    : 'Save Decision'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Approvals;
