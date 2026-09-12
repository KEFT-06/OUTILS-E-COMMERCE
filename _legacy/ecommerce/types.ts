export type EcommerceTab = 
  | 'dashboard' 
  | 'products' 
  | 'orders' 
  | 'margins' 
  | 'coupons' 
  | 'customers' 
  | 'storefront';

export type OrderStatus = 'pending' | 'paid' | 'processing' | 'shipped' | 'delivered' | 'cancelled';

export interface ProductVariant {
  name: string;
  options: string[];
}

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  compareAtPrice?: number;
  costPrice: number;
  sku: string;
  category: string;
  images: string[];
  stock: number;
  lowStockThreshold: number;
  status: 'active' | 'draft' | 'archived';
  tags: string[];
  rating: number;
  reviewsCount: number;
  featured?: boolean;
  variants?: ProductVariant[];
}

export interface CartItem {
  product: Product;
  quantity: number;
  selectedVariant?: Record<string, string>;
}

export interface CustomerInfo {
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  zipCode: string;
  country: string;
}

export interface OrderItem {
  productId: string;
  productName: string;
  price: number;
  costPrice: number;
  quantity: number;
  variant?: string;
  image: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  createdAt: string;
  customer: CustomerInfo;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  couponCode?: string;
  shippingFee: number;
  tax: number;
  total: number;
  status: OrderStatus;
  paymentMethod: 'credit_card' | 'apple_pay' | 'paypal' | 'bank_transfer';
  shippingMethod: string;
  trackingNumber?: string;
  notes?: string;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  city: string;
  ordersCount: number;
  totalSpent: number;
  lastOrderDate: string;
  status: 'vip' | 'regular' | 'lead';
}

export interface Coupon {
  id: string;
  code: string;
  discountType: 'percent' | 'fixed';
  value: number;
  minOrderAmount: number;
  usageLimit: number;
  usedCount: number;
  isActive: boolean;
  expiresAt: string;
}

export interface StoreSettings {
  storeName: string;
  currency: string;
  currencySymbol: string;
  freeShippingThreshold: number;
  standardShippingFee: number;
  expressShippingFee: number;
  taxRate: number; // e.g. 0.20 for 20%
  emailNotification: boolean;
}
