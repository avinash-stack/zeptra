import { z } from 'zod';

export const expenseSchema = z.object({
  amount: z.string()
    .min(1, 'Amount is required')
    .refine(v => !isNaN(parseFloat(v)) && parseFloat(v) > 0, 'Amount must be a positive number')
    .refine(v => parseFloat(v) <= 1_000_000_000, 'Amount seems too large — please verify'),
  currency: z.string().min(1, 'Currency is required'),
  categoryId: z.string().uuid('Please select a category'),
  description: z.string()
    .min(3, 'Description must be at least 3 characters')
    .max(500, 'Description must be under 500 characters'),
  expenseDate: z.string()
    .min(1, 'Date is required')
    .refine(v => {
      const parts = v.split('-');
      const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      const today = new Date();
      const localToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const oneYearAgo = new Date(localToday);
      oneYearAgo.setFullYear(localToday.getFullYear() - 1);
      return d <= localToday && d >= oneYearAgo;
    }, 'Date must be within the last year and not in the future'),
  gstNumber: z.string()
    .optional()
    .refine(v => !v || /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(v), 
      'Invalid GSTIN format (must be 15 characters)'),
});

export type ExpenseFormValues = z.infer<typeof expenseSchema>;
