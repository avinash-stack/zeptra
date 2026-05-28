import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Shield, Download, ChevronLeft, ChevronRight, Eye, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { logExport } from '@/lib/auditLogger';
import type { AuditLog as AuditLogEntry } from '@/types/database';

const PAGE_SIZE = 50;

const ACTION_BADGE: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; className?: string }> = {
  approved:    { variant: 'default', className: 'bg-green-600 hover:bg-green-700 text-white' },
  activated:   { variant: 'default', className: 'bg-green-600 hover:bg-green-700 text-white' },
  created:     { variant: 'default', className: 'bg-green-600 hover:bg-green-700 text-white' },
  rejected:    { variant: 'destructive' },
  deleted:     { variant: 'destructive' },
  deactivated: { variant: 'destructive' },
  invited:     { variant: 'default', className: 'bg-blue-600 hover:bg-blue-700 text-white' },
  exported:    { variant: 'secondary' },
  updated:     { variant: 'secondary' },
  reassigned:  { variant: 'secondary' },
};

const AuditLog: React.FC = () => {
  const { user, organization } = useAuth();

  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [entityFilter, setEntityFilter] = useState<string>('all');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [page, setPage] = useState(0);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('audit_log')
        .select('*, actor:users!actor_id(name, email)')
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (entityFilter !== 'all') query = query.eq('entity_type', entityFilter);
      if (actionFilter !== 'all') query = query.eq('action', actionFilter);

      const { data, error } = await query;
      if (error) throw error;
      setLogs((data as AuditLogEntry[]) || []);
    } catch (err) {
      console.error('AuditLog fetch error:', err);
      toast.error('Failed to fetch audit logs');
    } finally {
      setLoading(false);
    }
  }, [entityFilter, actionFilter, page]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Reset to first page when filters change
  useEffect(() => {
    setPage(0);
  }, [entityFilter, actionFilter]);

  const handleExportCSV = () => {
    if (!logs.length) {
      toast.error('No logs to export');
      return;
    }

    const header = 'Timestamp,Actor,Action,Entity Type,Entity ID,Changes';
    const rows = logs.map(log => {
      const timestamp = format(new Date(log.created_at), 'yyyy-MM-dd HH:mm:ss');
      const actor = log.actor?.name || 'System';
      const changes = log.changes ? JSON.stringify(log.changes).replace(/"/g, '""') : '';
      return `"${timestamp}","${actor}","${log.action}","${log.entity_type}","${log.entity_id}","${changes}"`;
    });

    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `zeptra-audit-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    toast.success(`Exported ${logs.length} audit log entries`);

    // Log this export action
    if (user && organization) {
      logExport({ org_id: organization.id, actor_id: user.id,
        export_type: 'audit_csv', record_count: logs.length });
    }
  };

  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Shield className="h-7 w-7 text-primary" />
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            Audit Log
          </h1>
        </div>
        <p className="text-muted-foreground mt-1">Complete record of all actions in your organization</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row gap-3">
            <Select value={entityFilter} onValueChange={setEntityFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Entity type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Entities</SelectItem>
                <SelectItem value="expense">Expense</SelectItem>
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="organization">Organization</SelectItem>
                <SelectItem value="category">Category</SelectItem>
                <SelectItem value="approval">Approval</SelectItem>
              </SelectContent>
            </Select>

            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Action" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                <SelectItem value="created">Created</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="invited">Invited</SelectItem>
                <SelectItem value="activated">Activated</SelectItem>
                <SelectItem value="deactivated">Deactivated</SelectItem>
                <SelectItem value="exported">Exported</SelectItem>
                <SelectItem value="deleted">Deleted</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex-1" />

            <Button variant="outline" onClick={handleExportCSV}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Changes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground"/>
                </TableCell></TableRow>
              ) : logs.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  No records found
                </TableCell></TableRow>
              ) : (
                logs.map(log => {
                  const badgeStyle = ACTION_BADGE[log.action] || { variant: 'secondary' as const };
                  return (
                    <TableRow key={log.id}>
                      <TableCell className="text-sm whitespace-nowrap">
                        {format(new Date(log.created_at), 'dd MMM yyyy, HH:mm')}
                      </TableCell>
                      <TableCell className="text-sm">
                        {log.actor?.name || 'System'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={badgeStyle.variant} className={badgeStyle.className}>
                          {capitalize(log.action)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {capitalize(log.entity_type)} · <span className="font-mono text-xs text-muted-foreground">{log.entity_id.slice(0, 8)}</span>
                      </TableCell>
                      <TableCell>
                        {log.changes ? (
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                                <Eye className="mr-1 h-3 w-3" />
                                View
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="max-w-xs p-3" align="start">
                              <pre className="text-xs max-h-48 overflow-auto whitespace-pre-wrap">
                                {JSON.stringify(log.changes, null, 2)}
                              </pre>
                            </PopoverContent>
                          </Popover>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-4 pt-4 border-t">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage(p => Math.max(0, p - 1))}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">Page {page + 1}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={logs.length < PAGE_SIZE}
              onClick={() => setPage(p => p + 1)}
            >
              Next
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AuditLog;
