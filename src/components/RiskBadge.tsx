import React from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface RiskBadgeProps {
  analysis: { risk_level: string; flags: string[]; suggestion: string } | null;
  loading?: boolean;
}

export function RiskBadge({ analysis, loading }: RiskBadgeProps) {
  if (loading) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="w-3 h-3 animate-spin" /> Analyzing...
      </span>
    );
  }

  if (!analysis) return null;

  const config = {
    low:    { label: 'Low risk',  className: 'bg-green-100 text-green-700 border-green-200' },
    medium: { label: 'Review',    className: 'bg-amber-100 text-amber-700 border-amber-200' },
    high:   { label: 'High risk', className: 'bg-red-100 text-red-700 border-red-200' },
  }[analysis.risk_level] || { label: 'Unknown', className: 'bg-gray-100 text-gray-600 border-gray-200' };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium cursor-pointer ${config.className}`}>
          <AlertTriangle className="w-3 h-3" />
          {config.label}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="start">
        <p className="text-xs font-medium text-foreground mb-2">AI Analysis</p>
        {analysis.flags.length > 0 && (
          <ul className="space-y-1 mb-2">
            {analysis.flags.map((flag, i) => (
              <li key={i} className="text-xs text-muted-foreground flex gap-1">
                <span className="text-amber-500 flex-shrink-0">•</span> {flag}
              </li>
            ))}
          </ul>
        )}
        {analysis.suggestion && (
          <p className="text-xs text-foreground bg-muted/50 rounded p-2">{analysis.suggestion}</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
