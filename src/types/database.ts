// ============================================================
// Zeptra Database Types
// ============================================================

// Roles — 'manager' removed; manager access is determined by
// the users.manager_id relationship
export type AppRole = 'admin' | 'employee' | 'hr' | 'finance';
export type ExpenseStatus = 'pending_l1' | 'pending_l2' | 'approved' | 'rejected';
export type ApprovalAction = 'approved' | 'rejected' | 'reassigned';
export type ProfileStatus = 'active' | 'inactive';

// ---- Organizations ----

export interface Organization {
  id: string;
  name: string;
  slug: string;
  corporate_email: string;
  business_phone: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrgCurrency {
  id: string;
  org_id: string;
  code: string;
  symbol: string;
  name: string;
  is_default: boolean;
}

// ---- Users (table: public.users) ----

export interface Profile {
  id: string;
  org_id: string | null;
  name: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  manager_id: string | null;
  tag: string | null;
  status: ProfileStatus;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserRole {
  id: string;
  user_id: string;
  role: AppRole;
}

// ---- Expense Categories ----

export interface ExpenseCategory {
  id: string;
  org_id: string | null;
  name: string;
  gl_code?: string | null;
  is_active: boolean;
  created_at: string;
}

// ---- Expenses ----

export interface Expense {
  id: string;
  user_id: string;
  amount: number;
  currency: string;
  category_id: string;
  description: string;
  receipt_url: string | null;
  status: ExpenseStatus;
  current_approver_id: string | null;
  submitted_at: string;
  decided_at: string | null;
  is_policy_exception: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ApprovalHistory {
  id: string;
  expense_id: string;
  approver_id: string;
  action: ApprovalAction;
  level: number;
  reassigned_to: string | null;
  comments: string | null;
  acted_at: string;
}

// ---- Joined / Extended ----

export interface ExpenseWithDetails extends Expense {
  users?: Profile;
  expense_categories?: ExpenseCategory;
}

// ---- Billing / Subscriptions ----

export type PlanType = 'free' | 'pro' | 'enterprise';

export interface Subscription {
  id: string;
  org_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: PlanType;
  status: string;
  current_period_end: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlanLimit {
  plan: PlanType;
  max_users: number | null;
  max_expenses_per_month: number | null;
  has_analytics: boolean;
  has_api: boolean;
}

// ---- Notification Preferences ----

export interface NotificationPreferences {
  id: string;
  user_id: string;
  on_expense_submitted: boolean;
  on_expense_approved: boolean;
  on_expense_rejected: boolean;
  on_approval_needed: boolean;
}

// ---- Category Spend Limits ----

export interface CategoryLimit {
  id: string;
  org_id: string;
  category_id: string;
  monthly_limit: number | null;
  per_expense_limit: number | null;
  created_at: string;
  updated_at: string;
}

// ---- Audit Log ----

export interface AuditLog {
  id: string;
  org_id: string;
  actor_id: string | null;
  entity_type: 'expense' | 'user' | 'organization' | 'category' | 'approval';
  entity_id: string;
  action: 'created' | 'updated' | 'approved' | 'rejected' | 'reassigned' |
    'invited' | 'deactivated' | 'activated' | 'exported' | 'deleted';
  changes: Record<string, unknown> | null;
  created_at: string;
  // Joined fields
  actor?: { name: string; email: string } | null;
}
