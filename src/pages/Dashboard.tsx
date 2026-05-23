import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { StatsCard } from '@/components/StatsCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Coins, Clock, CheckCircle, XCircle, TrendingUp, Users, FileText, Receipt, Plus } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import type { OrgCurrency } from '@/types/database';


const COLORS = ['hsl(262, 83%, 58%)', 'hsl(38, 92%, 50%)', 'hsl(142, 71%, 45%)', 'hsl(0, 84%, 60%)'];

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user, profile, hasRole, hasAnyRole, isManager } = useAuth();
  const [stats, setStats] = useState({ total: 0, approved: 0, pending: 0, rejected: 0, totalAmount: 0 });
  const [monthlyData, setMonthlyData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [defaultCurrSymbol, setDefaultCurrSymbol] = useState('');

  useEffect(() => {
    fetchStats();
  }, [user]);

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

  const fetchStats = async () => {
    if (!user) return;
    try {
      let query = supabase.from('expenses').select('*');
      
      if (!hasAnyRole(['admin', 'finance'])) {
        if (isManager) {
          query = query.or(`user_id.eq.${user.id},current_approver_id.eq.${user.id}`);
        } else {
          query = query.eq('user_id', user.id);
        }
      }

      const { data: expenses } = await query;
      
      if (expenses) {
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

  const pieData = [
    { name: 'Approved', value: stats.approved },
    { name: 'Pending', value: stats.pending },
    { name: 'Rejected', value: stats.rejected },
  ].filter(d => d.value > 0);

  const isAdmin = hasAnyRole(['admin', 'finance']);

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

      {!loading && stats.total === 0 ? (
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatsCard
              title="Total Expenses"
              value={stats.total}
              icon={FileText}
              iconClassName="bg-gradient-to-br from-primary to-accent"
            />
            <StatsCard
              title="Total Amount"
              value={`${defaultCurrSymbol}${stats.totalAmount.toLocaleString()}`}
              icon={Coins}
              iconClassName="bg-gradient-to-br from-success to-success/70"
            />
            <StatsCard
              title="Pending"
              value={stats.pending}
              icon={Clock}
              iconClassName="bg-gradient-to-br from-warning to-warning/70"
            />
            <StatsCard
              title="Approved"
              value={stats.approved}
              icon={CheckCircle}
              iconClassName="bg-gradient-to-br from-success to-success/70"
            />
          </div>

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
        </>
      )}
    </div>
  );
};

export default Dashboard;

