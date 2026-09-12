import React, { createContext, useContext, useState, useEffect } from 'react';
import { 
  Product, 
  Order, 
  Customer, 
  Coupon, 
  StoreSettings, 
  CartItem, 
  EcommerceTab, 
  OrderStatus, 
  CustomerInfo 
} from '../types/ecommerce';
import { 
  INITIAL_SETTINGS, 
  INITIAL_PRODUCTS, 
  INITIAL_ORDERS, 
  INITIAL_CUSTOMERS, 
  INITIAL_COUPONS 
} from '../data/initialEcommerceData';

interface EcommerceContextType {
  products: Product[];
  orders: Order[];
  customers: Customer[];
  coupons: Coupon[];
  settings: StoreSettings;
  cart: CartItem[];
  appliedCoupon: Coupon | null;
  isCartOpen: boolean;
  setIsCartOpen: (open: boolean) => void;
  currentTab: EcommerceTab;
  setCurrentTab: (tab: EcommerceTab) => void;
  
  // Product management
  addProduct: (product: Omit<Product, 'id'>) => void;
  updateProduct: (id: string, updates: Partial<Product>) => void;
  deleteProduct: (id: string) => void;
  updateStock: (id: string, delta: number) => void;

  // Cart operations
  addToCart: (product: Product, quantity?: number, selectedVariant?: Record<string, string>) => void;
  removeFromCart: (index: number) => void;
  updateCartQuantity: (index: number, quantity: number) => void;
  clearCart: () => void;
  applyCouponCode: (code: string) => { success: boolean; message: string };
  removeCoupon: () => void;

  // Order operations
  createOrder: (
    customerInfo: CustomerInfo, 
    shippingMethodName: string, 
    shippingFee: number,
    paymentMethod: Order['paymentMethod']
  ) => Order;
  updateOrderStatus: (orderId: string, status: OrderStatus, trackingNumber?: string) => void;
  deleteOrder: (orderId: string) => void;

  // Coupon operations
  addCoupon: (coupon: Omit<Coupon, 'id' | 'usedCount'>) => void;
  deleteCoupon: (id: string) => void;
  toggleCouponStatus: (id: string) => void;

  // Computed properties
  cartCount: number;
  cartSubtotal: number;
  cartDiscount: number;
  cartShipping: number;
  cartTotal: number;
  freeShippingProgress: number;

  // Analytics
  totalRevenue: number;
  totalOrdersCount: number;
  averageOrderValue: number;
  lowStockProducts: Product[];

  // Utilities
  resetToDemoData: () => void;
  notification: { message: string; type: 'success' | 'info' | 'warning' } | null;
  showNotification: (message: string, type?: 'success' | 'info' | 'warning') => void;
}

const EcommerceContext = createContext<EcommerceContextType | undefined>(undefined);

