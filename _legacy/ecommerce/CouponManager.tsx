import React, { useState } from 'react';
import { useEcommerce } from '../../context/EcommerceContext';
import { Percent, Plus, Trash2, Copy, Check, Tag, Calendar, AlertCircle } from 'lucide-react';
import { Coupon } from '../../types/ecommerce';

export const CouponManager: React.FC = () => {
  const { coupons, addCoupon, deleteCoupon, toggleCouponStatus, showNotification } = useEcommerce();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    code: '',
    discountType: 'percent' as 'percent' | 'fixed',
    value: 15,
    minOrderAmount: 50,
    usageLimit: 100,
    expiresAt: '2026-12-31',
  });

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    showNotification(`Code ${code} copié dans le presse-papier !`);
    setTimeout(() => setCopiedCode(null), 2500);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.code.trim()) return;

    addCoupon({
      code: formData.code.trim().toUpperCase(),
      discountType: formData.discountType,
      value: Number(formData.value),
      minOrderAmount: Number(formData.minOrderAmount),
      usageLimit: Number(formData.usageLimit),
      isActive: true,
      expiresAt: formData.expiresAt,
    });

    setIsCreateOpen(false);
    setFormData({
      code: '',
      discountType: 'percent',
      value: 15,
      minOrderAmount: 50,
      usageLimit: 100,
      expiresAt: '2026-12-31',
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-2xl border border-stone-200 shadow-xs">
        <div>
          <div className="flex items-center space-x-2">
            <Percent className="w-5 h-5 text-amber-500" />
            <h1 className="text-xl font-serif font-bold text-stone-900">Codes Promo & Réductions</h1>
          </div>
          <p className="text-xs text-stone-500 mt-0.5">
            Créez des remises en pourcentage ou montant fixe, utilisables en direct sur le panier de la boutique.
          </p>
        </div>

        <button
          onClick={() => setIsCreateOpen(true)}
          className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-semibold transition-colors flex items-center space-x-1.5 shadow-xs"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Créer un Code Promo</span>
        </button>
      </div>

      {/* Coupons List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {coupons.map(coupon => {
          const isExpired = new Date(coupon.expiresAt) < new Date();

          return (
            <div 
              key={coupon.id} 
              className={`p-5 rounded-2xl border transition-all ${
                coupon.isActive && !isExpired 
                  ? 'bg-white border-stone-200 shadow-xs' 
                  : 'bg-stone-50/80 border-stone-200 opacity-70'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="font-mono font-bold text-base text-stone-900 tracking-wider bg-stone-100 px-2.5 py-1 rounded-lg border border-stone-200">
                    {coupon.code}
                  </span>
                  <button
                    onClick={() => handleCopy(coupon.code)}
                    className="p-1.5 text-stone-400 hover:text-stone-700 rounded transition-colors"
                    title="Copier le code"
                  >
                    {copiedCode === coupon.code ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>

                <button
                  onClick={() => toggleCouponStatus(coupon.id)}
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    coupon.isActive && !isExpired
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-stone-200 text-stone-600 border-stone-300'
                  }`}
                >
                  {coupon.isActive && !isExpired ? 'ACTIF' : 'DÉSACTIVÉ'}
                </button>
              </div>

              {/* Discount Value */}
              <div className="mt-4">
                <div className="text-2xl font-bold font-serif text-amber-600">
                  {coupon.discountType === 'percent' ? `-${coupon.value}%` : `-${coupon.value.toFixed(2)} €`}
                </div>
                <div className="text-xs text-stone-500 mt-0.5">
                  Dès {coupon.minOrderAmount} € d'achat minimum
                </div>
              </div>

              {/* Usage bar */}
              <div className="mt-4 pt-3 border-t border-stone-100 space-y-1.5 text-xs text-stone-500">
                <div className="flex justify-between text-[11px]">
                  <span>Utilisations :</span>
                  <span className="font-mono font-medium text-stone-800">
                    {coupon.usedCount} / {coupon.usageLimit}
                  </span>
                </div>
                <div className="w-full bg-stone-100 h-1.5 rounded-full overflow-hidden">
                  <div 
                    style={{ width: `${Math.min(100, (coupon.usedCount / coupon.usageLimit) * 100)}%` }} 
                    className="bg-amber-500 h-full rounded-full"
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] pt-1 text-stone-400">
                  <span className="flex items-center space-x-1">
                    <Calendar className="w-3 h-3" />
                    <span>Expire le {coupon.expiresAt}</span>
                  </span>
                  <button
                    onClick={() => deleteCoupon(coupon.id)}
                    className="text-stone-400 hover:text-rose-600 transition-colors"
                    title="Supprimer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Create Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 bg-stone-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-xl border border-stone-200 overflow-hidden p-6 space-y-4 animate-in zoom-in-95">
            <h3 className="font-semibold text-stone-900 text-sm">Nouveau Code Promo</h3>
            
            <form onSubmit={handleSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-stone-800 mb-1">Code Promo (ex: VIP20, ETE15) *</label>
                <input
                  type="text"
                  required
                  value={formData.code}
                  onChange={e => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                  placeholder="CODE"
                  className="w-full px-3 py-2 border border-stone-300 rounded-xl font-mono uppercase font-bold text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-stone-800 mb-1">Type de remise</label>
                  <select
                    value={formData.discountType}
                    onChange={e => setFormData({ ...formData, discountType: e.target.value as any })}
                    className="w-full px-3 py-2 border border-stone-300 rounded-xl text-xs"
                  >
                    <option value="percent">Pourcentage (%)</option>
                    <option value="fixed">Montant fixe (€)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-stone-800 mb-1">Valeur de la remise *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={formData.value}
                    onChange={e => setFormData({ ...formData, value: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-stone-300 rounded-xl font-mono text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-stone-800 mb-1">Panier minimum (€)</label>
                  <input
                    type="number"
                    min="0"
                    value={formData.minOrderAmount}
                    onChange={e => setFormData({ ...formData, minOrderAmount: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-stone-300 rounded-xl font-mono text-xs"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-stone-800 mb-1">Limite d'utilisations</label>
                  <input
                    type="number"
                    min="1"
                    value={formData.usageLimit}
                    onChange={e => setFormData({ ...formData, usageLimit: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-stone-300 rounded-xl font-mono text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-stone-800 mb-1">Date d'expiration</label>
                <input
                  type="date"
                  value={formData.expiresAt}
                  onChange={e => setFormData({ ...formData, expiresAt: e.target.value })}
                  className="w-full px-3 py-2 border border-stone-300 rounded-xl text-xs"
                />
              </div>

              <div className="pt-3 border-t border-stone-100 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-3 py-1.5 text-stone-600 hover:bg-stone-100 rounded-lg"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-semibold"
                >
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
