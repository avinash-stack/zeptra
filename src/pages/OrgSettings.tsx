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
import { toast } from 'sonner';
import { Building2, Coins, Tags, Loader2, Plus, Pencil, Trash2 } from 'lucide-react';
import type { Organization, ExpenseCategory, OrgCurrency } from '@/types/database';

const OrgSettings: React.FC = () => {
  const { organization, refreshOrg, profile } = useAuth();
  const [activeTab, setActiveTab] = useState('general');

  // General
  const [orgName, setOrgName] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [corpEmail, setCorpEmail] = useState('');
  const [bizPhone, setBizPhone] = useState('');
  const [savingGeneral, setSavingGeneral] = useState(false);

  // Categories
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [catDialogOpen, setCatDialogOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<ExpenseCategory | null>(null);
  const [catName, setCatName] = useState('');

  // Currencies
  const [currencies, setCurrencies] = useState<OrgCurrency[]>([]);
  const [currDialogOpen, setCurrDialogOpen] = useState(false);
  const [editingCurr, setEditingCurr] = useState<OrgCurrency | null>(null);
  const [currCode, setCurrCode] = useState('');
  const [currSymbol, setCurrSymbol] = useState('');
  const [currName, setCurrName] = useState('');

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
    setCatDialogOpen(true);
  };

  const saveCat = async () => {
    if (!catName.trim() || !profile?.org_id) return;
    if (editingCat) {
      const { error } = await supabase
        .from('expense_categories')
        .update({ name: catName.trim() })
        .eq('id', editingCat.id);
      if (error) { toast.error(error.message); return; }
      toast.success('Category updated');
    } else {
      const { error } = await supabase
        .from('expense_categories')
        .insert({ org_id: profile.org_id, name: catName.trim() });
      if (error) { toast.error(error.message); return; }
      toast.success('Category created');
    }
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-info bg-clip-text text-transparent">
          Organization Settings
        </h1>
        <p className="text-muted-foreground mt-1">
          Manage your organization profile, expense categories, and currencies
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="general" className="flex items-center gap-1.5">
            <Building2 className="h-4 w-4" /> General
          </TabsTrigger>
          <TabsTrigger value="categories" className="flex items-center gap-1.5">
            <Tags className="h-4 w-4" /> Categories
          </TabsTrigger>
          <TabsTrigger value="currencies" className="flex items-center gap-1.5">
            <Coins className="h-4 w-4" /> Currencies
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
              <Button onClick={saveGeneral} disabled={savingGeneral} className="bg-gradient-to-r from-primary to-info">
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
              <Button size="sm" onClick={() => openCatDialog()} className="bg-gradient-to-r from-primary to-info">
                <Plus className="h-4 w-4 mr-1" /> Add Category
              </Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categories.map(cat => (
                    <TableRow key={cat.id}>
                      <TableCell className="font-medium">{cat.name}</TableCell>
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
                  ))}
                  {categories.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                        No categories yet. Click "Add Category" to create one.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
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
              <Button size="sm" onClick={() => openCurrDialog()} className="bg-gradient-to-r from-primary to-info">
                <Plus className="h-4 w-4 mr-1" /> Add Currency
              </Button>
            </CardHeader>
            <CardContent>
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
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Category Dialog */}
      <Dialog open={catDialogOpen} onOpenChange={setCatDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCat ? 'Edit Category' : 'Add Category'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Category Name</Label>
              <Input value={catName} onChange={e => setCatName(e.target.value)} placeholder="e.g. Travel" />
            </div>
            <Button onClick={saveCat} className="w-full bg-gradient-to-r from-primary to-info">
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
            <Button onClick={saveCurr} className="w-full bg-gradient-to-r from-primary to-info">
              {editingCurr ? 'Update' : 'Add'} Currency
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default OrgSettings;
