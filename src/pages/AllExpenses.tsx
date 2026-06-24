import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Search, CheckCircle, XCircle, Download, Loader2, DollarSign } from 'lucide-react';
import { toast } from 'sonner';
import { exportToCSV, exportToTallyXML } from '@/lib/exportUtils';
import { logExport } from '@/lib/auditLogger';
import type { ExpenseWithDetails, Profile } from '@/types/database';

type FinanceExpenseStatus = 'pending_l1' | 'pending_l2' | 'approved' | 'rejected' | 'reimbursed';
type FinanceExpense = Omit<ExpenseWithDetails, 'status'> & { status: FinanceExpenseStatus };
type FinanceActionStatus = 'approved' | 'rejected' | 'reimbursed';

const STATUS_GROUPS: Array<{ status: FinanceExpenseStatus; title: string }> = [
  { status: 'pending_l1', title: 'Pending Manager Review' },
  { status: 'pending_l2', title: 'Pending Finance Review' },
  { status: 'approved', title: 'Approved' },
  { status: 'rejected', title: 'Rejected' },
  { status: 'reimbursed', title: 'Reimbursed' },
];

const getErrorMessage = (error: unknown, fallback: string) => {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return fallback;
};

const AllExpenses: React.FC = () => {
  const { user, hasAnyRole, organization } = useAuth();
  const isFinance = hasAnyRole(['finance']);

  const [expenses, setExpenses] = useState<FinanceExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [employeeOptions, setEmployeeOptions] = useState<Pick<Profile, 'id' | 'name' | 'email'>[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionExpense, setActionExpense] = useState<FinanceExpense | null>(null);
  const [actionStatus, setActionStatus] = useState<FinanceActionStatus>('rejected');
  const [actionNote, setActionNote] = useState('');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const PAGE_SIZE = 50;

  useEffect(() => {
    fetchExpenses();
  }, [statusFilter, employeeFilter, page]);

  useEffect(() => {
    const fetchEmployeeOptions = async () => {
      if (!organization) return;

      const { data, error } = await supabase
        .from('users')
        .select('id, name, email')
        .eq('org_id', organization.id)
        .order('name', { ascending: true });

      if (error) {
        toast.error(error.message || 'Failed to load employee filter');
        return;
      }

      setEmployeeOptions((data as Pick<Profile, 'id' | 'name' | 'email'>[]) || []);
    };

    fetchEmployeeOptions();
  }, [organization]);

  const fetchExpenses = async () => {
    setLoading(true);
    let query = supabase
      .from('expenses')
      .select('*, expense_categories(name, gl_code)', { count: 'exact' })
      .order('submitted_at', { ascending: false });

    if (statusFilter !== 'all') query = query.eq('status', statusFilter);
    if (employeeFilter !== 'all') query = query.eq('user_id', employeeFilter);

    const { data, error, count } = await query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (error) {
      console.error('Failed to fetch expenses:', error);
      setLoading(false);
      return;
    }

    setTotalCount(count ?? 0);

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
      setExpenses(enriched as unknown as FinanceExpense[]);
    } else {
      setExpenses([]);
    }
    setLoading(false);
  };

  const fetchAllForExport = async (): Promise<ExpenseWithDetails[]> => {
    const all: any[] = [];
    let from = 0;
    const BATCH = 1000;
    while (true) {
      let q = supabase
        .from('expenses')
        .select('*, expense_categories(name, gl_code)')
        .order('submitted_at', { ascending: false })
        .range(from, from + BATCH - 1);
      if (statusFilter !== 'all') q = q.eq('status', statusFilter);
      const { data, error } = await q;
      if (error || !data?.length) break;
      all.push(...data);
      if (data.length < BATCH) break;
      from += BATCH;
    }
    // Enrich with submitter names
    if (all.length > 0) {
      const userIds = [...new Set(all.map(e => e.user_id))];
      const { data: profiles } = await supabase
        .from('users')
        .select('id, name, email')
        .in('id', userIds);
      const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));
      return all.map(e => ({ ...e, users: profileMap.get(e.user_id) || null })) as ExpenseWithDetails[];
    }
    return [];
  };

  const filtered = expenses.filter(e =>
    (e as any).users?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const visibleStatusGroups = STATUS_GROUPS.filter(group =>
    statusFilter === 'all' || group.status === statusFilter
  );

  const renderStatusBadge = (status: FinanceExpenseStatus) => {
    if (status === 'reimbursed') {
      return (
        <Badge variant="outline" className="bg-primary/15 text-primary border-primary/30 font-medium">
          Reimbursed
        </Badge>
      );
    }

    return <StatusBadge status={status} managerView={true} />;
  };

  const handleFinanceStatusChange = async (
    expense: FinanceExpense,
    newStatus: FinanceActionStatus,
    note: string
  ) => {
    if (expense.status === 'reimbursed') {
      toast.error('Reimbursed expenses are final and cannot be changed');
      return;
    }

    if (newStatus === 'reimbursed' && expense.status !== 'approved') {
      toast.error('Only approved expenses can be marked as reimbursed');
      return;
    }

    try {
      const updatePayload: Record<string, unknown> = {
        status: newStatus,
        current_approver_id: null,
      };
      if (newStatus === 'approved' || newStatus === 'rejected') {
        updatePayload.decided_at = new Date().toISOString();
      }

      const { data: updatedExpense, error: updateError } = await supabase
        .from('expenses')
        .update(updatePayload)
        .eq('id', expense.id)
        .eq('version', expense.version)
        .eq('status', expense.status)
        .select('id')
        .single();

      if (updateError || !updatedExpense) {
        toast.error('Expense was changed by another approver. Refreshing...');
        fetchExpenses();
        return;
      }

      const { error: historyError } = await supabase.from('approval_history').insert({
        expense_id: expense.id,
        approver_id: user!.id,
        action: newStatus,
        level: expense.status === 'pending_l1' ? 1 : 2,
        comments: note,
      });

      if (historyError) {
        throw historyError;
      }

      toast.success(
        newStatus === 'approved'
          ? 'Expense approved'
          : newStatus === 'rejected'
            ? 'Expense rejected'
            : 'Expense marked as reimbursed'
      );
      setActionExpense(null);
      setActionNote('');
      fetchExpenses();
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, 'Failed to update expense status'));
    }
  };

  const openFinanceAction = (expense: FinanceExpense, newStatus: FinanceActionStatus) => {
    setActionExpense(expense);
    setActionStatus(newStatus);
    setActionNote('');
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

  const handleExportCSV = async () => {
    toast.info('Preparing export…');
    const allExpenses = await fetchAllForExport();
    if (!allExpenses.length) { toast.error('No expenses to export'); return; }
    exportToCSV(allExpenses, organization?.name || 'Zeptra');
    toast.success(`Exported ${allExpenses.length} expenses as CSV`);
    if (user && organization) {
      logExport({ org_id: organization.id, actor_id: user.id,
        export_type: 'csv', record_count: allExpenses.length });
    }
  };

  const handleExportTally = async () => {
    toast.info('Preparing export…');
    const allExpenses = await fetchAllForExport();
    const approved = allExpenses.filter(e => e.status === 'approved');
    if (!approved.length) { toast.error('No approved expenses to export for Tally'); return; }
    exportToTallyXML(allExpenses, organization?.name || 'Zeptra');
    toast.success(`Exported ${approved.length} approved expenses as Tally XML`);
    if (user && organization) {
      logExport({ org_id: organization.id, actor_id: user.id,
        export_type: 'tally_xml', record_count: approved.length });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">All Expenses</h1>
          <p className="text-muted-foreground mt-1">Organization-wide expense view</p>
        </div>
        {(hasAnyRole(['admin', 'finance'])) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Download className="mr-2 h-4 w-4" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleExportCSV}>
                Export CSV (QuickBooks)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportTally}>
                Export Tally XML
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <Card>
        <CardHeader>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_200px_220px]">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search..." className="pl-9" value={searchTerm} onChange={e => { setSearchTerm(e.target.value); setPage(0); }} />
            </div>
            <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(0); }}>
              <SelectTrigger>
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending_l1">Awaiting approval</SelectItem>
                <SelectItem value="pending_l2">Under review</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="reimbursed">Reimbursed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={employeeFilter} onValueChange={v => { setEmployeeFilter(v); setPage(0); }}>
              <SelectTrigger>
                <SelectValue placeholder="Filter by employee" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Employees</SelectItem>
                {employeeOptions.map(employee => (
                  <SelectItem key={employee.id} value={employee.id}>
                    {employee.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
      </Card>

      {loading ? (
        <Card>
          <CardContent className="py-12">
            <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
          </CardContent>
        </Card>
      ) : visibleStatusGroups.map(group => {
        const groupExpenses = filtered.filter(expense => expense.status === group.status);

        return (
          <Card key={group.status}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-lg">{group.title}</CardTitle>
                {renderStatusBadge(group.status)}
                <Badge variant="secondary">{groupExpenses.length}</Badge>
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
                      <TableHead>Receipt</TableHead>
                      <TableHead>Status</TableHead>
                      {isFinance && <TableHead>Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groupExpenses.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={isFinance ? 8 : 7} className="text-center py-8 text-muted-foreground">
                          No records found
                        </TableCell>
                      </TableRow>
                    ) : groupExpenses.map(expense => (
                      <TableRow key={expense.id}>
                        <TableCell>{(expense as any).users?.name || '-'}</TableCell>
                        <TableCell>{new Date(expense.submitted_at).toLocaleDateString()}</TableCell>
                        <TableCell>{(expense as any).expense_categories?.name || '-'}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{expense.description}</TableCell>
                        <TableCell className="font-medium">
                          {expense.currency === 'INR' ? '₹' : expense.currency === 'EUR' ? '€' : expense.currency === 'GBP' ? '£' : '$'}
                          {Number(expense.amount).toFixed(2)}
                          <span className="text-xs text-muted-foreground ml-1">{expense.currency}</span>
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
                            {renderStatusBadge(expense.status)}
                            {expense.is_policy_exception && (
                              <Badge variant="outline" className="bg-warning/15 text-warning border-warning/30">
                                <AlertTriangle className="mr-1 h-3 w-3" />
                                Policy exception
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        {isFinance && (
                          <TableCell>
                            {expense.status === 'reimbursed' ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {(expense.status === 'pending_l1' ||
                                  expense.status === 'pending_l2' ||
                                  expense.status === 'rejected') && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-success"
                                    onClick={() => openFinanceAction(expense, 'approved')}
                                  >
                                    <CheckCircle className="mr-1 h-4 w-4" />
                                    Approve
                                  </Button>
                                )}
                                {(expense.status === 'pending_l1' ||
                                  expense.status === 'pending_l2' ||
                                  expense.status === 'approved') && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-destructive"
                                    onClick={() => openFinanceAction(expense, 'rejected')}
                                  >
                                    <XCircle className="mr-1 h-4 w-4" />
                                    Reject
                                  </Button>
                                )}
                                {expense.status === 'approved' && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => openFinanceAction(expense, 'reimbursed')}
                                  >
                                    <DollarSign className="mr-1 h-4 w-4" />
                                    Mark Reimbursed
                                  </Button>
                                )}
                              </div>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between px-1">
            <p className="text-sm text-muted-foreground">
              {totalCount > 0
                ? `Showing ${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, totalCount)} of ${totalCount}`
                : 'No expenses found'}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm"
                onClick={() => setPage(p => p - 1)}
                disabled={page === 0 || loading}>
                ← Previous
              </Button>
              <Button variant="outline" size="sm"
                onClick={() => setPage(p => p + 1)}
                disabled={(page + 1) * PAGE_SIZE >= totalCount || loading}>
                Next →
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={!!actionExpense}
        onOpenChange={open => {
          if (!open) {
            setActionExpense(null);
            setActionNote('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionStatus === 'approved'
                ? 'Approve Expense'
                : actionStatus === 'rejected'
                  ? 'Reject Expense'
                  : 'Mark Expense Reimbursed'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {actionExpense && (
              <div className="rounded-lg bg-muted p-3">
                <p className="font-medium">{actionExpense.description}</p>
                <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <span>Current status:</span>
                  {renderStatusBadge(actionExpense.status)}
                </div>
              </div>
            )}
            {actionStatus === 'reimbursed' && (
              <p className="text-sm text-destructive">
                This action is terminal and cannot be reversed.
              </p>
            )}
            <div className="space-y-2">
              <Label>{actionStatus === 'reimbursed' ? 'Comments (required)' : 'Comments'}</Label>
              <Textarea
                value={actionNote}
                onChange={e => setActionNote(e.target.value)}
                placeholder={
                  actionStatus === 'approved'
                    ? 'Optional approval note...'
                    : actionStatus === 'rejected'
                      ? 'Reason for rejection...'
                      : 'Add reimbursement confirmation details...'
                }
              />
            </div>
            <Button
              className={`w-full ${
                actionStatus === 'rejected' || actionStatus === 'reimbursed'
                  ? 'bg-destructive hover:bg-destructive/90'
                  : 'bg-success hover:bg-success/90'
              }`}
              disabled={actionStatus === 'reimbursed' && !actionNote.trim()}
              onClick={() => {
                if (!actionExpense) return;
                handleFinanceStatusChange(actionExpense, actionStatus, actionNote.trim());
              }}
            >
              {actionStatus === 'approved'
                ? 'Approve Expense'
                : actionStatus === 'rejected'
                  ? 'Reject Expense'
                  : 'Confirm Reimbursement'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AllExpenses;