export const EcommerceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Load initial states from localStorage if available
  const [products, setProducts] = useState<Product[]>(() => {
    const saved = localStorage.getItem('ecom_products');
    return saved ? JSON.parse(saved) : INITIAL_PRODUCTS;
  });

  const [orders, setOrders] = useState<Order[]>(() => {
    const saved = localStorage.getItem('ecom_orders');
    return saved ? JSON.parse(saved) : INITIAL_ORDERS;
  });

  const [customers, setCustomers] = useState<Customer[]>(() => {
    const saved = localStorage.getItem('ecom_customers');
    return saved ? JSON.parse(saved) : INITIAL_CUSTOMERS;
  });

  const [coupons, setCoupons] = useState<Coupon[]>(() => {
    const saved = localStorage.getItem('ecom_coupons');
    return saved ? JSON.parse(saved) : INITIAL_COUPONS;
  });

  const [settings] = useState<StoreSettings>(() => {
    const saved = localStorage.getItem('ecom_settings');
    return saved ? JSON.parse(saved) : INITIAL_SETTINGS;
  });

  const [cart, setCart] = useState<CartItem[]>(() => {
    const saved = localStorage.getItem('ecom_cart');
    return saved ? JSON.parse(saved) : [];
  });

  const [appliedCoupon, setAppliedCoupon] = useState<Coupon | null>(null);
  const [isCartOpen, setIsCartOpen] = useState<boolean>(false);
  const [currentTab, setCurrentTab] = useState<EcommerceTab>('dashboard');
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'info' | 'warning' } | null>(null);

  const showNotification = (message: string, type: 'success' | 'info' | 'warning' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification(null);
    }, 3800);
  };

  // Sync to local storage
  useEffect(() => {
    localStorage.setItem('ecom_products', JSON.stringify(products));
  }, [products]);

  useEffect(() => {
    localStorage.setItem('ecom_orders', JSON.stringify(orders));
  }, [orders]);

  useEffect(() => {
    localStorage.setItem('ecom_customers', JSON.stringify(customers));
  }, [customers]);

  useEffect(() => {
    localStorage.setItem('ecom_coupons', JSON.stringify(coupons));
  }, [coupons]);

  useEffect(() => {
    localStorage.setItem('ecom_cart', JSON.stringify(cart));
  }, [cart]);

  // Product Management
  const addProduct = (newProd: Omit<Product, 'id'>) => {
    const id = `prod-${Date.now()}`;
    const product: Product = { ...newProd, id };
    setProducts(prev => [product, ...prev]);
    showNotification(`Produit "${product.name}" ajouté avec succès !`);
  };

  const updateProduct = (id: string, updates: Partial<Product>) => {
    setProducts(prev => prev.map(p => (p.id === id ? { ...p, ...updates } : p)));
    showNotification(`Produit mis à jour.`);
  };

  const deleteProduct = (id: string) => {
    setProducts(prev => prev.filter(p => p.id !== id));
    showNotification(`Produit supprimé.`);
  };

  const updateStock = (id: string, delta: number) => {
    setProducts(prev => prev.map(p => {
      if (p.id === id) {
        const newStock = Math.max(0, p.stock + delta);
        return { ...p, stock: newStock };
      }
      return p;
    }));
  };

  // Cart operations
  const addToCart = (product: Product, quantity = 1, selectedVariant?: Record<string, string>) => {
    if (product.stock < quantity) {
      showNotification(`Désolé, il ne reste que ${product.stock} exemplaires en stock.`, 'warning');
      return;
    }

    setCart(prev => {
      // check if identical item already in cart
      const existingIndex = prev.findIndex(item => {
        if (item.product.id !== product.id) return false;
        if (!selectedVariant && !item.selectedVariant) return true;
        return JSON.stringify(item.selectedVariant) === JSON.stringify(selectedVariant);
      });

      if (existingIndex > -1) {
        const newCart = [...prev];
        const newQty = newCart[existingIndex].quantity + quantity;
        newCart[existingIndex].quantity = Math.min(newQty, product.stock);
        return newCart;
      } else {
        return [...prev, { product, quantity, selectedVariant }];
      }
    });

    setIsCartOpen(true);
    showNotification(`Ajouté au panier : ${product.name}`);
  };

  const removeFromCart = (index: number) => {
    setCart(prev => prev.filter((_, i) => i !== index));
  };

  const updateCartQuantity = (index: number, quantity: number) => {
    if (quantity <= 0) {
      removeFromCart(index);
      return;
    }
    setCart(prev => {
      const newCart = [...prev];
      if (newCart[index]) {
        const maxStock = newCart[index].product.stock;
        newCart[index].quantity = Math.min(quantity, maxStock);
      }
      return newCart;
    });
  };

  const clearCart = () => {
    setCart([]);
    setAppliedCoupon(null);
  };

  // Coupon handling
  const applyCouponCode = (code: string): { success: boolean; message: string } => {
    const cleanCode = code.trim().toUpperCase();
    const found = coupons.find(c => c.code.toUpperCase() === cleanCode && c.isActive);

    if (!found) {
      return { success: false, message: 'Code promo invalide ou expiré.' };
    }

    if (cartSubtotal < found.minOrderAmount) {
      return { 
        success: false, 
        message: `Montant minimum de commande de ${found.minOrderAmount} € requis pour ce code.` 
      };
    }

    if (found.usedCount >= found.usageLimit) {
      return { success: false, message: 'Ce code promo a atteint sa limite d’utilisations.' };
    }

    setAppliedCoupon(found);
    return { success: true, message: `Code ${found.code} appliqué avec succès !` };
  };

  const removeCoupon = () => {
    setAppliedCoupon(null);
  };

  // Computed Cart Calculations
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartSubtotal = cart.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);

  let cartDiscount = 0;
  if (appliedCoupon && cartSubtotal >= appliedCoupon.minOrderAmount) {
    if (appliedCoupon.discountType === 'percent') {
      cartDiscount = (cartSubtotal * appliedCoupon.value) / 100;
    } else {
      cartDiscount = Math.min(appliedCoupon.value, cartSubtotal);
    }
  }

  const freeShippingProgress = Math.min(100, Math.round((cartSubtotal / settings.freeShippingThreshold) * 100));
  const cartShipping = cartSubtotal >= settings.freeShippingThreshold || cartSubtotal === 0
    ? 0 
    : settings.standardShippingFee;

  const cartTotal = Math.max(0, cartSubtotal - cartDiscount + cartShipping);

  // Order Placement
  const createOrder = (
    customerInfo: CustomerInfo, 
    shippingMethodName: string, 
    shippingFee: number,
    paymentMethod: Order['paymentMethod']
  ): Order => {
    const orderNum = `CMD-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const newOrderId = `ord-${Date.now()}`;

    const orderItems = cart.map(item => ({
      productId: item.product.id,
      productName: item.product.name,
      price: item.product.price,
      costPrice: item.product.costPrice,
      quantity: item.quantity,
      variant: item.selectedVariant ? Object.values(item.selectedVariant).join(', ') : undefined,
      image: item.product.images[0] || ''
    }));

    const finalSubtotal = cartSubtotal;
    const finalDiscount = cartDiscount;
    const finalTotal = Math.max(0, finalSubtotal - finalDiscount + shippingFee);
    const tax = Number((finalTotal * (settings.taxRate / (1 + settings.taxRate))).toFixed(2));

    const newOrder: Order = {
      id: newOrderId,
      orderNumber: orderNum,
      createdAt: new Date().toISOString(),
      customer: customerInfo,
      items: orderItems,
      subtotal: finalSubtotal,
      discount: finalDiscount,
      couponCode: appliedCoupon?.code,
      shippingFee,
      tax,
      total: Number(finalTotal.toFixed(2)),
      status: 'paid', // Instant card payment success simulation
      paymentMethod,
      shippingMethod: shippingMethodName,
      trackingNumber: `TRACK-${Math.random().toString(36).substring(2, 9).toUpperCase()}FR`
    };

    // 1. Add order to order list
    setOrders(prev => [newOrder, ...prev]);

    // 2. Decrement stock in catalog
    cart.forEach(cartItem => {
      updateStock(cartItem.product.id, -cartItem.quantity);
    });

    // 3. Update or create Customer CRM profile
    setCustomers(prev => {
      const existing = prev.find(c => c.email.toLowerCase() === customerInfo.email.toLowerCase());
      if (existing) {
        return prev.map(c => {
          if (c.email.toLowerCase() === customerInfo.email.toLowerCase()) {
            const count = c.ordersCount + 1;
            const spent = c.totalSpent + finalTotal;
            return {
              ...c,
              ordersCount: count,
              totalSpent: Number(spent.toFixed(2)),
              lastOrderDate: new Date().toISOString().split('T')[0],
              status: count >= 3 || spent >= 300 ? 'vip' : 'regular'
            };
          }
          return c;
        });
      } else {
        const newCustomer: Customer = {
          id: `cust-${Date.now()}`,
          name: customerInfo.name,
          email: customerInfo.email,
          phone: customerInfo.phone,
          city: customerInfo.city,
          ordersCount: 1,
          totalSpent: Number(finalTotal.toFixed(2)),
          lastOrderDate: new Date().toISOString().split('T')[0],
          status: 'regular'
        };
        return [newCustomer, ...prev];
      }
    });

    // 4. Update coupon usage
    if (appliedCoupon) {
      setCoupons(prev => prev.map(c => c.id === appliedCoupon.id ? { ...c, usedCount: c.usedCount + 1 } : c));
    }

    // 5. Clear cart
    clearCart();
    setIsCartOpen(false);

    showNotification(`Nouvelle commande #${orderNum} enregistrée !`);
    return newOrder;
  };

  const updateOrderStatus = (orderId: string, status: OrderStatus, trackingNumber?: string) => {
    setOrders(prev => prev.map(o => {
      if (o.id === orderId) {
        return {
          ...o,
          status,
          trackingNumber: trackingNumber || o.trackingNumber
        };
      }
      return o;
    }));
    showNotification(`Statut de la commande mis à jour : ${status}`);
  };

  const deleteOrder = (orderId: string) => {
    setOrders(prev => prev.filter(o => o.id !== orderId));
    showNotification(`Commande supprimée.`);
  };

  // Coupons
  const addCoupon = (newCoupon: Omit<Coupon, 'id' | 'usedCount'>) => {
    const coupon: Coupon = {
      ...newCoupon,
      id: `coup-${Date.now()}`,
      usedCount: 0
    };
    setCoupons(prev => [coupon, ...prev]);
    showNotification(`Code promo "${coupon.code}" créé !`);
  };

  const deleteCoupon = (id: string) => {
    setCoupons(prev => prev.filter(c => c.id !== id));
  };

  const toggleCouponStatus = (id: string) => {
    setCoupons(prev => prev.map(c => c.id === id ? { ...c, isActive: !c.isActive } : c));
  };

  // Analytics Metrics
  const activeOrders = orders.filter(o => o.status !== 'cancelled');
  const totalRevenue = activeOrders.reduce((sum, o) => sum + o.total, 0);
  const totalOrdersCount = activeOrders.length;
  const averageOrderValue = totalOrdersCount > 0 ? totalRevenue / totalOrdersCount : 0;
  const lowStockProducts = products.filter(p => p.stock <= p.lowStockThreshold);

  // Reset
  const resetToDemoData = () => {
    setProducts(INITIAL_PRODUCTS);
    setOrders(INITIAL_ORDERS);
    setCustomers(INITIAL_CUSTOMERS);
    setCoupons(INITIAL_COUPONS);
    setCart([]);
    setAppliedCoupon(null);
    localStorage.removeItem('ecom_products');
    localStorage.removeItem('ecom_orders');
    localStorage.removeItem('ecom_customers');
    localStorage.removeItem('ecom_coupons');
    localStorage.removeItem('ecom_cart');
    showNotification(`Données d’exemple réinitialisées avec succès !`);
  };

  return (
    <EcommerceContext.Provider
      value={{
        products,
        orders,
        customers,
        coupons,
        settings,
        cart,
        appliedCoupon,
        isCartOpen,
        setIsCartOpen,
        currentTab,
        setCurrentTab,
        addProduct,
        updateProduct,
        deleteProduct,
        updateStock,
        addToCart,
        removeFromCart,
        updateCartQuantity,
        clearCart,
        applyCouponCode,
        removeCoupon,
        createOrder,
        updateOrderStatus,
        deleteOrder,
        addCoupon,
        deleteCoupon,
        toggleCouponStatus,
        cartCount,
        cartSubtotal,
        cartDiscount,
        cartShipping,
        cartTotal,
        freeShippingProgress,
        totalRevenue,
        totalOrdersCount,
        averageOrderValue,
        lowStockProducts,
        resetToDemoData,
        notification,
        showNotification
      }}
    >
      {children}
    </EcommerceContext.Provider>
  );
};

export const useEcommerce = () => {
  const context = useContext(EcommerceContext);
  if (!context) {
    throw new Error('useEcommerce must be used within an EcommerceProvider');
  }
  return context;
};
