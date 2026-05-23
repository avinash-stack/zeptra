import { ExpenseStatus } from '@/types/database';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const statusConfig: Record<ExpenseStatus, { managerLabel: string; employeeLabel: string; className: string }> = {
  pending_l1: { managerLabel: 'Pending L1', employeeLabel: 'Awaiting approval', className: 'bg-warning/15 text-warning border-warning/30' },
  pending_l2: { managerLabel: 'Pending L2', employeeLabel: 'Under review', className: 'bg-info/15 text-info border-info/30' },
  approved: { managerLabel: 'Approved', employeeLabel: 'Approved', className: 'bg-success/15 text-success border-success/30' },
  rejected: { managerLabel: 'Rejected', employeeLabel: 'Rejected', className: 'bg-destructive/15 text-destructive border-destructive/30' },
};

export function StatusBadge({ status, managerView = false }: { status: ExpenseStatus; managerView?: boolean }) {
  const config = statusConfig[status];
  return (
    <Badge variant="outline" className={cn('font-medium', config.className)}>
      {managerView ? config.managerLabel : config.employeeLabel}
    </Badge>
  );
}
