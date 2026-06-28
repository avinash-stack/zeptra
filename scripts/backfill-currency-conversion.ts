/**
 * ONE-TIME MIGRATION SCRIPT
 * Backfill base_amount / exchange_rate / rate_date / base_currency
 * for all expenses that currently have base_amount = NULL.
 *
 * Run with:
 *   npx -y tsx scripts/backfill-currency-conversion.ts
 *
 * Required env vars (export before running, or use a .env loader):
 *   SUPABASE_URL              — your project's Supabase URL
 *   SUPABASE_SERVICE_ROLE_KEY — service role key (bypasses RLS)
 */

import { createClient } from '@supabase/supabase-js';

// ── Config ──────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH_SIZE = 50;
const API_DELAY_MS = 200; // polite delay between Frankfurter calls

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Helpers ─────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Cache of org_id → default currency code */
const orgDefaultCurrencyCache = new Map<string, string>();

async function getDefaultCurrency(orgId: string): Promise<string> {
  if (orgDefaultCurrencyCache.has(orgId)) {
    return orgDefaultCurrencyCache.get(orgId)!;
  }

  const { data } = await supabase
    .from('org_currencies')
    .select('code')
    .eq('org_id', orgId)
    .eq('is_default', true)
    .single();

  const code = data?.code || 'USD';
  orgDefaultCurrencyCache.set(orgId, code);
  return code;
}

function formatDate(dateValue: string | null): string {
  // expenses.submitted_at is a timestamptz — extract YYYY-MM-DD
  if (!dateValue) return new Date().toISOString().slice(0, 10);
  return new Date(dateValue).toISOString().slice(0, 10);
}

interface FrankfurterResult {
  converted_amount: number;
  rate: number;
  rate_date: string;
}

async function fetchRate(
  amount: number,
  from: string,
  to: string,
  date: string,
): Promise<FrankfurterResult | null> {
  const url = `https://api.frankfurter.app/${date}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`  ⚠ Frankfurter ${res.status} for ${from}→${to} on ${date}`);
      return null;
    }
    const data = await res.json();
    const rate = data?.rates?.[to];
    if (rate == null || typeof rate !== 'number') {
      console.warn(`  ⚠ No rate for ${to} in response:`, JSON.stringify(data));
      return null;
    }
    return {
      converted_amount: Math.round(amount * rate * 100) / 100,
      rate,
      rate_date: data.date, // may differ from requested date (weekends/holidays)
    };
  } catch (err) {
    console.warn(`  ⚠ Network error for ${from}→${to} on ${date}:`, err);
    return null;
  }
}

// ── Main ────────────────────────────────────────────────────────
async function main() {
  console.log('🚀 Backfill currency conversion — starting\n');

  let totalProcessed = 0;
  let totalSucceeded = 0;
  const failures: string[] = [];
  let batchNumber = 0;

  // Process in batches — keep fetching until no more NULL base_amount rows
  while (true) {
    batchNumber++;
    const { data: batch, error } = await supabase
      .from('expenses')
      .select('id, org_id, amount, currency, submitted_at')
      .is('base_amount', null)
      .order('submitted_at', { ascending: true })
      .limit(BATCH_SIZE);

    if (error) {
      console.error('❌ Failed to fetch batch:', error.message);
      break;
    }

    if (!batch || batch.length === 0) {
      console.log('✅ No more expenses with NULL base_amount.\n');
      break;
    }

    console.log(`📦 Batch ${batchNumber}: ${batch.length} expenses`);

    for (const expense of batch) {
      totalProcessed++;
      const baseCurrency = await getDefaultCurrency(expense.org_id);
      const expenseDate = formatDate(expense.submitted_at);
      const amount = Number(expense.amount);

      if (expense.currency === baseCurrency) {
        // Same currency — no API call needed
        const { error: updateError } = await supabase
          .from('expenses')
          .update({
            base_amount: amount,
            base_currency: baseCurrency,
            exchange_rate: 1,
            rate_date: expenseDate,
          })
          .eq('id', expense.id);

        if (updateError) {
          console.warn(`  ✗ ${expense.id} — update failed: ${updateError.message}`);
          failures.push(expense.id);
        } else {
          totalSucceeded++;
        }
        continue;
      }

      // Different currency — call Frankfurter
      const result = await fetchRate(amount, expense.currency, baseCurrency, expenseDate);

      if (!result) {
        console.warn(`  ✗ ${expense.id} — conversion failed (${expense.currency}→${baseCurrency} on ${expenseDate})`);
        failures.push(expense.id);
      } else {
        const { error: updateError } = await supabase
          .from('expenses')
          .update({
            base_amount: result.converted_amount,
            base_currency: baseCurrency,
            exchange_rate: result.rate,
            rate_date: result.rate_date,
          })
          .eq('id', expense.id);

        if (updateError) {
          console.warn(`  ✗ ${expense.id} — update failed: ${updateError.message}`);
          failures.push(expense.id);
        } else {
          totalSucceeded++;
          console.log(`  ✓ ${expense.id}  ${expense.currency} ${amount} → ${baseCurrency} ${result.converted_amount} (rate: ${result.rate}, date: ${result.rate_date})`);
        }
      }

      // Polite delay between API calls
      await sleep(API_DELAY_MS);
    }

    console.log('');
  }

  // ── Summary ─────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════');
  console.log('  BACKFILL COMPLETE');
  console.log('═══════════════════════════════════════════');
  console.log(`  Total processed:  ${totalProcessed}`);
  console.log(`  Succeeded:        ${totalSucceeded}`);
  console.log(`  Failed:           ${failures.length}`);
  if (failures.length > 0) {
    console.log('');
    console.log('  Failed expense IDs (for manual follow-up):');
    failures.forEach(id => console.log(`    - ${id}`));
  }
  console.log('═══════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('❌ Unhandled error:', err);
  process.exit(1);
});
