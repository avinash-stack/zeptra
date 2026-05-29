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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Loader2, Upload, CheckCircle2, AlertTriangle, CheckCircle, Sparkles, ChevronsUpDown, Receipt } from 'lucide-react';
import type { ExpenseCategory, OrgCurrency, CategoryLimit } from '@/types/database';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { expenseSchema, type ExpenseFormValues } from '@/lib/expenseSchema';

const SubmitExpense: React.FC = () => {
  const { user, profile } = useAuth();
  
  const { control, handleSubmit, reset, setValue, watch, formState: { errors, isSubmitting } } = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      amount: '',
      currency: '',
      categoryId: '',
      description: '',
      expenseDate: new Date().toISOString().slice(0, 10),
      gstNumber: '',
    }
  });

  const amount = watch('amount');
  const currency = watch('currency');
  const categoryId = watch('categoryId');
  const description = watch('description');
  const expenseDate = watch('expenseDate');
  const gstNumber = watch('gstNumber');

  const [receipt, setReceipt] = useState<File | null>(null);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [currencies, setCurrencies] = useState<OrgCurrency[]>([]);
  const [loading, setLoading] = useState(false);

  // OCR states
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);

  // AI category suggestion states
  const [suggestedCategory, setSuggestedCategory] = useState<{ id: string; name: string } | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);

  // GST states
  const [cgst, setCgst] = useState('');
  const [sgst, setSgst] = useState('');
  const [igst, setIgst] = useState('');
  const [totalGst, setTotalGst] = useState('');
  const [hsnCodes, setHsnCodes] = useState<{code: string; description: string; amount: number}[]>([]);
  const [gstMode, setGstMode] = useState<'intra' | 'inter'>('intra');
  const [gstOpen, setGstOpen] = useState(false);

  // Policy limit states
  const [categoryLimit, setCategoryLimit] = useState<CategoryLimit | null>(null);
  const [monthlySpend, setMonthlySpend] = useState<number | null>(null);
  const [loadingLimits, setLoadingLimits] = useState(false);

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
          if (defaultCurr) setValue('currency', defaultCurr.code);
          else if (data.length > 0) setValue('currency', (data[0] as OrgCurrency).code);
        }
      });
  }, [profile?.org_id, setValue]);

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

  const handleDescriptionBlur = async () => {
    if (
      description.length < 10 ||
      categoryId ||
      suggesting ||
      suggestionDismissed ||
      categories.length === 0
    ) return;

    setSuggesting(true);
    try {
      const { data, error } = await supabase.functions.invoke('suggest-category', {
        body: {
          description,
          categories: categories.map(c => ({ id: c.id, name: c.name })),
        },
      });
      if (!error && data?.id) {
        setSuggestedCategory(data);
      }
    } catch {
      // Silent fail
    } finally {
      setSuggesting(false);
    }
  };

  const uploadReceipt = async (file: File): Promise<string | null> => {
    if (!user) return null;
    try {
      // Get pre-signed URL from edge function
      const { data, error } = await supabase.functions.invoke('get-upload-url', {
        body: { 
          file_name: file.name, 
          file_type: file.type,
          file_size: file.size,
        }
      });
      if (error || !data?.upload_url) return null;
      
      // Upload directly to S3
      const uploadRes = await fetch(data.upload_url, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type }
      });
      if (!uploadRes.ok) return null;
      
      return data.receipt_key || null;
    } catch {
      return null;
    }
  };

  const ALLOWED_SIGNATURES: Record<string, number[][]> = {
    'image/jpeg': [[0xFF, 0xD8, 0xFF]],
    'image/png':  [[0x89, 0x50, 0x4E, 0x47]],
    'image/webp': [[0x52, 0x49, 0x46, 0x46]],
    'application/pdf': [[0x25, 0x50, 0x44, 0x46]],
  };

  const validateFileMagicBytes = (file: File): Promise<boolean> => {
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = e => {
        const arr = new Uint8Array(e.target?.result as ArrayBuffer);
        let matched = Object.values(ALLOWED_SIGNATURES).some(sigs =>
          sigs.some(sig => sig.every((byte, i) => arr[i] === byte))
        );
        
        if (!matched && arr.length >= 12) {
          const isFtyp = arr[4] === 0x66 && arr[5] === 0x74 && arr[6] === 0x79 && arr[7] === 0x70;
          if (isFtyp) {
            const typeStr = String.fromCharCode(arr[8], arr[9], arr[10], arr[11]);
            if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(typeStr)) {
              matched = true;
            }
          }
        }
        
        resolve(matched);
      };
      reader.onerror = () => resolve(false);
      reader.readAsArrayBuffer(file.slice(0, 12));
    });
  };

  const handleReceiptChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    // Validate file size (10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File too large. Maximum size is 10MB.');
      e.target.value = '';
      return;
    }

    // Validate magic bytes (actual file type, not spoofed extension)
    const isValidType = await validateFileMagicBytes(file);
    if (!isValidType) {
      toast.error('Invalid file type. Only PDF, JPG, PNG, WebP, and HEIC are allowed.');
      e.target.value = '';
      return;
    }

    setReceipt(file);
    setScanned(false);
    setReceiptUrl(null);
    setScanning(true);
    let url: string | null = null;
    let ocrFoundUseful = false;
    try {
      url = await uploadReceipt(file);
      if (!url) return;
      setReceiptUrl(url);
      const { data, error } = await supabase.functions.invoke('ocr-receipt', {
        body: { receipt_key: url },
      });
      if (!error && data) {
        if (data.amount && !amount) setValue('amount', String(data.amount));
        if (data.date) setValue('expenseDate', data.date);
        if (data.suggested_description && !description) setValue('description', data.suggested_description);
        // GST pre-fills
        if (data.gst_number) setValue('gstNumber', data.gst_number);
        if (data.cgst != null) { setCgst(String(data.cgst)); setGstMode('intra'); }
        if (data.sgst != null) setSgst(String(data.sgst));
        if (data.igst != null) { setIgst(String(data.igst)); setGstMode('inter'); }
        if (data.total_gst_amount != null) setTotalGst(String(data.total_gst_amount));
        if (data.hsn_codes?.length) setHsnCodes(data.hsn_codes);
        // Auto-open GST section if GST data was found
        if (data.gst_number || data.cgst != null || data.igst != null) setGstOpen(true);
        if (data.amount || data.date || data.suggested_description) {
          toast.info('Receipt scanned — please review the details');
          setScanned(true);
          ocrFoundUseful = true;
        }
      }
    } catch (err: any) {
      console.warn('OCR processing error:', err);
      toast.error('Failed to auto-scan receipt. Please enter details manually.');
    } finally {
      setScanning(false);
    }

    // If OCR ran but returned nothing useful
    if (url && !ocrFoundUseful) {
      toast('Could not auto-scan receipt. Please enter details manually.', {
        icon: '📄',
        duration: 3000,
      });
    }
  };

  const onSubmit = async (data: ExpenseFormValues) => {
    if (!user) return;
    setLoading(true);

    try {
      let finalReceiptUrl = receiptUrl;
      if (receipt && !receiptUrl) {
        const url = await uploadReceipt(receipt);
        if (!url) throw new Error('Failed to upload receipt');
        finalReceiptUrl = url;
      }

      // Get manager for L1 approval
      const { data: profileData } = await supabase
        .from('users')
        .select('manager_id')
        .eq('id', user.id)
        .single();
      if (!profileData?.manager_id) {
        throw new Error('No approver is assigned to your profile. Ask HR or an admin to set your manager before submitting an expense.');
      }

      const { error } = await supabase.from('expenses').insert({
        user_id: user.id,
        amount: parseFloat(data.amount),
        currency: data.currency || 'INR',
        category_id: data.categoryId,
        description: data.description,
        receipt_url: finalReceiptUrl,
        status: 'pending_l1',
        current_approver_id: profileData.manager_id,
        submitted_at: new Date(`${data.expenseDate}T12:00:00`).toISOString(),
        is_policy_exception: isPolicyException,
        gst_details: data.gstNumber || cgst || sgst || igst ? {
          gstin: data.gstNumber || null,
          cgst: cgst ? parseFloat(cgst) : null,
          sgst: sgst ? parseFloat(sgst) : null,
          igst: igst ? parseFloat(igst) : null,
          total_gst: totalGst ? parseFloat(totalGst) : null,
          hsn_codes: hsnCodes.length ? hsnCodes : null,
        } : null,
      });

      if (error) throw error;

      toast.success('Expense submitted successfully!');
      reset();
      setReceipt(null);
      setReceiptUrl(null);
      setScanned(false);
      setSuggestedCategory(null);
      setSuggestionDismissed(false);
      setCategoryLimit(null);
      setMonthlySpend(null);
      setCgst('');
      setSgst('');
      setIgst('');
      setTotalGst('');
      setHsnCodes([]);
      setGstOpen(false);
    } catch (error: any) {
      toast.error(error.message || 'Failed to submit expense');
    } finally {
      setLoading(false);
    }
  };

  // Find the symbol for the selected currency
  const selectedCurr = currencies.find(c => c.code === currency);
  const currSymbol = selectedCurr?.symbol || '₹';
  const formatMoney = (value: number) =>
    `${currSymbol}${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  if (profile && !profile.manager_id) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            Submit Expense
          </h1>
        </div>
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-8 pb-8 flex flex-col items-center justify-center text-center space-y-4">
            <AlertTriangle className="w-12 h-12 text-destructive" />
            <div className="space-y-2">
              <h2 className="text-xl font-semibold">No Approver Assigned</h2>
              <p className="text-muted-foreground max-w-md">
                You cannot submit expenses because there is no manager assigned to your profile. Please ask HR or an administrator to set your manager first.
              </p>
            </div>
            <Button variant="outline" className="mt-4" onClick={() => window.history.back()}>Go Back</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

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
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="amount">Amount</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-medium">
                    {currSymbol}
                  </span>
                  <Controller
                    control={control}
                    name="amount"
                    render={({ field }) => (
                      <Input
                        id="amount"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        className="pl-8"
                        disabled={scanning || isSubmitting}
                        {...field}
                      />
                    )}
                  />
                </div>
                {errors.amount && <p className="text-xs text-destructive">{errors.amount.message}</p>}
                {perExpenseExceeded && (
                  <p className="flex items-center gap-1 text-sm text-warning">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    This category has a per-expense limit of {formatAmount(perExpenseLimit!, currency)}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="currency">Currency</Label>
                <Controller
                  control={control}
                  name="currency"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange} disabled={scanning || isSubmitting}>
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
                  )}
                />
                {errors.currency && <p className="text-xs text-destructive">{errors.currency.message}</p>}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <Controller
                control={control}
                name="categoryId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={scanning || isSubmitting}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map(cat => (
                        <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.categoryId && <p className="text-xs text-destructive">{errors.categoryId.message}</p>}
              {loadingLimits && (
                <p className="text-xs text-muted-foreground">Checking category limits...</p>
              )}
              {/* Monthly budget progress */}
              {monthlyLimit != null && monthlySpend != null && (
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Monthly budget</span>
                    <span className={`font-medium ${monthlyExceeded ? 'text-warning' : 'text-foreground'}`}>
                      {formatAmount(monthlySpend, currency)} of {formatAmount(monthlyLimit, currency)} used this month
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
              <Controller
                control={control}
                name="expenseDate"
                render={({ field }) => (
                  <Input
                    id="expense-date"
                    type="date"
                    disabled={scanning || isSubmitting}
                    {...field}
                  />
                )}
              />
              {errors.expenseDate && <p className="text-xs text-destructive">{errors.expenseDate.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Controller
                control={control}
                name="description"
                render={({ field }) => (
                  <Textarea
                    id="description"
                    placeholder="Describe the expense..."
                    rows={3}
                    disabled={scanning || isSubmitting}
                    {...field}
                    onChange={(e) => {
                      field.onChange(e);
                      if (suggestedCategory) setSuggestedCategory(null);
                    }}
                    onBlur={(e) => {
                      field.onBlur();
                      handleDescriptionBlur();
                    }}
                  />
                )}
              />
              {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
            </div>

            {suggesting && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                Suggesting category...
              </div>
            )}

            {suggestedCategory && !categoryId && !suggestionDismissed && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20">
                <Sparkles className="w-4 h-4 text-primary flex-shrink-0" />
                <span className="text-sm text-foreground flex-1">
                  Suggested: <span className="font-medium">{suggestedCategory.name}</span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  className="h-7 text-xs"
                  onClick={() => {
                    setValue('categoryId', suggestedCategory.id);
                    setSuggestedCategory(null);
                  }}
                >
                  Use this
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => {
                    setSuggestionDismissed(true);
                    setSuggestedCategory(null);
                  }}
                >
                  Dismiss
                </Button>
              </div>
            )}

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
                    <p className="text-xs text-muted-foreground mt-1">PDF, PNG, JPG, HEIC up to 10MB</p>
                  </>
                )}
                <input
                  id="receipt-input"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.heic,.heif"
                  className="hidden"
                  onChange={handleReceiptChange}
                />
              </div>
            </div>

            {/* GST Details (Optional) — collapsible section */}
            <Collapsible open={gstOpen} onOpenChange={setGstOpen}>
              <CollapsibleTrigger asChild>
                <Button type="button" variant="ghost" className="flex w-full items-center justify-between px-0 hover:bg-transparent">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Receipt className="w-4 h-4 text-muted-foreground" />
                    GST Details (Optional)
                  </span>
                  <ChevronsUpDown className="w-4 h-4 text-muted-foreground" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-2">
                {/* GSTIN */}
                <div className="space-y-2">
                  <Label htmlFor="gstin">GSTIN</Label>
                  <Controller
                    control={control}
                    name="gstNumber"
                    render={({ field }) => (
                      <Input
                        id="gstin"
                        placeholder="22AAAAA0000A1Z5"
                        maxLength={25}
                        {...field}
                        value={field.value || ''}
                        onChange={(e) => field.onChange(e.target.value.toUpperCase().replace(/[\s-]/g, ''))}
                        className={errors.gstNumber ? 'border-destructive' : ''}
                      />
                    )}
                  />
                  {errors.gstNumber && <p className="text-xs text-destructive">{errors.gstNumber.message}</p>}
                </div>

                {/* Intra / Inter toggle */}
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={gstMode === 'intra' ? 'default' : 'outline'}
                    className="h-7 text-xs"
                    onClick={() => { setGstMode('intra'); setIgst(''); }}
                  >
                    Intra-state (CGST + SGST)
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={gstMode === 'inter' ? 'default' : 'outline'}
                    className="h-7 text-xs"
                    onClick={() => { setGstMode('inter'); setCgst(''); setSgst(''); }}
                  >
                    Inter-state (IGST)
                  </Button>
                </div>

                {gstMode === 'intra' ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="cgst">CGST ({currency || 'INR'})</Label>
                      <Input
                        id="cgst"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={cgst}
                        onChange={e => {
                          setCgst(e.target.value);
                          const c = parseFloat(e.target.value) || 0;
                          const s = parseFloat(sgst) || 0;
                          setTotalGst((c + s).toFixed(2));
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="sgst">SGST ({currency || 'INR'})</Label>
                      <Input
                        id="sgst"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={sgst}
                        onChange={e => {
                          setSgst(e.target.value);
                          const s = parseFloat(e.target.value) || 0;
                          const c = parseFloat(cgst) || 0;
                          setTotalGst((c + s).toFixed(2));
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="igst">IGST ({currency || 'INR'})</Label>
                    <Input
                      id="igst"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={igst}
                      onChange={e => {
                        setIgst(e.target.value);
                        setTotalGst(e.target.value);
                      }}
                    />
                  </div>
                )}

                {/* Total GST — read-only, auto-computed */}
                <div className="space-y-2">
                  <Label htmlFor="total-gst">Total GST Amount ({currency || 'INR'})</Label>
                  <Input
                    id="total-gst"
                    type="number"
                    value={totalGst}
                    readOnly
                    className="bg-muted/50"
                  />
                </div>

                {/* HSN codes table */}
                {hsnCodes.length > 0 && (
                  <div className="space-y-2">
                    <Label>HSN Codes</Label>
                    <div className="border rounded-lg overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Code</TableHead>
                            <TableHead className="text-xs">Description</TableHead>
                            <TableHead className="text-xs text-right">Amount</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {hsnCodes.map((hsn, i) => (
                            <TableRow key={i}>
                              <TableCell className="text-xs font-mono">{hsn.code}</TableCell>
                              <TableCell className="text-xs">{hsn.description}</TableCell>
                              <TableCell className="text-xs text-right">{formatAmount(hsn.amount, currency)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>

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

            <Button type="submit" className="w-full bg-gradient-to-r from-primary to-accent" disabled={loading || scanning || isSubmitting}>
              {(loading || isSubmitting) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit Expense
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default SubmitExpense;
