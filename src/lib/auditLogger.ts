import { supabase } from '@/integrations/supabase/client';

export type AuditAction = 'created' | 'updated' | 'approved' | 'rejected' |
  'reassigned' | 'invited' | 'deactivated' | 'activated' | 'exported' | 'deleted';

export type AuditEntityType = 'expense' | 'user' | 'organization' | 'category' | 'approval';

export async function logAudit(params: {
  org_id: string;
  actor_id: string;
  entity_type: AuditEntityType;
  entity_id: string;
  action: AuditAction;
  changes?: Record<string, unknown>;
}): Promise<void> {
  try {
    await supabase.from('audit_log').insert(params);
  } catch {
    // Never throw — audit logging must never block user actions
  }
}
