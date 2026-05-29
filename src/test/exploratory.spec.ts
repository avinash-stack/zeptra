import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Mock session and database data
const MOCK_USER_ID = 'da51f887-b610-4bf6-be86-90bf9e34e567';
const MOCK_ORG_ID = 'c0448123-1111-4444-be23-555555555555';
const DIST_DIR = '/Volumes/Cop/zeptra/dist';

const mockSession = {
  access_token: 'mock-access-token',
  token_type: 'bearer',
  expires_in: 3600,
  refresh_token: 'mock-refresh-token',
  user: {
    id: MOCK_USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'qa-tester@company.com',
    email_confirmed_at: '2026-05-29T10:00:00Z',
    phone: '',
    confirmed_at: '2026-05-29T10:00:00Z',
    last_sign_in_at: '2026-05-29T10:00:00Z',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { name: 'QA Tester', first_name: 'QA', last_name: 'Tester' },
    identities: [],
    created_at: '2026-05-29T10:00:00Z',
    updated_at: '2026-05-29T10:00:00Z'
  },
  expires_at: 19758843320
};

test.describe('Submit Expense Exploratory QA Tests', () => {
  test.beforeEach(async ({ page }) => {
    // 1. Intercept all localhost:8080 requests and serve from local dist/ folder
    await page.route('http://localhost:8080/**', async route => {
      const url = route.request().url();
      const pathname = new URL(url).pathname;
      let filePath = path.join(DIST_DIR, pathname);

      // If it's a SPA route (doesn't have file extension), serve index.html
      if (!path.extname(pathname)) {
        filePath = path.join(DIST_DIR, 'index.html');
      }

      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const MIME_TYPES: Record<string, string> = {
          '.html': 'text/html',
          '.css': 'text/css',
          '.js': 'text/javascript',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.webp': 'image/webp',
          '.svg': 'image/svg+xml',
          '.json': 'application/json',
        };
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        await route.fulfill({
          status: 200,
          contentType,
          body: content
        });
      } else {
        await route.fulfill({
          status: 404,
          body: 'Not Found'
        });
      }
    });

    // 2. Intercept Supabase API calls and return mocked data
    await page.route('**/supabase.co/auth/v1/session', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockSession) });
    });

    await page.route('**/supabase.co/rest/v1/users?*', async route => {
      const url = route.request().url();
      if (url.includes('manager_id=eq.')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([{
            id: MOCK_USER_ID,
            org_id: MOCK_ORG_ID,
            name: 'QA Tester',
            email: 'qa-tester@company.com',
            first_name: 'QA',
            last_name: 'Tester',
            phone: null,
            manager_id: '88888888-8888-8888-8888-888888888888',
            tag: 'QA Team',
            status: 'active',
            created_at: '2026-05-29T10:00:00Z',
            updated_at: '2026-05-29T10:00:00Z'
          }])
        });
      }
    });

    await page.route('**/supabase.co/rest/v1/user_roles?*', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ role: 'employee' }]) });
    });

    await page.route('**/supabase.co/rest/v1/organizations?*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{
          id: MOCK_ORG_ID,
          name: 'QA Corp',
          slug: 'qa-corp',
          corporate_email: 'admin@qacorp.com',
          business_phone: null,
          created_by: MOCK_USER_ID,
          created_at: '2026-05-29T10:00:00Z',
          updated_at: '2026-05-29T10:00:00Z'
        }])
      });
    });

    await page.route('**/supabase.co/rest/v1/expense_categories?*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: '11111111-1111-1111-1111-111111111111', org_id: MOCK_ORG_ID, name: 'Travel', is_active: true },
          { id: '22222222-2222-2222-2222-222222222222', org_id: MOCK_ORG_ID, name: 'Meals', is_active: true },
          { id: '33333333-3333-3333-3333-333333333333', org_id: MOCK_ORG_ID, name: 'Software', is_active: true }
        ])
      });
    });

    await page.route('**/supabase.co/rest/v1/org_currencies?*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: '44444444-4444-4444-4444-444444444444', org_id: MOCK_ORG_ID, code: 'INR', symbol: '₹', name: 'Indian Rupee', is_default: true },
          { id: '55555555-5555-5555-5555-555555555555', org_id: MOCK_ORG_ID, code: 'USD', symbol: '$', name: 'US Dollar', is_default: false },
          { id: '66666666-6666-6666-6666-666666666666', org_id: MOCK_ORG_ID, code: 'IDR', symbol: 'Rp', name: 'Indonesian Rupiah', is_default: false }
        ])
      });
    });

    await page.route('**/supabase.co/rest/v1/category_limits?*', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    await page.route('**/supabase.co/rest/v1/expenses', async route => {
      if (route.request().method() === 'POST') {
        const payload = route.request().postDataJSON();
        console.log('Intercepted Expense Submission:', JSON.stringify(payload, null, 2));
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ success: true }) });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      }
    });

    // Populate mock auth token in localStorage before loading any page
    await page.addInitScript(token => {
      window.localStorage.setItem('sb-qwkmzfynwfkuvymgbbro-auth-token', JSON.stringify(token));
    }, mockSession);
  });

  test('exploratory testing on input fields', async ({ page }) => {
    // Go to submit page
    await page.goto('http://localhost:8080/app/submit');

    // Wait for the form to be visible
    await page.waitForSelector('form');

    console.log('--- EXPLORATORY TEST ROUND ---');

    // 1. Check Description character limit boundary (minimum 5 chars)
    console.log('Testing description field with too short text (4 chars): "Taxi"');
    await page.fill('#description', 'Taxi');
    
    // Select category (radix select)
    await page.click('button:has-text("Select category")');
    await page.click('role=option[name="Travel"]');

    // Fill amount
    await page.fill('#amount', '150');

    // Attempt to submit
    await page.click('button[type="submit"]');

    // Expect description error message to appear
    const descError = page.locator('text=Description must be at least 5 characters');
    await expect(descError).toBeVisible();
    console.log('✔ Confirmed: Description validation fails for short entries like "Taxi"');

    // 2. Check Amount upper limit boundary (10,000,000)
    console.log('Testing amount field with 10,000,001 (exceeding 10M limit)');
    await page.fill('#amount', '10000001');
    await page.fill('#description', 'Valid description for testing');
    
    await page.click('button[type="submit"]');
    const amountError = page.locator('text=Amount seems too large');
    await expect(amountError).toBeVisible();
    console.log('✔ Confirmed: Amount validation fails for values exceeding 10,000,000');

    // 3. Check GSTIN field formatting and regex validation
    console.log('Opening GST section');
    await page.click('button:has-text("GST Details")');
    
    console.log('Testing GSTIN with trailing spaces');
    await page.fill('#gstin', '22AAAAA0000A1Z5 '); // trailing space
    await page.click('button[type="submit"]');
    const gstinError = page.locator('text=Invalid GSTIN format');
    await expect(gstinError).toBeVisible();
    console.log('✔ Confirmed: GSTIN fails on trailing spaces');

    // 4. Test Timezone Boundary paradox
    console.log('Testing tomorrow date limit');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    
    await page.fill('#expense-date', tomorrowStr);
    await page.click('button[type="submit"]');
    const dateError = page.locator('text=Date must be within the last year and not in the future');
    await expect(dateError).toBeVisible();
    console.log('✔ Confirmed: Future date validation works as expected');
  });
});
