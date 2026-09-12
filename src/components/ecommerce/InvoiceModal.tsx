import React from 'react';
import { Order } from '../../types/ecommerce';
import { X, Printer, CheckCircle, Package, Download } from 'lucide-react';

interface InvoiceModalProps {
  order: Order | null;
  onClose: () => void;
}

export const InvoiceModal: React.FC<InvoiceModalProps> = ({ order, onClose }) => {
  if (!order) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-stone-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-stone-200 overflow-hidden my-8 animate-in zoom-in-95 duration-200">
        
        {/* Modal Top Bar (hidden on print) */}
        <div className="p-4 border-b border-stone-100 flex items-center justify-between bg-stone-50 print:hidden">
          <div className="flex items-center space-x-2">
            <span className="font-semibold text-stone-900 text-sm">Facture & Bon de Commande Officiel</span>
            <span className="font-mono text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
              {order.orderNumber}
            </span>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handlePrint}
              className="px-3 py-1.5 bg-stone-900 hover:bg-stone-800 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors shadow-xs"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Imprimer / PDF</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-stone-400 hover:text-stone-600 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Invoice Document Body */}
        <div className="p-8 text-stone-900 font-sans space-y-6 bg-white text-xs">
          
          {/* Header Info */}
          <div className="flex items-start justify-between border-b border-stone-200 pb-6">
            <div>
              <div className="text-xl font-serif font-bold text-stone-950">Atelier Marchand</div>
              <p className="text-stone-500 mt-1">
                Boutique en ligne & Créations Artisanales<br />
                12 Rue du Faubourg Saint-Honoré, 75008 Paris<br />
                contact@ateliermarchand.fr · N° SIRET : 892 481 029 00014
              </p>
            </div>

            <div className="text-right">
              <div className="text-base font-mono font-bold text-stone-900">FACTURE #{order.orderNumber}</div>
              <p className="text-stone-500 mt-1">
                Date : {new Date(order.createdAt).toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' })}<br />
                Statut : <span className="font-semibold uppercase text-emerald-700">{order.status}</span><br />
                Paiement : {order.paymentMethod.replace('_', ' ').toUpperCase()}
              </p>
            </div>
          </div>

          {/* Billing & Shipping Addresses */}
          <div className="grid grid-cols-2 gap-8 py-2">
            <div>
              <div className="font-bold text-stone-900 uppercase text-[10px] tracking-wider text-stone-400 mb-1">
                Destinataire / Livré à :
              </div>
              <div className="font-semibold text-stone-900 text-sm">{order.customer.name}</div>
              <div className="text-stone-600 mt-0.5">
                {order.customer.address}<br />
                {order.customer.zipCode} {order.customer.city}<br />
                {order.customer.country}<br />
                Tél : {order.customer.phone}<br />
                Email : {order.customer.email}
              </div>
            </div>

            <div>
              <div className="font-bold text-stone-900 uppercase text-[10px] tracking-wider text-stone-400 mb-1">
                Expédition & Suivi :
              </div>
              <div className="font-semibold text-stone-900">{order.shippingMethod}</div>
              {order.trackingNumber && (
                <div className="mt-1">
                  <span className="text-stone-500">N° de Suivi colis :</span>
                  <div className="font-mono font-bold text-amber-700 mt-0.5">{order.trackingNumber}</div>
                </div>
              )}
            </div>
          </div>

          {/* Items Table */}
          <div className="border border-stone-200 rounded-xl overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-stone-50 text-stone-600 font-semibold border-b border-stone-200">
                <tr>
                  <th className="p-3">Désignation</th>
                  <th className="p-3 text-center">Quantité</th>
                  <th className="p-3 text-right">Prix Unitaire HT</th>
                  <th className="p-3 text-right">Total TTC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {order.items.map((item, idx) => (
                  <tr key={idx}>
                    <td className="p-3">
                      <div className="font-semibold text-stone-900">{item.productName}</div>
                      {item.variant && (
                        <div className="text-[11px] text-stone-500">Option : {item.variant}</div>
                      )}
                    </td>
                    <td className="p-3 text-center font-mono">{item.quantity}</td>
                    <td className="p-3 text-right font-mono text-stone-600">
                      {(item.price / 1.20).toFixed(2)} €
                    </td>
                    <td className="p-3 text-right font-mono font-bold text-stone-900">
                      {(item.price * item.quantity).toFixed(2)} €
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Financial Totals */}
          <div className="flex justify-end">
            <div className="w-64 space-y-2 border-t border-stone-200 pt-3">
              <div className="flex justify-between text-stone-600">
                <span>Sous-total articles :</span>
                <span className="font-mono">{order.subtotal.toFixed(2)} €</span>
              </div>
              {order.discount > 0 && (
                <div className="flex justify-between text-emerald-600 font-medium">
                  <span>Remise promo ({order.couponCode}) :</span>
                  <span className="font-mono">-{order.discount.toFixed(2)} €</span>
                </div>
              )}
              <div className="flex justify-between text-stone-600">
                <span>Frais d'expédition :</span>
                <span className="font-mono">
                  {order.shippingFee === 0 ? 'Offert' : `${order.shippingFee.toFixed(2)} €`}
                </span>
              </div>
              <div className="flex justify-between text-stone-500 text-[11px]">
                <span>TVA incluse (20%) :</span>
                <span className="font-mono">{order.tax.toFixed(2)} €</span>
              </div>
              <div className="flex justify-between text-stone-950 font-bold text-sm border-t border-stone-200 pt-2">
                <span>Total TTC Réglé :</span>
                <span className="font-mono text-base text-amber-600">{order.total.toFixed(2)} €</span>
              </div>
            </div>
          </div>

          {/* Bottom Legal Notes */}
          <div className="border-t border-stone-200 pt-4 text-center text-[10px] text-stone-400">
            Merci pour votre confiance. En cas de réclamation ou retour, contactez notre service client sous 14 jours.
          </div>

        </div>

      </div>
    </div>
  );
};
