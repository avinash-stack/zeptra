import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Pencil, Trash2, Search } from 'lucide-react';
import type { ExpenseWithDetails, ExpenseStatus, ExpenseCategory } from '@/types/database';

const MyExpenses: React.FC = () => {
  const { user, profile } = useAuth();
  const [expenses, setExpenses] = useState<ExpenseWithDetails[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [editingExpense, setEditingExpense] = useState<ExpenseWithDetails | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editCategoryId, setEditCategoryId] = useState('');

  useEffect(() => {
    fetchExpenses();
    if (profile?.org_id) {
      supabase.from('expense_categories').select('*').eq('org_id', profile.org_id).then(({ data }) => {
        if (data) setCategories(data as ExpenseCategory[]);
      });
    }
  }, [user, statusFilter, profile?.org_id]);

  const fetchExpenses = async () => {
    if (!user) return;
    setLoading(true);
    let query = supabase
      .from('expenses')
      .select('*, users!expenses_user_id_fkey(name, email), expense_categories(name)')
      .eq('user_id', user.id)
      .order('submitted_at', { ascending: false });

    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Error fetching expenses:', error);
      toast.error('Failed to load expenses');
    }
    setExpenses((data as ExpenseWithDetails[]) || []);
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('expenses').delete().eq('id', id);
    if (error) {
      toast.error('Failed to delete expense');
    } else {
      toast.success('Expense deleted');
      fetchExpenses();
    }
  };

  const handleEdit = async () => {
    if (!editingExpense) return;
    const { error } = await supabase.from('expenses').update({
      amount: parseFloat(editAmount),
      description: editDescription,
      category_id: editCategoryId,
    }).eq('id', editingExpense.id);

    if (error) {
      toast.error('Failed to update expense');
    } else {
      toast.success('Expense updated');
      setEditingExpense(null);
      fetchExpenses();
    }
  };

  const openEdit = (expense: ExpenseWithDetails) => {
    setEditingExpense(expense);
    setEditAmount(String(expense.amount));
    setEditDescription(expense.description);
    setEditCategoryId(expense.category_id);
  };

  const filtered = expenses.filter(e =>
    e.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-info bg-clip-text text-transparent">My Expenses</h1>
        <p className="text-muted-foreground mt-1">View and manage your submitted expenses</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search expenses..." className="pl-9" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending_l1">Pending L1</SelectItem>
                <SelectItem value="pending_l2">Pending L2</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No expenses found
                  </TableCell>
                </TableRow>
              ) : filtered.map(expense => (
                <TableRow key={expense.id}>
                  <TableCell>{new Date(expense.submitted_at).toLocaleDateString()}</TableCell>
                  <TableCell>{(expense as any).expense_categories?.name || '-'}</TableCell>
                  <TableCell className="max-w-[200px] truncate">{expense.description}</TableCell>
                  <TableCell className="font-medium">
                    {expense.currency === 'INR' ? '₹' : expense.currency === 'EUR' ? '€' : expense.currency === 'GBP' ? '£' : '$'}
                    {Number(expense.amount).toFixed(2)}
                    <span className="text-xs text-muted-foreground ml-1">{expense.currency}</span>
                  </TableCell>
                  <TableCell><StatusBadge status={expense.status} /></TableCell>
                  <TableCell>
                    {(expense.status === 'pending_l1') && (
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(expense)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(expense.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!editingExpense} onOpenChange={open => !open && setEditingExpense(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Expense</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input type="number" step="0.01" value={editAmount} onChange={e => setEditAmount(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={editCategoryId} onValueChange={setEditCategoryId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {categories.map(cat => (
                    <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={editDescription} onChange={e => setEditDescription(e.target.value)} />
            </div>
            <Button onClick={handleEdit} className="w-full bg-gradient-to-r from-primary to-info">Save Changes</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MyExpenses;
