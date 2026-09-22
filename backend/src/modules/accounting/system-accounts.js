// The minimum chart of accounts every company needs for the flows that already
// exist (purchases, purchase returns, supplier payments, sales, sales returns,
// customer payments).
//
// A system account is resolved by (companyId, code) - NEVER by a hard-coded id,
// and never by name. The code is the stable contract between the posting engine
// and the database, which is why a system account's code can never be changed
// and a system account can never be deleted or deactivated.
//
// Numbering follows the usual convention:
//   1xxx assets   2xxx liabilities   3xxx equity   4xxx revenue   5xxx expense

export const SYSTEM_ACCOUNT = {
  CASH: '1000',
  BANK: '1010',
  ACCOUNTS_RECEIVABLE: '1200',
  INVENTORY: '1300',
  ADVANCE_TO_SUPPLIERS: '1400',
  INPUT_TAX_CREDIT: '1500',
  INPUT_CGST: '1510',
  INPUT_SGST: '1520',
  INPUT_IGST: '1530',
  INPUT_CESS: '1540',

  ACCOUNTS_PAYABLE: '2000',
  TAX_PAYABLE: '2100',
  OUTPUT_CGST: '2110',
  OUTPUT_SGST: '2120',
  OUTPUT_IGST: '2130',
  OUTPUT_CESS: '2140',
  CUSTOMER_ADVANCES: '2200',

  OWNERS_CAPITAL: '3000',

  SALES_REVENUE: '4000',
  SALES_RETURNS: '4100',

  COST_OF_GOODS_SOLD: '5000',
  INVENTORY_VALUATION_ADJUSTMENT: '5100',
  OPERATING_EXPENSES: '5200',
  RENT: '5210',
  ELECTRICITY: '5215',
  WATER: '5220',
  INTERNET_TELEPHONE: '5225',
  SALARIES_WAGES: '5230',
  TRANSPORTATION: '5235',
  REPAIRS_MAINTENANCE: '5240',
  OFFICE_EXPENSES: '5245',
  PACKAGING: '5250',
  ADVERTISING_MARKETING: '5255',
  BANK_CHARGES: '5260',
  PROFESSIONAL_FEES: '5265',
  INSURANCE: '5270',
  MISCELLANEOUS: '5290',
};

/**
 * Every system account, in code order. `isSystem: true` on all of them.
 *
 * These are per-company rows, exactly like units and taxes: a company may rename
 * one or hang children under it, and that affects nobody else.
 */
