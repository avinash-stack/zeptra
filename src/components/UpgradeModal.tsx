import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Check, X, Copy, Sparkles, CreditCard, Crown, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { usePlanLimit } from '@/hooks/usePlanLimit';
import { useAuth } from '@/contexts/AuthContext';

interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
  country: string;
}

const UpgradeModal: React.FC<UpgradeModalProps> = ({ open, onClose, country }) => {
  const { userCount, isInTrial, subscription } = usePlanLimit();
  const { organization } = useAuth();

  const isIndia = country === 'IN';
  const currency = isIndia ? '₹' : '$';
  const pricePerUser = isIndia ? 49 : 1;
  const monthlyTotal = pricePerUser * Math.max(userCount, 1);

  const orgSlug = organization?.slug || 'ORG';

  const copyReference = () => {
    const ref = `ZEPTRA-${orgSlug}`;
    navigator.clipboard.writeText(ref).then(
      () => toast.success('Reference copied to clipboard!'),
      () => toast.error('Failed to copy — please copy manually.'),
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Zap className="h-5 w-5 text-primary" />
            Upgrade to Pro
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Pricing summary */}
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
            <p className="text-sm text-muted-foreground">
              Your organization has{' '}
              <span className="font-semibold text-foreground">{userCount} user{userCount !== 1 ? 's' : ''}</span>.
            </p>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-3xl font-bold text-primary">
                {currency}{monthlyTotal.toLocaleString()}
              </span>
              <span className="text-sm text-muted-foreground">/month</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {currency}{pricePerUser} per user per month × {userCount} user{userCount !== 1 ? 's' : ''}
            </p>
          </div>

          {/* Pricing comparison table */}
          <div>
            <h3 className="text-sm font-semibold mb-3">Plan comparison</h3>
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[180px]">Feature</TableHead>
                    <TableHead className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <CreditCard className="h-3.5 w-3.5" /> Free
                      </div>
                    </TableHead>
                    <TableHead className="text-center bg-primary/5">
                      <div className="flex items-center justify-center gap-1 text-primary font-semibold">
                        <Zap className="h-3.5 w-3.5" /> Pro
                      </div>
                    </TableHead>
                    <TableHead className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Crown className="h-3.5 w-3.5" /> Enterprise
                      </div>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">Users</TableCell>
                    <TableCell className="text-center">5</TableCell>
                    <TableCell className="text-center bg-primary/5 font-semibold">Unlimited</TableCell>
                    <TableCell className="text-center">Unlimited</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Expenses/month</TableCell>
                    <TableCell className="text-center">50</TableCell>
                    <TableCell className="text-center bg-primary/5 font-semibold">Unlimited</TableCell>
                    <TableCell className="text-center">Unlimited</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Analytics</TableCell>
                    <TableCell className="text-center"><X className="h-4 w-4 mx-auto text-muted-foreground" /></TableCell>
                    <TableCell className="text-center bg-primary/5"><Check className="h-4 w-4 mx-auto text-success" /></TableCell>
                    <TableCell className="text-center"><Check className="h-4 w-4 mx-auto text-success" /></TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Tally & CSV export</TableCell>
                    <TableCell className="text-center"><X className="h-4 w-4 mx-auto text-muted-foreground" /></TableCell>
                    <TableCell className="text-center bg-primary/5"><X className="h-4 w-4 mx-auto text-muted-foreground" /></TableCell>
                    <TableCell className="text-center"><Check className="h-4 w-4 mx-auto text-success" /></TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">API access</TableCell>
                    <TableCell className="text-center"><X className="h-4 w-4 mx-auto text-muted-foreground" /></TableCell>
                    <TableCell className="text-center bg-primary/5"><Check className="h-4 w-4 mx-auto text-success" /></TableCell>
                    <TableCell className="text-center"><Check className="h-4 w-4 mx-auto text-success" /></TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Priority support</TableCell>
                    <TableCell className="text-center"><X className="h-4 w-4 mx-auto text-muted-foreground" /></TableCell>
                    <TableCell className="text-center bg-primary/5"><Check className="h-4 w-4 mx-auto text-success" /></TableCell>
                    <TableCell className="text-center"><Check className="h-4 w-4 mx-auto text-success" /></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Bank transfer details */}
          <div>
            <h3 className="text-sm font-semibold mb-3">How to upgrade</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Transfer your monthly amount to the account below. We'll activate Pro within 24 hours of confirmation.
            </p>
            <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3 font-mono text-sm">
              <div className="grid grid-cols-[120px_1fr] gap-y-2 gap-x-3">
                <span className="text-muted-foreground">Bank</span>
                <span className="font-semibold">[PLACEHOLDER]</span>

                <span className="text-muted-foreground">Account Name</span>
                <span className="font-semibold">[PLACEHOLDER]</span>

                <span className="text-muted-foreground">Account No.</span>
                <span className="font-semibold">[PLACEHOLDER]</span>

                {isIndia ? (
                  <>
                    <span className="text-muted-foreground">IFSC Code</span>
                    <span className="font-semibold">[PLACEHOLDER]</span>
                  </>
                ) : (
                  <>
                    <span className="text-muted-foreground">Swift Code</span>
                    <span className="font-semibold">[PLACEHOLDER]</span>
                  </>
                )}

                <span className="text-muted-foreground">Amount</span>
                <span className="font-semibold text-primary">{currency}{monthlyTotal.toLocaleString()}</span>

                <span className="text-muted-foreground">Reference</span>
                <span className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono text-xs px-2 py-1 border-primary/30 bg-primary/5">
                    ZEPTRA-{orgSlug}
                  </Badge>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={copyReference}>
                    <Copy className="h-3 w-3 mr-1" /> Copy
                  </Button>
                </span>
              </div>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              After transferring, email us at{' '}
              <span className="font-semibold text-foreground">[PLACEHOLDER@email.com]</span>{' '}
              with your payment confirmation. We'll activate Pro within 24 hours.
            </p>
          </div>

          {/* Trial note — only shown during active trial */}
          {isInTrial && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
              <Sparkles className="h-4 w-4 mt-0.5 shrink-0 text-warning" />
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-warning">💡 Your 14-day free trial includes all Pro features.</span>{' '}
                You only need to upgrade if you'd like to continue after the trial period.
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default UpgradeModal;
