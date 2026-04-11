// ============================================================
// Zeptra Database Types
// ============================================================

// Roles — 'manager' removed; manager access is determined by
// the profiles.manager_id relationship
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
  code: string;   // e.g. 'USD'
  symbol: string;  // e.g. '$'
  name: string;    // e.g. 'US Dollar'
  is_default: boolean;
}

// ---- Users ----

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
  profiles?: Profile;
  expense_categories?: ExpenseCategory;
}