export const SYSTEM_ACCOUNTS = [
  {
    code: SYSTEM_ACCOUNT.CASH,
    name: 'Cash',
    type: 'ASSET',
    description: 'Physical cash. Debited by cash receipts, credited by cash payments.',
  },
  {
    code: SYSTEM_ACCOUNT.BANK,
    name: 'Bank',
    type: 'ASSET',
    description: 'Bank account. Used by every non-cash payment method.',
  },
  {
    code: SYSTEM_ACCOUNT.ACCOUNTS_RECEIVABLE,
    name: 'Accounts Receivable',
    type: 'ASSET',
    description: 'Control account for what customers owe. Mirrors the customer sub-ledger.',
  },
  {
    code: SYSTEM_ACCOUNT.INVENTORY,
    name: 'Inventory',
    type: 'ASSET',
    description: 'Control account for stock on hand. Mirrors the inventory ledger.',
  },
  {
    code: SYSTEM_ACCOUNT.ADVANCE_TO_SUPPLIERS,
    name: 'Advance to Suppliers',
    type: 'ASSET',
    description: 'Money paid to a supplier that is not yet allocated to a bill.',
  },
  {
    code: SYSTEM_ACCOUNT.INPUT_TAX_CREDIT,
    name: 'Input Tax Credit',
    type: 'ASSET',
    description: 'Tax paid on purchases and recoverable. Not a GST return - see the limitations.',
  },
  {
    code: SYSTEM_ACCOUNT.INPUT_CGST,
    name: 'Input CGST',
    type: 'ASSET',
    parentCode: SYSTEM_ACCOUNT.INPUT_TAX_CREDIT,
    description: 'Central GST paid on intra-state purchases, recoverable.',
  },
  {
    code: SYSTEM_ACCOUNT.INPUT_SGST,
    name: 'Input SGST',
    type: 'ASSET',
    parentCode: SYSTEM_ACCOUNT.INPUT_TAX_CREDIT,
    description: 'State GST paid on intra-state purchases, recoverable.',
  },
  {
    code: SYSTEM_ACCOUNT.INPUT_IGST,
    name: 'Input IGST',
    type: 'ASSET',
    parentCode: SYSTEM_ACCOUNT.INPUT_TAX_CREDIT,
    description: 'Integrated GST paid on inter-state purchases, recoverable.',
  },
  {
    code: SYSTEM_ACCOUNT.INPUT_CESS,
    name: 'Input Cess',
    type: 'ASSET',
    parentCode: SYSTEM_ACCOUNT.INPUT_TAX_CREDIT,
    description: 'Compensation cess paid on purchases.',
  },
  {
    code: SYSTEM_ACCOUNT.ACCOUNTS_PAYABLE,
    name: 'Accounts Payable',
    type: 'LIABILITY',
    description: 'Control account for what we owe suppliers. Mirrors the supplier sub-ledger.',
  },
  {
    code: SYSTEM_ACCOUNT.TAX_PAYABLE,
    name: 'Tax Payable',
    type: 'LIABILITY',
    description: 'Tax charged on sales and owed to the authority.',
  },
  {
    code: SYSTEM_ACCOUNT.OUTPUT_CGST,
    name: 'Output CGST',
    type: 'LIABILITY',
    parentCode: SYSTEM_ACCOUNT.TAX_PAYABLE,
    description: 'Central GST charged on intra-state sales, owed to the authority.',
  },
  {
    code: SYSTEM_ACCOUNT.OUTPUT_SGST,
    name: 'Output SGST',
    type: 'LIABILITY',
    parentCode: SYSTEM_ACCOUNT.TAX_PAYABLE,
    description: 'State GST charged on intra-state sales, owed to the authority.',
  },
  {
    code: SYSTEM_ACCOUNT.OUTPUT_IGST,
    name: 'Output IGST',
    type: 'LIABILITY',
    parentCode: SYSTEM_ACCOUNT.TAX_PAYABLE,
    description: 'Integrated GST charged on inter-state sales, owed to the authority.',
  },
  {
    code: SYSTEM_ACCOUNT.OUTPUT_CESS,
    name: 'Output Cess',
    type: 'LIABILITY',
    parentCode: SYSTEM_ACCOUNT.TAX_PAYABLE,
    description: 'Compensation cess charged on sales.',
  },
  {
    code: SYSTEM_ACCOUNT.CUSTOMER_ADVANCES,
    name: 'Customer Advances',
    type: 'LIABILITY',
    description: 'Money received from a customer that is not yet allocated to an invoice.',
  },
  {
    code: SYSTEM_ACCOUNT.OWNERS_CAPITAL,
    name: "Owner's Capital",
    type: 'EQUITY',
    description: 'Owner funds. No document flow posts here yet; it exists for opening balances.',
  },
  {
    code: SYSTEM_ACCOUNT.SALES_REVENUE,
    name: 'Sales Revenue',
    type: 'REVENUE',
    description: 'Revenue from sales, net of discount and excluding tax.',
  },
  {
    code: SYSTEM_ACCOUNT.SALES_RETURNS,
    name: 'Sales Returns',
    type: 'REVENUE',
    description: 'Contra-revenue. Carries a DEBIT balance and is subtracted from revenue.',
  },
  {
    code: SYSTEM_ACCOUNT.COST_OF_GOODS_SOLD,
    name: 'Cost of Goods Sold',
    type: 'EXPENSE',
    description: 'What sold stock cost us, at the COGS frozen on the invoice line.',
  },
  {
    code: SYSTEM_ACCOUNT.INVENTORY_VALUATION_ADJUSTMENT,
    name: 'Inventory Valuation Adjustment',
    type: 'EXPENSE',
    description:
      'Purchase price variance: the gap between what stock was capitalised at and what was actually owed (purchase discounts, and the Phase 5 return-at-original-cost residue).',
  },
  {
    code: SYSTEM_ACCOUNT.OPERATING_EXPENSES,
    name: 'Operating Expenses',
    type: 'EXPENSE',
    description:
      'The parent of the day-to-day running costs below. A grouping account: expenses are filed under its children.',
  },
  {
    code: SYSTEM_ACCOUNT.RENT,
    name: 'Rent',
    type: 'EXPENSE',
    parentCode: SYSTEM_ACCOUNT.OPERATING_EXPENSES,
    description: 'Shop, office or godown rent.',
  },
  {
    code: SYSTEM_ACCOUNT.ELECTRICITY,
    name: 'Electricity',
    type: 'EXPENSE',
    parentCode: SYSTEM_ACCOUNT.OPERATING_EXPENSES,
    description: 'Electricity bills.',
  },
  {
    code: SYSTEM_ACCOUNT.WATER,
    name: 'Water',
    type: 'EXPENSE',
    parentCode: SYSTEM_ACCOUNT.OPERATING_EXPENSES,
    description: 'Water bills.',
  },
  {
    code: SYSTEM_ACCOUNT.INTERNET_TELEPHONE,
    name: 'Internet & Telephone',
    type: 'EXPENSE',
    parentCode: SYSTEM_ACCOUNT.OPERATING_EXPENSES,
    description: 'Broadband, mobile and landline.',
  },
  {
    code: SYSTEM_ACCOUNT.SALARIES_WAGES,
    name: 'Salaries & Wages',
    type: 'EXPENSE',
    parentCode: SYSTEM_ACCOUNT.OPERATING_EXPENSES,
    description: 'Staff pay. Not a payroll system: one amount, one entry.',
  },
  {
    code: SYSTEM_ACCOUNT.TRANSPORTATION,
    name: 'Transportation',
    type: 'EXPENSE',
    parentCode: SYSTEM_ACCOUNT.OPERATING_EXPENSES,
    description: 'Freight, delivery, fuel and travel.',
  },
  {
    code: SYSTEM_ACCOUNT.REPAIRS_MAINTENANCE,
    name: 'Repairs & Maintenance',
    type: 'EXPENSE',
    parentCode: SYSTEM_ACCOUNT.OPERATING_EXPENSES,
    description: 'Upkeep of premises and equipment.',
  },
  {
    code: SYSTEM_ACCOUNT.OFFICE_EXPENSES,
    name: 'Office Expenses',
    type: 'EXPENSE',
    parentCode: SYSTEM_ACCOUNT.OPERATING_EXPENSES,
    description: 'Stationery, printing and sundry office costs.',
  },
  {
    code: SYSTEM_ACCOUNT.PACKAGING,
    name: 'Packaging',
    type: 'EXPENSE',
    parentCode: SYSTEM_ACCOUNT.OPERATING_EXPENSES,
    description: 'Bags, cartons and packing material.',
  },
  {
    code: SYSTEM_ACCOUNT.ADVERTISING_MARKETING,
    name: 'Advertising & Marketing',
    type: 'EXPENSE',
    parentCode: SYSTEM_ACCOUNT.OPERATING_EXPENSES,
    description: 'Promotion of the business.',
  },
  {
    code: SYSTEM_ACCOUNT.BANK_CHARGES,
    name: 'Bank Charges',
    type: 'EXPENSE',
    parentCode: SYSTEM_ACCOUNT.OPERATING_EXPENSES,
    description: 'Bank fees and transaction charges.',
  },
  {
    code: SYSTEM_ACCOUNT.PROFESSIONAL_FEES,
    name: 'Professional Fees',
    type: 'EXPENSE',
    parentCode: SYSTEM_ACCOUNT.OPERATING_EXPENSES,
    description: 'Accountant, lawyer and consultant fees.',
  },
  {
    code: SYSTEM_ACCOUNT.INSURANCE,
    name: 'Insurance',
    type: 'EXPENSE',
    parentCode: SYSTEM_ACCOUNT.OPERATING_EXPENSES,
    description: 'Premiums on business insurance.',
  },
  {
    code: SYSTEM_ACCOUNT.MISCELLANEOUS,
    name: 'Miscellaneous Expenses',
    type: 'EXPENSE',
    parentCode: SYSTEM_ACCOUNT.OPERATING_EXPENSES,
    description: 'Anything that does not belong above.',
  },
];

