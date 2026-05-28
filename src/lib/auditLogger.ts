import { supabase } from '@/integrations/supabase/client';

// Audit logging now happens via DB triggers for all entity changes.
// This helper is ONLY for export actions (writes to exports_log, trigger handles audit_log).
export async function logExport(params: {
  org_id: string;
  actor_id: string;
  export_type: 'csv' | 'tally_xml' | 'audit_csv';
  record_count: number;
}): Promise<void> {
  try {
    await supabase.from('exports_log').insert(params);
  } catch {
    // Never throw — export logging must never block user actions
  }
}
