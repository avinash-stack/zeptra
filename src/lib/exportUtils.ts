import type { ExpenseWithDetails } from '@/types/database';

export function exportToCSV(expenses: ExpenseWithDetails[], orgName: string): void {
  const headers = ['Date', 'Reference', 'Description', 'Employee', 'Category', 'GL Code', 'Amount', 'Currency', 'Status', 'Approved Date'];
  const rows = expenses.map(e => [
    new Date(e.submitted_at).toLocaleDateString('en-IN'),
    `EXP-${e.id.slice(0,8).toUpperCase()}`,
    `"${e.description.replace(/"/g, '""')}"`,
    (e as any).users?.name || '',
    (e as any).expense_categories?.name || '',
    (e as any).expense_categories?.gl_code || '',
    Number(e.amount).toFixed(2),
    e.currency,
    e.status,
    e.decided_at ? new Date(e.decided_at).toLocaleDateString('en-IN') : ''
  ]);
  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeOrgName = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  a.download = `${safeOrgName}-expenses-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportToTallyXML(expenses: ExpenseWithDetails[], orgName: string): void {
  const approved = expenses.filter(e => e.status === 'approved');
  
  const messages = approved.map(e => {
    const dateStr = new Date(e.submitted_at).toISOString().slice(0, 10).replace(/-/g, '');
    const empName = (e as any).users?.name || 'Unknown';
    const catName = (e as any).expense_categories?.name || 'Uncategorized';
    const glCode = (e as any).expense_categories?.gl_code || catName;
    const ref = `EXP-${e.id.slice(0,8).toUpperCase()}`;
    const amount = Number(e.amount).toFixed(2);
    
    return `        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="Payment" ACTION="Create" OBJVIEW="Accounting Voucher View">
            <DATE>${dateStr}</DATE>
            <NARRATION>${e.description} - ${empName}</NARRATION>
            <VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>
            <VOUCHERNUMBER>${ref}</VOUCHERNUMBER>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${glCode}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <AMOUNT>-${amount}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>Cash</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>${amount}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
          </VOUCHER>
        </TALLYMESSAGE>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${orgName}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
${messages}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;

  const blob = new Blob([xml], { type: 'text/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeOrgName = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  a.download = `${safeOrgName}-tally-${new Date().toISOString().slice(0,10)}.xml`;
  a.click();
  URL.revokeObjectURL(url);
}
