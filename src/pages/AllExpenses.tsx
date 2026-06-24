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
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Search, CheckCircle, XCircle, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { exportToCSV, exportToTallyXML } from '@/lib/exportUtils';
import { logExport } from '@/lib/auditLogger';
import type { ExpenseWithDetails } from '@/types/database';

const AllExpenses: React.FC = () => {
  const { user, hasAnyRole, organization } = useAuth();
  const isFinance = hasAnyRole(['finance']);

  const [expenses, setExpenses] = useState<ExpenseWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [rejectExpense, setRejectExpense] = useState<ExpenseWithDetails | null>(null);
  const [rejectComment, setRejectComment] = useState('');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const PAGE_SIZE = 50;

  useEffect(() => {
    fetchExpenses();
  }, [statusFilter, page]);

  const fetchExpenses = async () => {
    setLoading(true);
    let query = supabase
      .from('expenses')
      .select('*, expense_categories(name, gl_code)', { count: 'exact' })
      .order('submitted_at', { ascending: false });

    if (statusFilter !== 'all') query = query.eq('status', statusFilter);

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
      setExpenses(enriched as ExpenseWithDetails[]);
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

  const handleFinanceApprove = async (expense: ExpenseWithDetails) => {
    if (expense.user_id === user?.id) {
      toast.error('You cannot approve your own expense');
      return;
    }
    if (expense.status !== 'pending_l2' && expense.status !== 'pending_l1') {
      toast.error('Expense must be pending approval');
      return;
    }
    try {
      const { data: updatedExpense, error: updateError } = await supabase.from('expenses').update({
        status: 'approved',
        current_approver_id: null,
        decided_at: new Date().toISOString(),
      })
        .eq('id', expense.id)
        .eq('version', expense.version)
        .eq('status', expense.status)
        .select('id')
        .single();

      if (updateError || !updatedExpense) {
        throw new Error(updateError?.message || 'Expense was changed by another approver. Refresh and try again.');
      }

      await supabase.from('approval_history').insert({
        expense_id: expense.id,
        approver_id: user!.id,
        action: 'approved',
        level: 2,
      });
      toast.success('Expense approved');
      fetchExpenses();
    } catch (e: any) {
      toast.error(e.message || 'Failed to approve');
    }
  };

  const handleFinanceReject = async () => {
    if (!rejectExpense) return;
    if (rejectExpense.user_id === user?.id) {
      toast.error('You cannot reject your own expense');
      return;
    }
    try {
      const { data: updatedExpense, error: updateError } = await supabase.from('expenses').update({
        status: 'rejected',
        current_approver_id: null,
        decided_at: new Date().toISOString(),
      })
        .eq('id', rejectExpense.id)
        .eq('version', rejectExpense.version)
        .eq('status', rejectExpense.status)
        .select('id')
        .single();

      if (updateError || !updatedExpense) {
        throw new Error(updateError?.message || 'Expense was changed by another approver. Refresh and try again.');
      }

      await supabase.from('approval_history').insert({
        expense_id: rejectExpense.id,
        approver_id: user!.id,
        action: 'rejected',
        level: rejectExpense.status === 'pending_l1' ? 1 : 2,
        comments: rejectComment,
      });
      toast.success('Expense rejected');
      setRejectExpense(null);
      setRejectComment('');
      fetchExpenses();
    } catch (e: any) {
      toast.error(e.message || 'Failed to reject');
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
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search..." className="pl-9" value={searchTerm} onChange={e => { setSearchTerm(e.target.value); setPage(0); }} />
            </div>
            <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(0); }}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending_l1">Awaiting approval</SelectItem>
                <SelectItem value="pending_l2">Under review</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
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
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={isFinance ? 8 : 7} className="text-center py-8">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground"/>
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={isFinance ? 8 : 7} className="text-center py-8 text-muted-foreground">
                      No records found
                    </TableCell>
                  </TableRow>
                ) : filtered.map(expense => (
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
                        <StatusBadge status={expense.status} managerView={true} />
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
                        {(expense.status === 'pending_l1' || expense.status === 'pending_l2') && (
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" className="text-success" onClick={() => handleFinanceApprove(expense)}>
                              <CheckCircle className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setRejectExpense(expense)}>
                              <XCircle className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between mt-4 px-1">
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

      <Dialog open={!!rejectExpense} onOpenChange={open => !open && setRejectExpense(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Expense</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Comments</Label>
              <Textarea value={rejectComment} onChange={e => setRejectComment(e.target.value)} placeholder="Reason for rejection..." />
            </div>
            <Button className="w-full bg-destructive hover:bg-destructive/90" onClick={handleFinanceReject}>
              Reject Expense
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AllExpenses;
