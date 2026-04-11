import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { toast } from 'sonner';
import { Loader2, Upload, DollarSign } from 'lucide-react';
import type { ExpenseCategory, OrgCurrency } from '@/types/database';

const SubmitExpense: React.FC = () => {
  const { user, profile } = useAuth();
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [receipt, setReceipt] = useState<File | null>(null);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [currencies, setCurrencies] = useState<OrgCurrency[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!profile?.org_id) return;

    // Fetch active categories for the org
    supabase
      .from('expense_categories')
      .select('*')
      .eq('org_id', profile.org_id)
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => {
        if (data) setCategories(data as ExpenseCategory[]);
      });

    // Fetch org currencies
    supabase
      .from('org_currencies')
      .select('*')
      .eq('org_id', profile.org_id)
      .order('code')
      .then(({ data }) => {
        if (data) {
          setCurrencies(data as OrgCurrency[]);
          const defaultCurr = (data as OrgCurrency[]).find(c => c.is_default);
          if (defaultCurr) setCurrency(defaultCurr.code);
          else if (data.length > 0) setCurrency((data[0] as OrgCurrency).code);
        }
      });
  }, [profile?.org_id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!categoryId) {
      toast.error('Please select a category');
      return;
    }
    setLoading(true);

    try {
      let receiptUrl = null;
      if (receipt) {
        const ext = receipt.name.split('.').pop();
        const path = `${user.id}/${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from('receipts').upload(path, receipt);
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from('receipts').getPublicUrl(path);
        receiptUrl = urlData.publicUrl;
      }

      // Get manager for L1 approval
      const { data: profileData } = await supabase
        .from('users')
        .select('manager_id')
        .eq('id', user.id)
        .single();

      const { error } = await supabase.from('expenses').insert({
        user_id: user.id,
        amount: parseFloat(amount),
        currency: currency || 'INR',
        category_id: categoryId,
        description,
        receipt_url: receiptUrl,
        status: 'pending_l1',
        current_approver_id: profileData?.manager_id || null,
        submitted_at: new Date().toISOString(),
      });

      if (error) throw error;

      toast.success('Expense submitted successfully!');
      setAmount('');
      setCategoryId('');
      setDescription('');
      setReceipt(null);
    } catch (error: any) {
      toast.error(error.message || 'Failed to submit expense');
    } finally {
      setLoading(false);
    }
  };

  // Find the symbol for the selected currency
  const selectedCurr = currencies.find(c => c.code === currency);
  const currSymbol = selectedCurr?.symbol || '$';

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-info bg-clip-text text-transparent">
          Submit Expense
        </h1>
        <p className="text-muted-foreground mt-1">Fill in the details to submit a new expense report</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="amount">Amount</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-medium">
                    {currSymbol}
                  </span>
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    className="pl-8"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="currency">Currency</Label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select currency" />
                  </SelectTrigger>
                  <SelectContent>
                    {currencies.map(curr => (
                      <SelectItem key={curr.id} value={curr.code}>
                        {curr.symbol} {curr.code} — {curr.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <Select value={categoryId} onValueChange={setCategoryId} required>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map(cat => (
                    <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Describe the expense..."
                rows={3}
                value={description}
                onChange={e => setDescription(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="receipt">Receipt</Label>
              <div className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => document.getElementById('receipt-input')?.click()}>
                <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  {receipt ? receipt.name : 'Click to upload or drag and drop'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">PDF, PNG, JPG up to 10MB</p>
                <input
                  id="receipt-input"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  className="hidden"
                  onChange={e => setReceipt(e.target.files?.[0] || null)}
                />
              </div>
            </div>

            <Button type="submit" className="w-full bg-gradient-to-r from-primary to-info" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit Expense
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default SubmitExpense;
