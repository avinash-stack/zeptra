import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { StatsCard } from '@/components/StatsCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Coins, Clock, CheckCircle, XCircle, TrendingUp, Users, FileText, Receipt, Plus, Download } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import type { OrgCurrency } from '@/types/database';

const COLORS = ['hsl(262, 83%, 58%)', 'hsl(38, 92%, 50%)', 'hsl(142, 71%, 45%)', 'hsl(0, 84%, 60%)'];

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user, profile, hasRole, hasAnyRole, isManager } = useAuth();
  const [stats, setStats] = useState({ total: 0, approved: 0, pending: 0, rejected: 0, totalAmount: 0 });
  const [monthlyData, setMonthlyData] = useState<any[]>([]);
  const [dateRange, setDateRange] = useState<'30d' | '90d' | 'year' | 'all'>('all');
  const [allExpenses, setAllExpenses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [defaultCurrSymbol, setDefaultCurrSymbol] = useState('');

  useEffect(() => {
    fetchStats();
  }, [user, dateRange]);

  useEffect(() => {
    if (profile?.org_id) {
      supabase
        .from('org_currencies')
        .select('symbol')
        .eq('org_id', profile.org_id)
        .eq('is_default', true)
        .single()
        .then(({ data }) => {
          if (data) setDefaultCurrSymbol((data as OrgCurrency).symbol);
        });
    }
  }, [profile?.org_id]);

  const getStartDate = () => {
    const now = new Date();
    if (dateRange === '30d') return new Date(now.setDate(now.getDate() - 30)).toISOString();
    if (dateRange === '90d') return new Date(now.setDate(now.getDate() - 90)).toISOString();
    if (dateRange === 'year') return new Date(new Date().getFullYear(), 0, 1).toISOString();
    return null;
  };

  const fetchStats = async () => {
    if (!user) return;
    try {
      let query;
      if (hasAnyRole(['admin', 'finance'])) {
        query = supabase.from('expenses').select('*, expense_categories(name)');
      } else {
        query = supabase.from('expenses').select('*');
        if (isManager) {
          query = query.or(`user_id.eq.${user.id},current_approver_id.eq.${user.id}`);
        } else {
          query = query.eq('user_id', user.id);
        }
      }

      const startDate = getStartDate();
      if (hasAnyRole(['admin', 'finance']) && startDate) {
        query = query.gte('submitted_at', startDate);
      }

      const { data: rawExpenses } = await query;
      let expenses = rawExpenses || [];
      
      if (hasAnyRole(['admin', 'finance']) && expenses.length > 0) {
        const userIds = [...new Set(expenses.map((e: any) => e.user_id))];
        const { data: profiles } = await supabase.from('users').select('id, name').in('id', userIds);
        const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));
        expenses = expenses.map((e: any) => ({
          ...e,
          users: profileMap.get(e.user_id) || null,
        }));
      }
      
      if (expenses) {
        setAllExpenses(expenses);
        const total = expenses.length;
        const approved = expenses.filter(e => e.status === 'approved').length;
        const pending = expenses.filter(e => e.status === 'pending_l1' || e.status === 'pending_l2').length;
        const rejected = expenses.filter(e => e.status === 'rejected').length;
        const totalAmount = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
        setStats({ total, approved, pending, rejected, totalAmount });

        // Monthly data
        const months: Record<string, number> = {};
        expenses.forEach(e => {
          const month = new Date(e.submitted_at).toLocaleString('default', { month: 'short' });
          months[month] = (months[month] || 0) + Number(e.amount);
        });
        setMonthlyData(Object.entries(months).map(([name, amount]) => ({ name, amount })));
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    } finally {
      setLoading(false);
    }
  };

  const isAdmin = hasAnyRole(['admin', 'finance']);

  const pieData = [
    { name: 'Approved', value: stats.approved },
    { name: 'Pending', value: stats.pending },
    { name: 'Rejected', value: stats.rejected },
  ].filter(d => d.value > 0);

  const categoryData = allExpenses.reduce((acc, e) => {
    const name = e.expense_categories?.name || 'Uncategorized';
    acc[name] = (acc[name] || 0) + Number(e.amount);
    return acc;
  }, {} as Record<string, number>);
  
  const categoryChartData = Object.entries(categoryData)
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);

  const spenderMap: Record<string, { name: string, amount: number, count: number }> = {};
  allExpenses.forEach(e => {
    const id = e.user_id;
    const name = (e as any).users?.name || 'Unknown';
    if (!spenderMap[id]) spenderMap[id] = { name, amount: 0, count: 0 };
    spenderMap[id].amount += Number(e.amount);
    spenderMap[id].count += 1;
  });
  
  const topSpenders = Object.values(spenderMap)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5)
    .map(s => ({ ...s, avg: s.amount / s.count }));

  const exportCSV = () => {
    const headers = ['Date','Employee','Category','Amount','Currency','Status','Description'];
    const rows = allExpenses.map(e => [
      new Date(e.submitted_at).toLocaleDateString('en-IN'),
      (e as any).users?.name || '',
      (e as any).expense_categories?.name || '',
      Number(e.amount).toFixed(2),
      e.currency,
      e.status,
      `"${e.description.replace(/"/g, '""')}"`,
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zeptra-expenses-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${allExpenses.length} expenses`);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
          {isAdmin ? 'Organization Dashboard' : isManager ? 'Team Dashboard' : 'My Dashboard'}
        </h1>
        <p className="text-muted-foreground mt-1">
          {isAdmin ? 'Organization-wide expense overview' : isManager ? 'Your team\'s expense summary' : 'Your expense summary'}
        </p>
      </div>

      {!loading && stats.total === 0 && !isAdmin ? (
        <Card className="max-w-md mx-auto mt-12">
          <CardContent className="flex flex-col items-center text-center py-12 px-6">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/10 to-info/10 flex items-center justify-center mb-4">
              <Receipt className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-xl font-semibold mb-2">No expenses yet</h2>
            <p className="text-muted-foreground text-sm mb-6">
              Get started by submitting your first expense report. It only takes a minute.
            </p>
            <Button
              className="bg-gradient-to-r from-primary to-accent"
              onClick={() => navigate('/app/submit')}
            >
              <Plus className="w-4 h-4 mr-2" />
              Submit your first expense
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {isAdmin && (
            <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-2 bg-muted/50 p-1 rounded-lg w-fit">
                {(['30d', '90d', 'year', 'all'] as const).map((range) => (
                  <button
                    key={range}
                    onClick={() => setDateRange(range)}
                    className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                      dateRange === range 
                        ? 'bg-primary text-primary-foreground shadow-sm' 
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {range === '30d' ? '30 days' : range === '90d' ? '90 days' : range === 'year' ? 'This year' : 'All time'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isAdmin ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              <StatsCard title="Total Expenses" value={stats.total} icon={FileText} iconClassName="bg-gradient-to-br from-primary to-accent" />
              <StatsCard title="Total Amount" value={`${defaultCurrSymbol}${stats.totalAmount.toLocaleString()}`} icon={Coins} iconClassName="bg-gradient-to-br from-success to-success/70" />
              <StatsCard title="Pending" value={stats.pending} icon={Clock} iconClassName="bg-gradient-to-br from-warning to-warning/70" />
              <StatsCard title="Approved" value={stats.approved} icon={CheckCircle} iconClassName="bg-gradient-to-br from-success to-success/70" />
              <StatsCard title="Avg per expense" value={`${defaultCurrSymbol}${stats.total > 0 ? (stats.totalAmount / stats.total).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '0'}`} icon={TrendingUp} iconClassName="bg-gradient-to-br from-info to-info/70" />
              <StatsCard title="Rejection rate" value={`${stats.total > 0 ? ((stats.rejected / stats.total) * 100).toFixed(1) : '0'}%`} icon={XCircle} iconClassName="bg-gradient-to-br from-destructive to-destructive/70" />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatsCard title="Total Expenses" value={stats.total} icon={FileText} iconClassName="bg-gradient-to-br from-primary to-accent" />
              <StatsCard title="Total Amount" value={`${defaultCurrSymbol}${stats.totalAmount.toLocaleString()}`} icon={Coins} iconClassName="bg-gradient-to-br from-success to-success/70" />
              <StatsCard title="Pending" value={stats.pending} icon={Clock} iconClassName="bg-gradient-to-br from-warning to-warning/70" />
              <StatsCard title="Approved" value={stats.approved} icon={CheckCircle} iconClassName="bg-gradient-to-br from-success to-success/70" />
            </div>
          )}

          {isAdmin && (
            <div className="flex items-center justify-between mt-10 mb-4">
              <h2 className="text-xl font-bold">Analytics</h2>
              <Button variant="outline" onClick={exportCSV}>
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Monthly Expense Trend</CardTitle>
              </CardHeader>
              <CardContent>
                {monthlyData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={monthlyData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="name" className="text-xs" />
                      <YAxis className="text-xs" />
                      <Tooltip />
                      <Bar dataKey="amount" fill="hsl(262, 83%, 58%)" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                    No expense data yet
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Status Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                {pieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={5} dataKey="value">
                        {pieData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                    No expense data yet
                  </div>
                )}
                <div className="flex justify-center gap-4 mt-2">
                  {pieData.map((item, i) => (
                    <div key={item.name} className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i] }} />
                      <span className="text-sm text-muted-foreground">{item.name}: {item.value}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {isAdmin && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Spend by category</CardTitle>
                </CardHeader>
                <CardContent>
                  {categoryChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart layout="vertical" data={categoryChartData} margin={{ left: 20 }}>
                        <XAxis type="number" className="text-xs" />
                        <YAxis type="category" dataKey="name" width={120} className="text-xs" />
                        <Tooltip />
                        <Bar dataKey="amount" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                      No category data yet
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Top spenders</CardTitle>
                </CardHeader>
                <CardContent>
                  {topSpenders.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Employee</TableHead>
                          <TableHead className="text-right">Total spent</TableHead>
                          <TableHead className="text-right">Expenses</TableHead>
                          <TableHead className="text-right">Avg per expense</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {topSpenders.map((s, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-medium">{s.name}</TableCell>
                            <TableCell className="text-right font-medium">{defaultCurrSymbol}{s.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                            <TableCell className="text-right text-muted-foreground">{s.count}</TableCell>
                            <TableCell className="text-right text-muted-foreground">{defaultCurrSymbol}{s.avg.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="flex items-center justify-center text-muted-foreground py-8">
                      No spender data yet
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Dashboard;
