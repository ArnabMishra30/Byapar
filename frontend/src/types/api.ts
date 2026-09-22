// ADMIN and STAFF belong to a SHOP. PLATFORM_ADMIN and SALES_STAFF belong to the
// SaaS operator and have no company of their own - which is exactly what keeps
// them out of every shop's books.
export type ShopUserRole = "ADMIN" | "STAFF";
export type PlatformRole = "PLATFORM_ADMIN" | "SALES_STAFF";
export type UserRole = ShopUserRole | PlatformRole;

export type GstRegistrationType =
  | "UNREGISTERED"
  | "REGULAR"
  | "COMPOSITION"
  | "SEZ"
  | "OTHER";

export type DocumentStatus = "DRAFT" | "POSTED" | "CANCELLED" | "REVERSED";

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  companyId: string;
  isActive?: boolean;
  lastLoginAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface Company {
  id: string;
  name: string;
  gstin?: string | null;
  legalName?: string | null;
  stateCode?: string | null;
  registeredAddress?: string | null;
  gstRegistrationType: GstRegistrationType;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  settings?: CompanySettings;
}

export interface CompanySettings {
  id: string;
  companyId: string;
  currency: string;
  timezone: string;
  dateFormat: string;
  invoicePrefix: string;
  purchasePrefix: string;
  financialYearStartMonth: number;
  requireOpenPeriod: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface ApiSuccessResponse<T> {
  success: true;
  message?: string;
  data: T;
}

export interface ApiErrorResponse {
  success: false;
  message: string;
  code?: string;
  details?: Record<string, any>;
}

export interface DashboardSummary {
  period?: {
    from: string;
    to: string;
  };
  metrics?: {
    todaySales?: string | number;
    todayPurchases?: string | number;
    monthSales?: string | number;
    monthPurchases?: string | number;
    customerOutstanding?: string | number;
    supplierOutstanding?: string | number;
    cashBalance?: string | number;
    bankBalance?: string | number;
    netCashFlow?: string | number;
  };
  adminStats?: {
    totalCompanies: number;
    activeCompanies: number;
    totalUsers: number;
    activeUsers: number;
    gstRegisteredCount: number;
    nonGstCount: number;
  };
  recentActivities?: AuditLogEntry[];
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  userEmail: string;
  userRole: UserRole;
  action: string;
  resource: string;
  resourceId?: string | null;
  companyId: string;
  companyName?: string;
  status: "SUCCESS" | "FAILURE" | "WARNING" | "INFO";
  metadata?: Record<string, any> | null;
}

export interface PermissionDefinition {
  id: string;
  module: string;
  name: string;
  description: string;
  adminAllowed: boolean;
  staffAllowed: boolean;
}
