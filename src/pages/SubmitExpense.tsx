import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { Loader2, Upload, CheckCircle2, AlertTriangle, CheckCircle } from 'lucide-react';
import type { ExpenseCategory, OrgCurrency, CategoryLimit } from '@/types/database';

const SubmitExpense: React.FC = () => {
  const { user, profile } = useAuth();
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [receipt, setReceipt] = useState<File | null>(null);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [currencies, setCurrencies] = useState<OrgCurrency[]>([]);
  const [loading, setLoading] = useState(false);

  // OCR states
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);

  // Policy limit states
  const [categoryLimit, setCategoryLimit] = useState<CategoryLimit | null>(null);
  const [monthlySpend, setMonthlySpend] = useState<number | null>(null);
  const [loadingLimits, setLoadingLimits] = useState(false);

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

  // Fetch category limits when category changes
  useEffect(() => {
    if (!categoryId || !profile?.org_id) {
      setCategoryLimit(null);
      setMonthlySpend(null);
      return;
    }

    const fetchLimits = async () => {
      setLoadingLimits(true);
      try {
        // Get limit config
        const { data: limitData } = await supabase
          .from('category_limits')
          .select('*')
          .eq('org_id', profile.org_id)
          .eq('category_id', categoryId)
          .maybeSingle();

        const limit = limitData as CategoryLimit | null;
        setCategoryLimit(limit);

        // Get monthly spend if there's a monthly limit
        if (limit?.monthly_limit != null) {
          const { data: spendData } = await supabase
            .rpc('get_category_monthly_spend', {
              p_category_id: categoryId,
              p_org_id: profile.org_id,
            });
          const spend = Number(spendData ?? 0);
          setMonthlySpend(Number.isFinite(spend) ? spend : 0);
        } else {
          setMonthlySpend(null);
        }
      } catch (err) {
        console.error('Failed to fetch category limits:', err);
      } finally {
        setLoadingLimits(false);
      }
    };

    fetchLimits();
  }, [categoryId, profile?.org_id]);

  // Compute policy violations
  const parsedAmount = parseFloat(amount) || 0;
  const perExpenseLimit = categoryLimit?.per_expense_limit != null ? Number(categoryLimit.per_expense_limit) : null;
  const monthlyLimit = categoryLimit?.monthly_limit != null ? Number(categoryLimit.monthly_limit) : null;
  const monthlyProjectedSpend = monthlySpend != null ? monthlySpend + parsedAmount : null;
  const perExpenseExceeded = perExpenseLimit != null && parsedAmount > perExpenseLimit;
  const monthlyExceeded = monthlyLimit != null && monthlyProjectedSpend != null && monthlyProjectedSpend > monthlyLimit;
  const monthlyProgress = monthlyLimit != null && monthlySpend != null
    ? monthlyLimit > 0 ? Math.min((monthlySpend / monthlyLimit) * 100, 100) : 100
    : 0;
  const isPolicyException = perExpenseExceeded || monthlyExceeded;

  const uploadReceipt = async (file: File): Promise<string | null> => {
    if (!user) return null;
    try {
      const ext = file.name.split('.').pop();
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('receipts').upload(path, file);
      if (error) return null;
      const { data } = supabase.storage.from('receipts').getPublicUrl(path);
      return data.publicUrl;
    } catch {
      return null;
    }
  };

  const handleReceiptChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setReceipt(file);
    setScanned(false);
    setReceiptUrl(null);
    setScanning(true);
    try {
      const url = await uploadReceipt(file);
      if (!url) return;
      setReceiptUrl(url);
      const { data, error } = await supabase.functions.invoke('ocr-receipt', {
        body: { receipt_url: url },
      });
      if (!error && data) {
        if (data.amount && !amount) setAmount(String(data.amount));
        if (data.date) setExpenseDate(data.date);
        if (data.description && !description) setDescription(data.description);
        if (data.amount || data.date || data.description) {
          toast.info('Receipt scanned — please review the details');
          setScanned(true);
        }
      }
    } catch {
      // OCR failure is silent — never block the user
    } finally {
      setScanning(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!categoryId) {
      toast.error('Please select a category');
      return;
    }
    if (!expenseDate) {
      toast.error('Please select an expense date');
      return;
    }
    setLoading(true);

    try {
      let finalReceiptUrl = receiptUrl;
      if (receipt && !receiptUrl) {
        const ext = receipt.name.split('.').pop();
        const path = `${user.id}/${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from('receipts').upload(path, receipt);
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from('receipts').getPublicUrl(path);
        finalReceiptUrl = urlData.publicUrl;
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
        receipt_url: finalReceiptUrl,
        status: 'pending_l1',
        current_approver_id: profileData?.manager_id || null,
        submitted_at: new Date(`${expenseDate}T12:00:00`).toISOString(),
        is_policy_exception: isPolicyException,
      });

      if (error) throw error;

      toast.success('Expense submitted successfully!');
      setAmount('');
      setCategoryId('');
      setDescription('');
      setExpenseDate(new Date().toISOString().slice(0, 10));
      setReceipt(null);
      setReceiptUrl(null);
      setScanned(false);
      setCategoryLimit(null);
      setMonthlySpend(null);
    } catch (error: any) {
      toast.error(error.message || 'Failed to submit expense');
    } finally {
      setLoading(false);
    }
  };

  // Find the symbol for the selected currency
  const selectedCurr = currencies.find(c => c.code === currency);
  const currSymbol = selectedCurr?.symbol || '$';
  const formatMoney = (value: number) =>
    `${currSymbol}${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
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
                    disabled={scanning}
                    required
                  />
                </div>
                {perExpenseExceeded && (
                  <p className="flex items-center gap-1 text-sm text-warning">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    This category has a per-expense limit of {formatMoney(perExpenseLimit!)}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="currency">Currency</Label>
                <Select value={currency} onValueChange={setCurrency} disabled={scanning}>
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
              <Select value={categoryId} onValueChange={setCategoryId} disabled={scanning} required>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map(cat => (
                    <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {loadingLimits && (
                <p className="text-xs text-muted-foreground">Checking category limits...</p>
              )}
              {/* Monthly budget progress */}
              {monthlyLimit != null && monthlySpend != null && (
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Monthly budget</span>
                    <span className={`font-medium ${monthlyExceeded ? 'text-warning' : 'text-foreground'}`}>
                      {formatMoney(monthlySpend)} of {formatMoney(monthlyLimit)} used this month
                    </span>
                  </div>
                  <Progress
                    value={monthlyProgress}
                    className="h-1.5"
                  />
                  {monthlyExceeded && (
                    <p className="flex items-center gap-1 text-xs text-warning">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      This will exceed the monthly limit for this category
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="expense-date">Expense Date</Label>
              <Input
                id="expense-date"
                type="date"
                value={expenseDate}
                onChange={e => setExpenseDate(e.target.value)}
                disabled={scanning}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Describe the expense..."
                rows={3}
                value={description}
                onChange={e => setDescription(e.target.value)}
                disabled={scanning}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="receipt">Receipt</Label>
              <div
                className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => !scanning && document.getElementById('receipt-input')?.click()}
              >
                {scanning ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">Scanning receipt...</p>
                  </div>
                ) : (
                  <>
                    <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">
                      {receipt ? (
                        <span className="flex items-center justify-center gap-2">
                          {receipt.name}
                          {scanned && (
                            <span className="inline-flex items-center gap-1 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                              ✓ Scanned
                            </span>
                          )}
                        </span>
                      ) : (
                        'Click to upload or drag and drop'
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">PDF, PNG, JPG up to 10MB</p>
                  </>
                )}
                <input
                  id="receipt-input"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  className="hidden"
                  onChange={handleReceiptChange}
                />
              </div>
            </div>

            {/* Policy exception warning banner */}
            {isPolicyException && (
              <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3">
                <AlertTriangle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="font-medium text-warning">Policy exception</p>
                  <p className="text-muted-foreground">This expense exceeds a category limit. It will be flagged for reviewer attention.</p>
                </div>
              </div>
            )}

            <Button type="submit" className="w-full bg-gradient-to-r from-primary to-accent" disabled={loading}>
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