/**
 * Accounts that are EXPENSE-typed but must never be chosen as an expense
 * category: both are maintained by other document flows, and posting rent to
 * Cost of Goods Sold would silently corrupt gross profit.
 */
export const NON_CATEGORY_EXPENSE_CODES = [
  SYSTEM_ACCOUNT.COST_OF_GOODS_SOLD,
  SYSTEM_ACCOUNT.INVENTORY_VALUATION_ADJUSTMENT,
  // A grouping account. Its children are the categories.
  SYSTEM_ACCOUNT.OPERATING_EXPENSES,
];

/** The codes the posting engine needs, so a missing one is caught early. */
export const SYSTEM_ACCOUNT_CODES = SYSTEM_ACCOUNTS.map((account) => account.code);

/**
 * Rows ready to insert for one company.
 *
 * parentId is NOT set here: the parent has to exist first, and both are inserted
 * in the same statement. The link is made afterwards by
 * `SYSTEM_ACCOUNT_PARENTS`, which is idempotent.
 */
export function systemAccountRows(companyId) {
  return SYSTEM_ACCOUNTS.map((account) => ({
    companyId,
    code: account.code,
    name: account.name,
    type: account.type,
    description: account.description,
    isSystem: true,
    isActive: true,
  }));
}

/** [childCode, parentCode] for every system account that hangs under another. */
export const SYSTEM_ACCOUNT_PARENTS = SYSTEM_ACCOUNTS.filter((account) => account.parentCode).map(
  (account) => [account.code, account.parentCode],
);
