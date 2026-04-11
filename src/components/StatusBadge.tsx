import { ExpenseStatus } from '@/types/database';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const statusConfig: Record<ExpenseStatus, { label: string; className: string }> = {
  pending_l1: { label: 'Pending L1', className: 'bg-warning/15 text-warning border-warning/30' },
  pending_l2: { label: 'Pending L2', className: 'bg-info/15 text-info border-info/30' },
  approved: { label: 'Approved', className: 'bg-success/15 text-success border-success/30' },
  rejected: { label: 'Rejected', className: 'bg-destructive/15 text-destructive border-destructive/30' },
};

export function StatusBadge({ status }: { status: ExpenseStatus }) {
  const config = statusConfig[status];
  return (
    <Badge variant="outline" className={cn('font-medium', config.className)}>
      {config.label}
    </Badge>
  );
}
