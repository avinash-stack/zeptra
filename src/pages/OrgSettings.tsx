import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { Building2, Coins, Tags, Loader2, Plus, Pencil, Trash2, CreditCard, Zap, Crown, Users, Receipt, Check } from 'lucide-react';
import { usePlanLimit } from '@/hooks/usePlanLimit';
import type { Organization, ExpenseCategory, OrgCurrency, PlanType, CategoryLimit } from '@/types/database';

const planBadgeStyles: Record<PlanType, string> = {
  free: 'bg-muted text-muted-foreground border-muted-foreground/30',
  pro: 'bg-primary/15 text-primary border-primary/30',
  enterprise: 'bg-gradient-to-r from-primary/15 to-info/15 text-primary border-primary/30',
};

const OrgSettings: React.FC = () => {
  const { organization, refreshOrg, profile, hasRole } = useAuth();
  const [activeTab, setActiveTab] = useState('general');
  const billing = usePlanLimit();
  const [checkoutLoading, setCheckoutLoading] = useState<'pro' | 'enterprise' | null>(null);

  // General
  const [orgName, setOrgName] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [corpEmail, setCorpEmail] = useState('');
  const [bizPhone, setBizPhone] = useState('');
  const [savingGeneral, setSavingGeneral] = useState(false);

  // Categories
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [categoryLimits, setCategoryLimits] = useState<Record<string, CategoryLimit>>({});
  const [catDialogOpen, setCatDialogOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<ExpenseCategory | null>(null);
  const [catName, setCatName] = useState('');
  const [catGlCode, setCatGlCode] = useState('');
  const [catMonthlyLimit, setCatMonthlyLimit] = useState('');
  const [catPerExpenseLimit, setCatPerExpenseLimit] = useState('');

  // Currencies
  const [currencies, setCurrencies] = useState<OrgCurrency[]>([]);
  const [currDialogOpen, setCurrDialogOpen] = useState(false);
  const [editingCurr, setEditingCurr] = useState<OrgCurrency | null>(null);
  const [currCode, setCurrCode] = useState('');
  const [currSymbol, setCurrSymbol] = useState('');
  const [currName, setCurrName] = useState('');

  // Derived default currency symbol for limit display
  const defaultCurrSymbol = currencies.find(c => c.is_default)?.symbol || '₹';

  useEffect(() => {
    if (organization) {
      setOrgName(organization.name);
      setOrgSlug(organization.slug);
      setCorpEmail(organization.corporate_email);
      setBizPhone(organization.business_phone || '');
    }
  }, [organization]);

  useEffect(() => {
    fetchCategories();
    fetchCurrencies();
  }, [profile?.org_id]);

  const fetchCategories = async () => {
    if (!profile?.org_id) return;
    const { data } = await supabase
      .from('expense_categories')
      .select('*')
      .eq('org_id', profile.org_id)
      .order('name');
    if (data) setCategories(data as ExpenseCategory[]);

    // Fetch limits
    const { data: limitsData } = await supabase
      .from('category_limits')
      .select('*')
      .eq('org_id', profile.org_id);
    if (limitsData) {
      const map: Record<string, CategoryLimit> = {};
      (limitsData as CategoryLimit[]).forEach(l => { map[l.category_id] = l; });
      setCategoryLimits(map);
    }
  };

  const fetchCurrencies = async () => {
    if (!profile?.org_id) return;
    const { data } = await supabase
      .from('org_currencies')
      .select('*')
      .eq('org_id', profile.org_id)
      .order('code');
    if (data) setCurrencies(data as OrgCurrency[]);
  };

  // ---- General ----
  const saveGeneral = async () => {
    if (!organization) return;
    setSavingGeneral(true);
    const { error } = await supabase
      .from('organizations')
      .update({
        name: orgName.trim(),
        slug: orgSlug.trim(),
        corporate_email: corpEmail.trim(),
        business_phone: bizPhone.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', organization.id);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Organization updated');
      refreshOrg();
    }
    setSavingGeneral(false);
  };

  // ---- Categories ----
  const openCatDialog = (cat?: ExpenseCategory) => {
    setEditingCat(cat || null);
    setCatName(cat?.name || '');
    setCatGlCode(cat?.gl_code || '');
    const lim = cat ? categoryLimits[cat.id] : undefined;
    setCatMonthlyLimit(lim?.monthly_limit != null ? String(lim.monthly_limit) : '');
    setCatPerExpenseLimit(lim?.per_expense_limit != null ? String(lim.per_expense_limit) : '');
    setCatDialogOpen(true);
  };

  const saveCat = async () => {
    if (!catName.trim() || !profile?.org_id) return;
    let catId = editingCat?.id;
    const glCodeVal = catGlCode.trim() || null;
    if (editingCat) {
      const { error } = await supabase
        .from('expense_categories')
        .update({ name: catName.trim(), gl_code: glCodeVal })
        .eq('id', editingCat.id);
      if (error) { toast.error(error.message); return; }
    } else {
      const { data: newCat, error } = await supabase
        .from('expense_categories')
        .insert({ org_id: profile.org_id, name: catName.trim(), gl_code: glCodeVal })
        .select('id')
        .single();
      if (error) { toast.error(error.message); return; }
      catId = newCat?.id;
    }

    // Upsert category limits
    if (catId) {
      const monthlyVal = catMonthlyLimit.trim() ? parseFloat(catMonthlyLimit) : null;
      const perExpVal = catPerExpenseLimit.trim() ? parseFloat(catPerExpenseLimit) : null;

      if (monthlyVal !== null || perExpVal !== null) {
        const { error: limitError } = await supabase
          .from('category_limits')
          .upsert({
            org_id: profile.org_id,
            category_id: catId,
            monthly_limit: monthlyVal,
            per_expense_limit: perExpVal,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'category_id' });
        if (limitError) { toast.error(limitError.message); return; }
      } else if (categoryLimits[catId]) {
        // Remove limits if both cleared
        const { error: limitError } = await supabase
          .from('category_limits')
          .delete()
          .eq('category_id', catId)
          .eq('org_id', profile.org_id);
        if (limitError) { toast.error(limitError.message); return; }
      }
    }

    toast.success(editingCat ? 'Category updated' : 'Category created');
    setCatDialogOpen(false);
    fetchCategories();
  };

  const toggleCat = async (cat: ExpenseCategory) => {
    const { error } = await supabase
      .from('expense_categories')
      .update({ is_active: !cat.is_active })
      .eq('id', cat.id);
    if (error) toast.error(error.message);
    else fetchCategories();
  };

  const deleteCat = async (id: string) => {
    const { error } = await supabase.from('expense_categories').delete().eq('id', id);
    if (error) {
      toast.error('Cannot delete: category may be in use');
    } else {
      toast.success('Category deleted');
      fetchCategories();
    }
  };

  // ---- Currencies ----
  const openCurrDialog = (curr?: OrgCurrency) => {
    setEditingCurr(curr || null);
    setCurrCode(curr?.code || '');
    setCurrSymbol(curr?.symbol || '');
    setCurrName(curr?.name || '');
    setCurrDialogOpen(true);
  };

  const saveCurr = async () => {
    if (!currCode.trim() || !currSymbol.trim() || !currName.trim() || !profile?.org_id) return;
    if (editingCurr) {
      const { error } = await supabase
        .from('org_currencies')
        .update({ code: currCode.trim().toUpperCase(), symbol: currSymbol.trim(), name: currName.trim() })
        .eq('id', editingCurr.id);
      if (error) { toast.error(error.message); return; }
      toast.success('Currency updated');
    } else {
      const { error } = await supabase
        .from('org_currencies')
        .insert({
          org_id: profile.org_id,
          code: currCode.trim().toUpperCase(),
          symbol: currSymbol.trim(),
          name: currName.trim(),
        });
      if (error) { toast.error(error.message); return; }
      toast.success('Currency added');
    }
    setCurrDialogOpen(false);
    fetchCurrencies();
  };

  const setDefaultCurr = async (curr: OrgCurrency) => {
    if (!profile?.org_id) return;
    // Unset all defaults first
    await supabase.from('org_currencies').update({ is_default: false }).eq('org_id', profile.org_id);
    await supabase.from('org_currencies').update({ is_default: true }).eq('id', curr.id);
    toast.success(`${curr.code} set as default`);
    fetchCurrencies();
  };

  const deleteCurr = async (id: string) => {
    const { error } = await supabase.from('org_currencies').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('Currency removed');
    fetchCurrencies();
  };

  const handleUpgrade = async (plan: 'pro' | 'enterprise') => {
    if (!organization) return;
    setCheckoutLoading(plan);
    try {
      const { data, error } = await supabase.functions.invoke('create-checkout', {
        body: { plan, org_id: organization.id },
      });

      if (error) {
        let detail = '';
        try {
          if ((error as any).context) {
            const res = (error as any).context as Response;
            const body = await res.json();
            detail = body?.error || '';
          }
        } catch { /* ignore parse errors */ }
        throw new Error(detail || error.message);
      }
      if (data?.error) throw new Error(data.error);

      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to start checkout';
      toast.error(message);
    } finally {
      setCheckoutLoading(null);
    }
  };

  const usagePercent = (current: number, max: number) => {
    if (max === -1) return 0; // unlimited
    if (max === 0) return 100;
    return Math.min(Math.round((current / max) * 100), 100);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
          Organization Settings
        </h1>
        <p className="text-muted-foreground mt-1">
          Manage your organization profile, expense categories, and currencies
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4 max-w-lg">
          <TabsTrigger value="general" className="flex items-center gap-1.5">
            <Building2 className="h-4 w-4" /> General
          </TabsTrigger>
          <TabsTrigger value="categories" className="flex items-center gap-1.5">
            <Tags className="h-4 w-4" /> Categories
          </TabsTrigger>
          <TabsTrigger value="currencies" className="flex items-center gap-1.5">
            <Coins className="h-4 w-4" /> Currencies
          </TabsTrigger>
          <TabsTrigger value="billing" className="flex items-center gap-1.5">
            <CreditCard className="h-4 w-4" /> Billing
          </TabsTrigger>
        </TabsList>

        {/* ---- General ---- */}
        <TabsContent value="general">
          <Card>
            <CardHeader>
              <CardTitle>Organization Details</CardTitle>
              <CardDescription>Update your organization's basic information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Organization Name</Label>
                  <Input value={orgName} onChange={e => setOrgName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Slug</Label>
                  <Input value={orgSlug} onChange={e => setOrgSlug(e.target.value)} />
                  <p className="text-xs text-muted-foreground">Lowercase, numbers, hyphens only</p>
                </div>
                <div className="space-y-2">
                  <Label>Corporate Email</Label>
                  <Input type="email" value={corpEmail} onChange={e => setCorpEmail(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Business Phone</Label>
                  <Input value={bizPhone} onChange={e => setBizPhone(e.target.value)} />
                </div>
              </div>
              <Button onClick={saveGeneral} disabled={savingGeneral} className="bg-gradient-to-r from-primary to-accent">
                {savingGeneral && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Categories ---- */}
        <TabsContent value="categories">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Expense Categories</CardTitle>
                <CardDescription>Create and manage expense types for your organization</CardDescription>
              </div>
              <Button size="sm" onClick={() => openCatDialog()} className="bg-gradient-to-r from-primary to-accent">
                <Plus className="h-4 w-4 mr-1" /> Add Category
              </Button>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>GL Code</TableHead>
                    <TableHead>Limit</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categories.map(cat => {
                    const lim = categoryLimits[cat.id];
                    const hasLimits = lim?.per_expense_limit != null || lim?.monthly_limit != null;
                    return (
                    <TableRow key={cat.id}>
                      <TableCell className="font-medium">{cat.name}</TableCell>
                      <TableCell>{cat.gl_code || <span className="text-muted-foreground text-xs">—</span>}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {lim?.per_expense_limit != null && (
                            <Badge variant="outline" className="text-xs bg-primary/5 border-primary/20">
                              {defaultCurrSymbol}{Number(lim.per_expense_limit).toLocaleString()}/exp
                            </Badge>
                          )}
                          {lim?.monthly_limit != null && (
                            <Badge variant="outline" className="text-xs bg-info/5 border-info/20">
                              {defaultCurrSymbol}{Number(lim.monthly_limit).toLocaleString()}/mo
                            </Badge>
                          )}
                          {!hasLimits && <span className="text-xs text-muted-foreground">—</span>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch checked={cat.is_active} onCheckedChange={() => toggleCat(cat)} />
                          <Badge variant="outline" className={cat.is_active ? 'bg-success/15 text-success border-success/30' : 'bg-muted text-muted-foreground'}>
                            {cat.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openCatDialog(cat)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => deleteCat(cat.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    );
                  })}
                  {categories.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        No categories yet. Click "Add Category" to create one.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Currencies ---- */}
        <TabsContent value="currencies">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Currencies</CardTitle>
                <CardDescription>Define which currencies your organization uses</CardDescription>
              </div>
              <Button size="sm" onClick={() => openCurrDialog()} className="bg-gradient-to-r from-primary to-accent">
                <Plus className="h-4 w-4 mr-1" /> Add Currency
              </Button>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Default</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {currencies.map(curr => (
                    <TableRow key={curr.id}>
                      <TableCell className="font-mono font-semibold">{curr.code}</TableCell>
                      <TableCell>{curr.symbol}</TableCell>
                      <TableCell>{curr.name}</TableCell>
                      <TableCell>
                        {curr.is_default ? (
                          <Badge className="bg-primary/15 text-primary border-primary/30">Default</Badge>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => setDefaultCurr(curr)}>
                            Set Default
                          </Button>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openCurrDialog(curr)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {!curr.is_default && (
                            <Button variant="ghost" size="icon" onClick={() => deleteCurr(curr.id)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {currencies.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        No currencies configured. Add at least one.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Billing ---- */}
        <TabsContent value="billing">
          {billing.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Current Plan */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {billing.plan === 'enterprise' ? <Crown className="h-5 w-5 text-primary" /> : billing.plan === 'pro' ? <Zap className="h-5 w-5 text-primary" /> : <CreditCard className="h-5 w-5" />}
                    Current Plan
                  </CardTitle>
                  <CardDescription>Your organization's subscription details</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className={`text-sm px-3 py-1 ${planBadgeStyles[billing.plan]}`}>
                      {billing.plan.charAt(0).toUpperCase() + billing.plan.slice(1)}
                    </Badge>
                    {billing.subscription?.status && billing.subscription.status !== 'active' && (
                      <Badge variant="outline" className="bg-warning/15 text-warning border-warning/30">
                        {billing.subscription.status}
                      </Badge>
                    )}
                  </div>
                  {billing.subscription?.current_period_end && billing.plan !== 'free' && (
                    <p className="text-sm text-muted-foreground">
                      {billing.subscription.status === 'canceling' ? 'Access until' : 'Renews on'}{' '}
                      <span className="font-medium text-foreground">
                        {new Date(billing.subscription.current_period_end).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                      </span>
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Usage */}
              <Card>
                <CardHeader>
                  <CardTitle>Usage</CardTitle>
                  <CardDescription>Current usage against your plan limits</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2"><Users className="h-4 w-4" /> Users</span>
                      <span className="font-medium">
                        {billing.userCount} / {billing.limits?.max_users === -1 ? '∞' : billing.limits?.max_users ?? '–'}
                      </span>
                    </div>
                    <Progress
                      value={usagePercent(billing.userCount, billing.limits?.max_users ?? 5)}
                      className="h-2"
                    />
                    {billing.userLimitReached && (
                      <p className="text-xs text-destructive">User limit reached. Upgrade your plan to add more users.</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2"><Receipt className="h-4 w-4" /> Expenses this month</span>
                      <span className="font-medium">
                        {billing.expenseCount} / {billing.limits?.max_expenses_per_month === -1 ? '∞' : billing.limits?.max_expenses_per_month ?? '–'}
                      </span>
                    </div>
                    <Progress
                      value={usagePercent(billing.expenseCount, billing.limits?.max_expenses_per_month ?? 50)}
                      className="h-2"
                    />
                    {billing.expenseLimitReached && (
                      <p className="text-xs text-destructive">Monthly expense limit reached. Upgrade to submit more.</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Upgrade Options */}
              {billing.plan !== 'enterprise' && hasRole('admin') && (
                <div className="grid gap-6 md:grid-cols-2">
                  {billing.plan === 'free' && (
                    <Card className="border-primary/30">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Zap className="h-5 w-5 text-primary" /> Pro
                        </CardTitle>
                        <CardDescription>For growing teams that need more power</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <ul className="space-y-2 text-sm">
                          <li className="flex items-center gap-2"><Check className="h-4 w-4 text-success" /> Up to 50 users</li>
                          <li className="flex items-center gap-2"><Check className="h-4 w-4 text-success" /> Unlimited expenses</li>
                          <li className="flex items-center gap-2"><Check className="h-4 w-4 text-success" /> Analytics dashboard</li>
                        </ul>
                        <Button
                          onClick={() => handleUpgrade('pro')}
                          disabled={checkoutLoading !== null}
                          className="w-full bg-gradient-to-r from-primary to-accent"
                        >
                          {checkoutLoading === 'pro' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          Upgrade to Pro
                        </Button>
                      </CardContent>
                    </Card>
                  )}
                  <Card className="border-primary/30">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Crown className="h-5 w-5 text-primary" /> Enterprise
                      </CardTitle>
                      <CardDescription>Unlimited everything for large organizations</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <ul className="space-y-2 text-sm">
                        <li className="flex items-center gap-2"><Check className="h-4 w-4 text-success" /> Unlimited users</li>
                        <li className="flex items-center gap-2"><Check className="h-4 w-4 text-success" /> Unlimited expenses</li>
                        <li className="flex items-center gap-2"><Check className="h-4 w-4 text-success" /> Analytics dashboard</li>
                        <li className="flex items-center gap-2"><Check className="h-4 w-4 text-success" /> API access</li>
                      </ul>
                      <Button
                        onClick={() => handleUpgrade('enterprise')}
                        disabled={checkoutLoading !== null}
                        className="w-full bg-gradient-to-r from-primary to-accent"
                      >
                        {checkoutLoading === 'enterprise' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Upgrade to Enterprise
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Category Dialog */}
      <Dialog open={catDialogOpen} onOpenChange={open => { setCatDialogOpen(open); if (!open) { setCatGlCode(''); setCatName(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCat ? 'Edit Category' : 'Add Category'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Category Name</Label>
              <Input value={catName} onChange={e => setCatName(e.target.value)} placeholder="e.g. Travel" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gl-code">GL Code <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input
                id="gl-code"
                placeholder="e.g. 6001"
                value={catGlCode}
                onChange={e => setCatGlCode(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Used for Tally and QuickBooks exports</p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Monthly limit</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={catMonthlyLimit}
                  onChange={e => setCatMonthlyLimit(e.target.value)}
                  placeholder="No limit"
                />
                <p className="text-xs text-muted-foreground">Max total spend per month</p>
              </div>
              <div className="space-y-2">
                <Label>Per-expense limit</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={catPerExpenseLimit}
                  onChange={e => setCatPerExpenseLimit(e.target.value)}
                  placeholder="No limit"
                />
                <p className="text-xs text-muted-foreground">Max amount per single expense</p>
              </div>
            </div>
            <Button onClick={saveCat} className="w-full bg-gradient-to-r from-primary to-accent">
              {editingCat ? 'Update' : 'Create'} Category
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Currency Dialog */}
      <Dialog open={currDialogOpen} onOpenChange={setCurrDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCurr ? 'Edit Currency' : 'Add Currency'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Code</Label>
                <Input value={currCode} onChange={e => setCurrCode(e.target.value)} placeholder="USD" maxLength={3} />
              </div>
              <div className="space-y-2">
                <Label>Symbol</Label>
                <Input value={currSymbol} onChange={e => setCurrSymbol(e.target.value)} placeholder="$" maxLength={3} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Currency Name</Label>
              <Input value={currName} onChange={e => setCurrName(e.target.value)} placeholder="US Dollar" />
            </div>
            <Button onClick={saveCurr} className="w-full bg-gradient-to-r from-primary to-accent">
              {editingCurr ? 'Update' : 'Add'} Currency
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default OrgSettings;
