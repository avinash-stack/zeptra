import { z } from 'zod';

export const expenseSchema = z.object({
  amount: z.string()
    .min(1, 'Amount is required')
    .refine(v => !isNaN(parseFloat(v)) && parseFloat(v) > 0, 'Amount must be a positive number')
    .refine(v => parseFloat(v) <= 10_000_000, 'Amount seems too large — please verify'),
  currency: z.string().min(1, 'Currency is required'),
  categoryId: z.string().uuid('Please select a category'),
  description: z.string()
    .min(5, 'Description must be at least 5 characters')
    .max(500, 'Description must be under 500 characters'),
  expenseDate: z.string()
    .min(1, 'Date is required')
    .refine(v => {
      const d = new Date(v);
      const today = new Date();
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(today.getFullYear() - 1);
      return d <= today && d >= oneYearAgo;
    }, 'Date must be within the last year and not in the future'),
  gstNumber: z.string()
    .optional()
    .refine(v => !v || /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(v), 
      'Invalid GSTIN format (must be 15 characters)'),
});

export type ExpenseFormValues = z.infer<typeof expenseSchema>;
