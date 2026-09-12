import React, { useState } from 'react';
import { useEcommerce } from '../../context/EcommerceContext';
import { 
  X, 
  Trash2, 
  Plus, 
  Minus, 
  ShoppingBag, 
  ArrowRight, 
  Tag, 
  Check, 
  Truck, 
  ShieldCheck 
} from 'lucide-react';

interface CartDrawerProps {
  onOpenCheckout: () => void;
}

export const CartDrawer: React.FC<CartDrawerProps> = ({ onOpenCheckout }) => {
  const { 
    isCartOpen, 
    setIsCartOpen, 
    cart, 
    removeFromCart, 
    updateCartQuantity, 
    clearCart,
    cartSubtotal,
    cartDiscount,
    cartShipping,
    cartTotal,
    settings,
    appliedCoupon,
    applyCouponCode,
    removeCoupon
  } = useEcommerce();

  const [couponInput, setCouponInput] = useState('');
  const [couponError, setCouponError] = useState<string | null>(null);

  if (!isCartOpen) return null;

  const handleApplyCoupon = (e: React.FormEvent) => {
    e.preventDefault();
    if (!couponInput.trim()) return;
    const result = applyCouponCode(couponInput);
    if (!result.success) {
      setCouponError(result.message);
    } else {
      setCouponError(null);
      setCouponInput('');
    }
  };

  const amountToFreeShipping = Math.max(0, settings.freeShippingThreshold - cartSubtotal);
  const freeShippingProgress = Math.min(100, Math.round((cartSubtotal / settings.freeShippingThreshold) * 100));

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div 
        onClick={() => setIsCartOpen(false)} 
        className="absolute inset-0 bg-stone-950/60 backdrop-blur-xs transition-opacity duration-300"
      />

      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-white shadow-2xl flex flex-col font-sans animate-in slide-in-from-right duration-300">
          
          {/* Top Bar */}
          <div className="p-4 border-b border-stone-200 flex items-center justify-between bg-stone-50">
            <div className="flex items-center space-x-2">
              <ShoppingBag className="w-5 h-5 text-amber-600" />
              <h2 className="font-serif font-bold text-stone-900 text-base">Votre Panier</h2>
              <span className="text-xs bg-stone-200 text-stone-700 px-2 py-0.5 rounded-full font-mono font-semibold">
                {cart.reduce((s, i) => s + i.quantity, 0)}
              </span>
            </div>

            <button
              onClick={() => setIsCartOpen(false)}
              className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Free Shipping Progress Indicator */}
          <div className="px-5 py-3 bg-amber-50/60 border-b border-amber-200/50 text-xs">
            <div className="flex items-center justify-between text-stone-700 mb-1.5 font-medium">
              <span className="flex items-center space-x-1">
                <Truck className="w-3.5 h-3.5 text-amber-600" />
                <span>
                  {amountToFreeShipping === 0 ? (
                    <strong className="text-emerald-700 font-bold">Livraison offerte validée ! 🎉</strong>
                  ) : (
                    <>Plus que <strong className="text-stone-900 font-bold">{amountToFreeShipping.toFixed(2)} €</strong> pour la livraison offerte</>
                  )}
                </span>
              </span>
              <span className="font-mono text-stone-500 font-bold">{freeShippingProgress}%</span>
            </div>
            <div className="w-full bg-stone-200 h-1.5 rounded-full overflow-hidden">
              <div 
                style={{ width: `${freeShippingProgress}%` }}
                className="bg-amber-500 h-full rounded-full transition-all duration-300"
              />
            </div>
          </div>

          {/* Cart Items List */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {cart.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-stone-400 space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-stone-100 flex items-center justify-center text-stone-300">
                  <ShoppingBag className="w-7 h-7" />
                </div>
                <h3 className="font-serif font-bold text-stone-700 text-base">Votre panier est vide</h3>
                <p className="text-xs max-w-xs text-stone-400">
                  Découvrez les créations artisanales et ajoutez vos coups de cœur pour commencer vos achats.
                </p>
                <button
                  onClick={() => setIsCartOpen(false)}
                  className="mt-2 px-4 py-2 bg-stone-900 text-white rounded-xl text-xs font-semibold hover:bg-stone-800 transition-colors"
                >
                  Continuer mes achats
                </button>
              </div>
            ) : (
              cart.map((item, idx) => (
                <div key={idx} className="flex space-x-3 p-3 bg-stone-50/80 rounded-2xl border border-stone-200/80">
                  <img
                    src={item.product.images[0]}
                    alt={item.product.name}
                    className="w-16 h-16 rounded-xl object-cover border border-stone-200 shrink-0"
                  />

                  <div className="flex-1 min-w-0 flex flex-col justify-between">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="text-xs font-semibold text-stone-900 truncate">
                          {item.product.name}
                        </h4>
                        <button
                          onClick={() => removeFromCart(idx)}
                          className="text-stone-400 hover:text-rose-600 p-0.5"
                          title="Supprimer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {item.selectedVariant && (
                        <p className="text-[11px] text-stone-500 mt-0.5">
                          {Object.entries(item.selectedVariant).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-2">
                      {/* Qty controls */}
                      <div className="flex items-center space-x-1.5 bg-white border border-stone-300 rounded-lg px-1.5 py-0.5 text-xs">
                        <button
                          onClick={() => updateCartQuantity(idx, item.quantity - 1)}
                          className="text-stone-500 hover:text-stone-900 font-bold px-1"
                        >
                          -
                        </button>
                        <span className="font-mono font-bold text-stone-900 px-1 text-xs">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => updateCartQuantity(idx, item.quantity + 1)}
                          disabled={item.quantity >= item.product.stock}
                          className="text-stone-500 hover:text-stone-900 font-bold px-1 disabled:opacity-30"
                        >
                          +
                        </button>
                      </div>

                      <span className="font-mono font-bold text-stone-900 text-xs">
                        {(item.product.price * item.quantity).toFixed(2)} €
                      </span>
                    </div>

                  </div>
                </div>
              ))
            )}
          </div>

          {/* Bottom Checkout & Summary */}
          {cart.length > 0 && (
            <div className="p-5 border-t border-stone-200 bg-white space-y-4 text-xs">
              
              {/* Coupon Code Input */}
              <div>
                {appliedCoupon ? (
                  <div className="p-2.5 bg-emerald-50 rounded-xl border border-emerald-200 flex items-center justify-between text-emerald-800 text-xs">
                    <div className="flex items-center space-x-2">
                      <Tag className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="font-mono font-bold">{appliedCoupon.code}</span>
                      <span>(-{appliedCoupon.discountType === 'percent' ? `${appliedCoupon.value}%` : `${appliedCoupon.value}€`})</span>
                    </div>
                    <button
                      onClick={removeCoupon}
                      className="text-emerald-700 hover:text-emerald-950 underline font-medium"
                    >
                      Retirer
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleApplyCoupon} className="space-y-1">
                    <div className="flex space-x-2">
                      <input
                        type="text"
                        placeholder="Code promo (ex: BIENVENUE10)"
                        value={couponInput}
                        onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                        className="flex-1 px-3 py-1.5 border border-stone-300 rounded-xl text-xs font-mono uppercase focus:ring-2 focus:ring-amber-500/30"
                      />
                      <button
                        type="submit"
                        className="px-3.5 py-1.5 bg-stone-900 hover:bg-stone-800 text-white rounded-xl font-semibold transition-colors shrink-0"
                      >
                        Appliquer
                      </button>
                    </div>
                    {couponError && (
                      <p className="text-[11px] text-rose-600 pl-1">{couponError}</p>
                    )}
                  </form>
                )}
              </div>

              {/* Price Details */}
              <div className="space-y-1.5 text-stone-600 border-t border-stone-100 pt-3">
                <div className="flex justify-between">
                  <span>Sous-total articles :</span>
                  <span className="font-mono text-stone-900 font-semibold">{cartSubtotal.toFixed(2)} €</span>
                </div>

                {cartDiscount > 0 && (
                  <div className="flex justify-between text-emerald-600 font-semibold">
                    <span>Remise déduite :</span>
                    <span className="font-mono">-{cartDiscount.toFixed(2)} €</span>
                  </div>
                )}

                <div className="flex justify-between">
                  <span>Frais de livraison :</span>
                  <span className="font-mono text-stone-900 font-semibold">
                    {cartShipping === 0 ? (
                      <span className="text-emerald-600 font-bold">OFFERT</span>
                    ) : (
                      `${cartShipping.toFixed(2)} €`
                    )}
                  </span>
                </div>

                <div className="flex justify-between text-stone-950 font-bold text-sm border-t border-stone-200 pt-2">
                  <span>Total TTC :</span>
                  <span className="font-mono text-lg text-amber-600 font-bold">{cartTotal.toFixed(2)} €</span>
                </div>
              </div>

              {/* Checkout CTA */}
              <button
                onClick={() => {
                  setIsCartOpen(false);
                  onOpenCheckout();
                }}
                className="w-full py-3.5 bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold text-xs rounded-xl flex items-center justify-center space-x-2 transition-all shadow-md active:scale-98"
              >
                <span>Valider ma commande</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <div className="flex items-center justify-center space-x-3 text-[10px] text-stone-400 pt-1">
                <span className="flex items-center space-x-1">
                  <ShieldCheck className="w-3 h-3" />
                  <span>Paiement 100% sécurisé</span>
                </span>
                <span>·</span>
                <span>Expédition suivie</span>
              </div>

            </div>
          )}

        </div>
      </div>
    </div>
  );
};
