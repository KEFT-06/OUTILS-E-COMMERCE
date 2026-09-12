import React, { useState } from 'react';
import { useEcommerce } from '../../context/EcommerceContext';
import { CustomerInfo, Order } from '../../types/ecommerce';
import { 
  X, 
  CheckCircle, 
  CreditCard, 
  Truck, 
  ShieldCheck, 
  Lock, 
  ArrowRight, 
  ArrowLeft,
  Sparkles,
  FileText
} from 'lucide-react';

interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOrderCompleted: (order: Order) => void;
}

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  isOpen,
  onClose,
  onOrderCompleted
}) => {
  const { 
    cart, 
    cartSubtotal, 
    cartDiscount, 
    cartTotal, 
    settings, 
    createOrder,
    setCurrentTab
  } = useEcommerce();

  const [step, setStep] = useState<'info' | 'shipping' | 'payment' | 'success'>('info');

  // Customer Form
  const [customer, setCustomer] = useState<CustomerInfo>({
    name: 'Antoine Delorme',
    email: 'antoine.delorme@example.com',
    phone: '06 12 34 56 78',
    address: '22 rue des Lilas',
    city: 'Nantes',
    zipCode: '44000',
    country: 'France'
  });

  // Shipping Method
  const [selectedShipping, setSelectedShipping] = useState({
    id: 'colissimo',
    name: 'Colissimo Domicile (48h)',
    fee: cartSubtotal >= settings.freeShippingThreshold ? 0 : settings.standardShippingFee
  });

  // Payment Method
  const [paymentMethod, setPaymentMethod] = useState<Order['paymentMethod']>('credit_card');
  const [completedOrder, setCompletedOrder] = useState<Order | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  if (!isOpen) return null;

  const shippingOptions = [
    {
      id: 'colissimo',
      name: 'Colissimo Domicile (48h)',
      time: 'Livraison sous 48h ouvrées',
      fee: cartSubtotal >= settings.freeShippingThreshold ? 0 : settings.standardShippingFee
    },
    {
      id: 'dhl',
      name: 'DHL Express (24h)',
      time: 'Livraison garantie demain avant 13h',
      fee: settings.expressShippingFee
    },
    {
      id: 'mondial',
      name: 'Mondial Relay Point Relais (3-4j)',
      time: 'Livraison en point relais de votre choix',
      fee: 3.50
    }
  ];

  const currentFinalTotal = Math.max(0, cartSubtotal - cartDiscount + selectedShipping.fee);

  const handleProcessOrder = () => {
    setIsProcessing(true);
    setTimeout(() => {
      const newOrder = createOrder(
        customer, 
        selectedShipping.name, 
        selectedShipping.fee, 
        paymentMethod
      );
      setCompletedOrder(newOrder);
      setIsProcessing(false);
      setStep('success');
      onOrderCompleted(newOrder);
    }, 1000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-stone-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto font-sans">
      <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl border border-stone-200 overflow-hidden my-8 animate-in zoom-in-95 duration-200">
        
        {/* Top Header */}
        <div className="p-5 border-b border-stone-100 flex items-center justify-between bg-stone-50">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-stone-900 text-amber-300 flex items-center justify-center font-bold">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-serif font-bold text-stone-900 text-sm">Paiement Sécurisé SSL</h2>
              <p className="text-[11px] text-stone-500">Atelier Marchand · Boutique officielle</p>
            </div>
          </div>

          {step !== 'success' && (
            <button
              onClick={onClose}
              className="p-1.5 text-stone-400 hover:text-stone-700 rounded-full"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Step Indicator (if not success) */}
        {step !== 'success' && (
          <div className="px-6 pt-4 pb-2 border-b border-stone-100 flex items-center justify-between text-xs">
            <div className={`flex items-center space-x-1.5 ${step === 'info' ? 'text-amber-600 font-bold' : 'text-stone-400'}`}>
              <span className="w-5 h-5 rounded-full bg-stone-100 flex items-center justify-center text-[10px] font-mono">1</span>
              <span>Coordonnées</span>
            </div>
            <div className="w-8 h-px bg-stone-200" />
            <div className={`flex items-center space-x-1.5 ${step === 'shipping' ? 'text-amber-600 font-bold' : 'text-stone-400'}`}>
              <span className="w-5 h-5 rounded-full bg-stone-100 flex items-center justify-center text-[10px] font-mono">2</span>
              <span>Livraison</span>
            </div>
            <div className="w-8 h-px bg-stone-200" />
            <div className={`flex items-center space-x-1.5 ${step === 'payment' ? 'text-amber-600 font-bold' : 'text-stone-400'}`}>
              <span className="w-5 h-5 rounded-full bg-stone-100 flex items-center justify-center text-[10px] font-mono">3</span>
              <span>Règlement</span>
            </div>
          </div>
        )}

        {/* Step 1: Customer Contact & Delivery Address */}
        {step === 'info' && (
          <div className="p-6 space-y-4 text-xs">
            <h3 className="font-semibold text-stone-900 text-sm">Vos Informations de Livraison</h3>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-stone-800 mb-1">Nom & Prénom *</label>
                <input
                  type="text"
                  required
                  value={customer.name}
                  onChange={e => setCustomer({ ...customer, name: e.target.value })}
                  className="w-full px-3 py-2 border border-stone-300 rounded-xl text-xs focus:ring-2 focus:ring-amber-500/30"
                />
              </div>

              <div>
                <label className="block font-semibold text-stone-800 mb-1">Adresse Email *</label>
                <input
                  type="email"
                  required
                  value={customer.email}
                  onChange={e => setCustomer({ ...customer, email: e.target.value })}
                  className="w-full px-3 py-2 border border-stone-300 rounded-xl text-xs focus:ring-2 focus:ring-amber-500/30"
                />
              </div>

              <div>
                <label className="block font-semibold text-stone-800 mb-1">Numéro de Téléphone *</label>
                <input
                  type="tel"
                  required
                  value={customer.phone}
                  onChange={e => setCustomer({ ...customer, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-stone-300 rounded-xl text-xs"
                />
              </div>

              <div>
                <label className="block font-semibold text-stone-800 mb-1">Pays *</label>
                <select
                  value={customer.country}
                  onChange={e => setCustomer({ ...customer, country: e.target.value })}
                  className="w-full px-3 py-2 border border-stone-300 rounded-xl text-xs"
                >
                  <option value="France">France métropolitaine</option>
                  <option value="Belgique">Belgique</option>
                  <option value="Suisse">Suisse</option>
                  <option value="Canada">Canada</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block font-semibold text-stone-800 mb-1">Adresse de Livraison (Rue, n°, bâtiment) *</label>
              <input
                type="text"
                required
                value={customer.address}
                onChange={e => setCustomer({ ...customer, address: e.target.value })}
                className="w-full px-3 py-2 border border-stone-300 rounded-xl text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-stone-800 mb-1">Code Postal *</label>
                <input
                  type="text"
                  required
                  value={customer.zipCode}
                  onChange={e => setCustomer({ ...customer, zipCode: e.target.value })}
                  className="w-full px-3 py-2 border border-stone-300 rounded-xl text-xs"
                />
              </div>

              <div>
                <label className="block font-semibold text-stone-800 mb-1">Ville *</label>
                <input
                  type="text"
                  required
                  value={customer.city}
                  onChange={e => setCustomer({ ...customer, city: e.target.value })}
                  className="w-full px-3 py-2 border border-stone-300 rounded-xl text-xs"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-stone-100 flex justify-end">
              <button
                type="button"
                onClick={() => setStep('shipping')}
                className="px-6 py-2.5 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-colors shadow-xs"
              >
                <span>Continuer vers la livraison</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Shipping Method */}
        {step === 'shipping' && (
          <div className="p-6 space-y-4 text-xs">
            <h3 className="font-semibold text-stone-900 text-sm">Mode d'Expédition</h3>

            <div className="space-y-3">
              {shippingOptions.map(opt => (
                <label
                  key={opt.id}
                  onClick={() => setSelectedShipping({ id: opt.id, name: opt.name, fee: opt.fee })}
                  className={`p-4 rounded-2xl border flex items-center justify-between cursor-pointer transition-all ${
                    selectedShipping.id === opt.id
                      ? 'bg-amber-50/50 border-amber-500 shadow-2xs'
                      : 'bg-white border-stone-200 hover:bg-stone-50'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <input
                      type="radio"
                      name="shipping"
                      checked={selectedShipping.id === opt.id}
                      onChange={() => {}}
                      className="text-amber-600 focus:ring-amber-500"
                    />
                    <div>
                      <div className="font-semibold text-stone-900 text-xs">{opt.name}</div>
                      <div className="text-[11px] text-stone-500">{opt.time}</div>
                    </div>
                  </div>

                  <span className="font-mono font-bold text-stone-900 text-xs">
                    {opt.fee === 0 ? <span className="text-emerald-600 font-bold">OFFERT</span> : `${opt.fee.toFixed(2)} €`}
                  </span>
                </label>
              ))}
            </div>

            <div className="pt-4 border-t border-stone-100 flex justify-between items-center">
              <button
                type="button"
                onClick={() => setStep('info')}
                className="text-stone-600 hover:text-stone-900 font-semibold flex items-center space-x-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Retour coordonnées</span>
              </button>

              <button
                type="button"
                onClick={() => setStep('payment')}
                className="px-6 py-2.5 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-colors shadow-xs"
              >
                <span>Accéder au paiement</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Payment Simulation */}
        {step === 'payment' && (
          <div className="p-6 space-y-4 text-xs">
            <h3 className="font-semibold text-stone-900 text-sm">Mode de Règlement Sécurisé</h3>

            {/* Payment Method Selector */}
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setPaymentMethod('credit_card')}
                className={`p-3 rounded-xl border text-center font-semibold transition-all ${
                  paymentMethod === 'credit_card'
                    ? 'border-stone-900 bg-stone-900 text-white shadow-xs'
                    : 'border-stone-200 bg-stone-50 text-stone-700 hover:bg-stone-100'
                }`}
              >
                <CreditCard className="w-4 h-4 mx-auto mb-1" />
                <span>Carte Bancaire</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod('apple_pay')}
                className={`p-3 rounded-xl border text-center font-semibold transition-all ${
                  paymentMethod === 'apple_pay'
                    ? 'border-stone-900 bg-stone-900 text-white shadow-xs'
                    : 'border-stone-200 bg-stone-50 text-stone-700 hover:bg-stone-100'
                }`}
              >
                <div className="font-bold text-xs mb-1"> Pay</div>
                <span>Apple Pay</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod('paypal')}
                className={`p-3 rounded-xl border text-center font-semibold transition-all ${
                  paymentMethod === 'paypal'
                    ? 'border-stone-900 bg-stone-900 text-white shadow-xs'
                    : 'border-stone-200 bg-stone-50 text-stone-700 hover:bg-stone-100'
                }`}
              >
                <div className="font-bold text-xs mb-1 text-blue-600">PayPal</div>
                <span>PayPal</span>
              </button>
            </div>

            {/* Mock Card Form */}
            {paymentMethod === 'credit_card' && (
              <div className="p-4 bg-stone-50 rounded-2xl border border-stone-200 space-y-3">
                <div>
                  <label className="block text-[11px] font-medium text-stone-600 mb-1">Numéro de Carte (Simulation active)</label>
                  <input
                    type="text"
                    readOnly
                    value="4532 •••• •••• 8821"
                    className="w-full px-3 py-2 bg-white border border-stone-300 rounded-xl font-mono text-xs text-stone-800"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-stone-600 mb-1">Expiration</label>
                    <input
                      type="text"
                      readOnly
                      value="12/28"
                      className="w-full px-3 py-2 bg-white border border-stone-300 rounded-xl font-mono text-xs text-stone-800"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-stone-600 mb-1">Cryptogramme CVC</label>
                    <input
                      type="text"
                      readOnly
                      value="••• (918)"
                      className="w-full px-3 py-2 bg-white border border-stone-300 rounded-xl font-mono text-xs text-stone-800"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Order Summary Recap */}
            <div className="p-4 bg-stone-100 rounded-2xl space-y-1.5 text-stone-700">
              <div className="flex justify-between">
                <span>Sous-total articles :</span>
                <span className="font-mono">{cartSubtotal.toFixed(2)} €</span>
              </div>
              {cartDiscount > 0 && (
                <div className="flex justify-between text-emerald-700 font-semibold">
                  <span>Remise promo :</span>
                  <span className="font-mono">-{cartDiscount.toFixed(2)} €</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>Livraison ({selectedShipping.name}) :</span>
                <span className="font-mono">
                  {selectedShipping.fee === 0 ? 'OFFERT' : `${selectedShipping.fee.toFixed(2)} €`}
                </span>
              </div>
              <div className="flex justify-between font-bold text-sm text-stone-900 border-t border-stone-200 pt-2">
                <span>Montant Total Débité :</span>
                <span className="font-mono text-base text-amber-600">{currentFinalTotal.toFixed(2)} €</span>
              </div>
            </div>

            <div className="pt-2 flex justify-between items-center">
              <button
                type="button"
                onClick={() => setStep('shipping')}
                className="text-stone-600 hover:text-stone-900 font-semibold flex items-center space-x-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Retour</span>
              </button>

              <button
                type="button"
                disabled={isProcessing}
                onClick={handleProcessOrder}
                className="px-6 py-3 bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold rounded-xl text-xs flex items-center space-x-2 transition-all shadow-md active:scale-98 disabled:opacity-50"
              >
                {isProcessing ? (
                  <span>Paiement en cours...</span>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span>Régler {currentFinalTotal.toFixed(2)} € en direct</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Success & Confirmation */}
        {step === 'success' && completedOrder && (
          <div className="p-8 text-center space-y-5">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-3xl flex items-center justify-center mx-auto shadow-sm">
              <CheckCircle className="w-8 h-8" />
            </div>

            <div>
              <h3 className="font-serif font-bold text-xl text-stone-900">
                Félicitations pour votre commande !
              </h3>
              <p className="text-xs text-stone-500 mt-1 max-w-sm mx-auto">
                Votre paiement a été validé et votre commande a été immédiatement enregistrée dans le back-office.
              </p>
            </div>

            {/* Order details badge */}
            <div className="p-4 bg-stone-50 rounded-2xl border border-stone-200 max-w-md mx-auto text-left space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-stone-500">N° de Commande :</span>
                <span className="font-mono font-bold text-stone-900">{completedOrder.orderNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">N° Suivi Expédition :</span>
                <span className="font-mono font-bold text-amber-700">{completedOrder.trackingNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Destinataire :</span>
                <span className="font-semibold text-stone-900">{completedOrder.customer.name} ({completedOrder.customer.city})</span>
              </div>
              <div className="flex justify-between border-t border-stone-200 pt-2 font-bold">
                <span>Montant Payé :</span>
                <span className="font-mono text-emerald-600">{completedOrder.total.toFixed(2)} €</span>
              </div>
            </div>

            <div className="pt-2 flex flex-col sm:flex-row justify-center gap-3">
              <button
                onClick={() => {
                  onClose();
                  setCurrentTab('orders');
                }}
                className="px-5 py-2.5 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-semibold transition-colors flex items-center justify-center space-x-2"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Voir la commande dans le Back-Office</span>
              </button>

              <button
                onClick={() => {
                  onClose();
                  setStep('info');
                }}
                className="px-5 py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-xl text-xs font-semibold transition-colors"
              >
                Continuer mes achats sur la boutique
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
