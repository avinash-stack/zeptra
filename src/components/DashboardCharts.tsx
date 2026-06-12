import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const COLORS = ['hsl(217, 91%, 60%)', 'hsl(38, 92%, 50%)', 'hsl(160, 84%, 39%)', 'hsl(0, 84%, 60%)'];

interface DashboardChartsProps {
  monthlyData: { name: string; amount: number }[];
  pieData: { name: string; value: number }[];
  categoryChartData: { name: string; amount: number }[];
  children?: React.ReactNode;
}

const DashboardCharts: React.FC<DashboardChartsProps> = ({
  monthlyData,
  pieData,
  categoryChartData,
  children,
}) => (
  <>
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
                <Bar dataKey="amount" fill="hsl(217, 91%, 60%)" radius={[6, 6, 0, 0]} />
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

    {(categoryChartData.length > 0 || children) && (
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
        {children}
      </div>
    )}
  </>
);

export default DashboardCharts;
