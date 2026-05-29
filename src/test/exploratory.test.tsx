import { describe, it, expect } from 'vitest';
import { expenseSchema } from '../lib/expenseSchema';

describe('SubmitExpense Zod Validation Schema Boundary Tests', () => {
  const validData = {
    amount: '150.00',
    currency: 'INR',
    categoryId: '11111111-1111-1111-1111-111111111111',
    description: 'Travel to Client office',
    expenseDate: new Date().toISOString().split('T')[0],
    gstNumber: '22AAAAA0000A1Z5',
  };

  it('passes validation for fully valid data', () => {
    const result = expenseSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it('fails validation when description is less than 3 characters ("Go")', () => {
    const invalidData = { ...validData, description: 'Go' };
    const result = expenseSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errorMsg = result.error.errors.find(e => e.path.includes('description'))?.message;
      expect(errorMsg).toBe('Description must be at least 3 characters');
    }
  });

  it('fails validation when amount exceeds the 1,000,000,000 limit', () => {
    const invalidData = { ...validData, amount: '1000000001' };
    const result = expenseSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errorMsg = result.error.errors.find(e => e.path.includes('amount'))?.message;
      expect(errorMsg).toBe('Amount seems too large — please verify');
    }
  });

  it('fails validation when GSTIN has trailing spaces or invalid structure', () => {
    const invalidData = { ...validData, gstNumber: '22AAAAA0000A1Z5 ' }; // trailing space
    const result = expenseSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errorMsg = result.error.errors.find(e => e.path.includes('gstNumber'))?.message;
      expect(errorMsg).toBe('Invalid GSTIN format (must be 15 characters)');
    }
  });

  it('fails validation when date is in the future (Timezone border check)', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    const invalidData = { ...validData, expenseDate: tomorrowStr };
    const result = expenseSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errorMsg = result.error.errors.find(e => e.path.includes('expenseDate'))?.message;
      expect(errorMsg).toBe('Date must be within the last year and not in the future');
    }
  });
});
