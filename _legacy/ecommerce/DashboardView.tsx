import React from 'react';
import { useEcommerce } from '../../context/EcommerceContext';
import { 
  TrendingUp, 
  ShoppingBag, 
  CreditCard, 
  Package, 
  AlertTriangle, 
  ArrowUpRight, 
  ArrowRight, 
  CheckCircle2, 
  Clock, 
  Truck, 
  Calculator,
  Plus
} from 'lucide-react';
import { Order } from '../../types/ecommerce';

interface DashboardViewProps {
  onSelectOrder: (order: Order) => void;
  onOpenNewProduct: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ onSelectOrder, onOpenNewProduct }) => {
  const { 
    totalRevenue, 
    totalOrdersCount, 
    averageOrderValue, 
    orders, 
    products, 
    lowStockProducts, 
    updateStock, 
    setCurrentTab 
  } = useEcommerce();

  // Calculate gross margin across all non-cancelled orders
  const validOrders = orders.filter(o => o.status !== 'cancelled');
  const totalCost = validOrders.reduce((sum, order) => {
    return sum + order.items.reduce((itemSum, item) => itemSum + (item.costPrice * item.quantity), 0);
  }, 0);
  const grossProfit = Math.max(0, totalRevenue - totalCost);
  const profitMarginPercent = totalRevenue > 0 ? ((grossProfit / totalRevenue) * 100).toFixed(1) : '0';

  // Last 5 orders
  const recentOrders = orders.slice(0, 5);

  // Status color helper
  const getStatusBadge = (status: Order['status']) => {
    switch (status) {
      case 'paid':
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">Payée</span>;
      case 'processing':
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">En préparation</span>;
      case 'shipped':
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">Expédiée</span>;
      case 'delivered':
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-stone-100 text-stone-700">Livrée</span>;
      case 'cancelled':
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-800">Annulée</span>;
      default:
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-stone-100 text-stone-800">En attente</span>;
    }
  };

  // Mocked 7-day revenue dataset for clean SVG bar graph
  const salesHistory = [
    { day: 'Lun', amount: 145, orders: 1 },
    { day: 'Mar', amount: 320, orders: 2 },
    { day: 'Mer', amount: 280, orders: 2 },
    { day: 'Jeu', amount: 490, orders: 3 },
    { day: 'Ven', amount: 620, orders: 4 },
    { day: 'Sam', amount: 840, orders: 5 },
    { day: 'Dim (Auj)', amount: 480, orders: 3 },
  ];
  const maxSale = Math.max(...salesHistory.map(s => s.amount));

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      
      {/* Top Welcome & Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-2xl border border-stone-200 shadow-xs">
        <div>
          <h1 className="text-xl font-serif font-bold text-stone-900">Tableau de bord de votre boutique</h1>
          <p className="text-xs text-stone-500 mt-0.5">
            Suivi des ventes, gestion des expéditions et contrôle des marges en temps réel.
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setCurrentTab('storefront')}
            className="px-3.5 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-xl text-xs font-semibold transition-colors flex items-center space-x-1.5 border border-stone-200"
          >
            <span>Tester la boutique en ligne</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onOpenNewProduct}
            className="px-3.5 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-semibold transition-colors flex items-center space-x-1.5 shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Ajouter un produit</span>
          </button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* CA Total */}
        <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-xs">
          <div className="flex items-center justify-between text-stone-500">
            <span className="text-xs font-medium uppercase tracking-wider">Chiffre d'Affaires</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold font-mono text-stone-900">
              {totalRevenue.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €
            </span>
          </div>
          <div className="mt-2 flex items-center space-x-1.5 text-xs text-emerald-600 font-medium">
            <ArrowUpRight className="w-3.5 h-3.5" />
            <span>+18.4% ce mois</span>
            <span className="text-stone-400 font-normal ml-1">vs mois dernier</span>
          </div>
        </div>

        {/* Commandes */}
        <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-xs">
          <div className="flex items-center justify-between text-stone-500">
            <span className="text-xs font-medium uppercase tracking-wider">Commandes Totales</span>
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <ShoppingBag className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold font-mono text-stone-900">
              {totalOrdersCount}
            </span>
          </div>
          <div className="mt-2 text-xs text-stone-500">
            <span className="font-semibold text-stone-700">{validOrders.length} payées</span> · {orders.filter(o => o.status === 'processing').length} à expédier
          </div>
        </div>

        {/* Panier Moyen */}
        <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-xs">
          <div className="flex items-center justify-between text-stone-500">
            <span className="text-xs font-medium uppercase tracking-wider">Panier Moyen (AOV)</span>
            <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <CreditCard className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold font-mono text-stone-900">
              {averageOrderValue.toFixed(2)} €
            </span>
          </div>
          <div className="mt-2 text-xs text-stone-500">
            Objectif : 120,00 €
          </div>
        </div>

        {/* Marge Brute */}
        <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-xs">
          <div className="flex items-center justify-between text-stone-500">
            <span className="text-xs font-medium uppercase tracking-wider">Bénéfice Brut Estimé</span>
            <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
              <Calculator className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-bold font-mono text-stone-900">
              {grossProfit.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €
            </span>
          </div>
          <div className="mt-2 text-xs text-purple-700 font-medium">
            Taux de marge brute : ~{profitMarginPercent}%
          </div>
        </div>

      </div>

      {/* Main Grid: Revenue Bar Chart & Low Stock Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Revenue Bar Chart (2 cols) */}
        <div className="lg:col-span-2 bg-white p-5 rounded-2xl border border-stone-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold text-stone-900 text-sm">Évolution des Ventes Hebdomadaires</h2>
              <p className="text-xs text-stone-500">Volume généré sur les 7 derniers jours</p>
            </div>
            <span className="text-xs font-mono font-semibold bg-stone-100 px-2 py-1 rounded text-stone-700">
              Total 7j : 3 175 €
            </span>
          </div>

          {/* SVG Bar Chart */}
          <div className="h-44 w-full flex items-end justify-between gap-3 pt-6 pb-2 border-b border-stone-100">
            {salesHistory.map((item, idx) => {
              const heightPercent = Math.max(12, Math.round((item.amount / maxSale) * 100));
              const isToday = idx === salesHistory.length - 1;

              return (
                <div key={item.day} className="flex-1 flex flex-col items-center gap-2 group h-full justify-end">
                  {/* Tooltip on hover */}
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-mono bg-stone-900 text-white px-1.5 py-0.5 rounded shadow-sm whitespace-nowrap">
                    {item.amount} € ({item.orders} cmd)
                  </div>
                  {/* Bar */}
                  <div 
                    style={{ height: `${heightPercent}%` }} 
                    className={`w-full max-w-[48px] rounded-t-lg transition-all duration-300 group-hover:brightness-95 ${
                      isToday ? 'bg-amber-500' : 'bg-stone-800'
                    }`}
                  />
                  {/* Day Label */}
                  <span className={`text-[11px] font-medium ${isToday ? 'text-amber-600 font-bold' : 'text-stone-500'}`}>
                    {item.day}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between text-xs text-stone-500 pt-3">
            <div className="flex items-center space-x-3">
              <span className="flex items-center space-x-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-stone-800"></span>
                <span>Jours passés</span>
              </span>
              <span className="flex items-center space-x-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-amber-500"></span>
                <span>Aujourd’hui</span>
              </span>
            </div>
            <button
              onClick={() => setCurrentTab('margins')}
              className="text-stone-700 hover:text-stone-900 font-medium underline flex items-center space-x-1"
            >
              <span>Calculer le seuil de rentabilité</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Stock & Operational Alerts (1 col) */}
        <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 text-rose-500" />
                <h2 className="font-semibold text-stone-900 text-sm">Alertes de Stock</h2>
              </div>
              <span className="text-xs font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                {lowStockProducts.length} critique(s)
              </span>
            </div>

            <p className="text-xs text-stone-500 mb-4">
              Produits sous le seuil d’alerte. Réapprovisionnez avant rupture pour éviter les manques à gagner.
            </p>

            <div className="space-y-3">
              {lowStockProducts.length === 0 ? (
                <div className="p-4 bg-emerald-50 rounded-xl text-emerald-800 text-xs flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Tous les stocks sont à des niveaux optimaux !</span>
                </div>
              ) : (
                lowStockProducts.map(prod => (
                  <div key={prod.id} className="p-3 bg-stone-50 rounded-xl border border-stone-200 flex items-center justify-between gap-3">
                    <img 
                      src={prod.images[0]} 
                      alt={prod.name} 
                      className="w-10 h-10 rounded-lg object-cover border border-stone-200 shrink-0" 
                    />
                    <div className="min-w-0 flex-1">
                      <h3 className="text-xs font-semibold text-stone-900 truncate">{prod.name}</h3>
                      <p className="text-[11px] text-rose-600 font-semibold font-mono">
                        Reste : {prod.stock} unités (Seuil : {prod.lowStockThreshold})
                      </p>
                    </div>
                    <button
                      onClick={() => updateStock(prod.id, 10)}
                      title="Ajouter +10 unités de stock"
                      className="px-2.5 py-1 bg-white hover:bg-stone-100 text-stone-900 text-[11px] font-semibold rounded-lg border border-stone-300 shadow-2xs shrink-0 transition-colors"
                    >
                      +10 stock
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="pt-4 border-t border-stone-100 mt-4">
            <button
              onClick={() => setCurrentTab('products')}
              className="w-full py-2 text-center text-xs font-semibold text-stone-800 hover:text-stone-950 bg-stone-100 hover:bg-stone-200 rounded-xl transition-colors"
            >
              Gérer tout le catalogue ({products.length} produits)
            </button>
          </div>
        </div>

      </div>

      {/* Recent Orders Section */}
      <div className="bg-white rounded-2xl border border-stone-200 shadow-xs overflow-hidden">
        <div className="p-5 border-b border-stone-100 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-stone-900 text-sm">Dernières Commandes Reçues</h2>
            <p className="text-xs text-stone-500">Commandes synchronisées en direct avec la boutique</p>
          </div>
          <button
            onClick={() => setCurrentTab('orders')}
            className="text-xs font-semibold text-amber-600 hover:text-amber-700 flex items-center space-x-1"
          >
            <span>Voir toutes les commandes</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-stone-50 text-stone-500 uppercase tracking-wider font-semibold border-b border-stone-100">
              <tr>
                <th className="px-5 py-3">Commande</th>
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3">Client</th>
                <th className="px-5 py-3">Articles</th>
                <th className="px-5 py-3">Montant</th>
                <th className="px-5 py-3">Statut</th>
                <th className="px-5 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 text-stone-700">
              {recentOrders.map(order => (
                <tr key={order.id} className="hover:bg-stone-50/60 transition-colors">
                  <td className="px-5 py-3.5 font-mono font-bold text-stone-900">
                    {order.orderNumber}
                  </td>
                  <td className="px-5 py-3.5 text-stone-500">
                    {new Date(order.createdAt).toLocaleDateString('fr-FR', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="font-medium text-stone-900">{order.customer.name}</div>
                    <div className="text-[11px] text-stone-400">{order.customer.city}</div>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="font-medium text-stone-800">{order.items.reduce((s, i) => s + i.quantity, 0)} art.</span>
                    <span className="text-stone-400 text-[11px] block truncate max-w-[180px]">
                      {order.items.map(i => i.productName).join(', ')}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 font-mono font-semibold text-stone-900">
                    {order.total.toFixed(2)} €
                  </td>
                  <td className="px-5 py-3.5">
                    {getStatusBadge(order.status)}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <button
                      onClick={() => onSelectOrder(order)}
                      className="px-2.5 py-1 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-lg text-xs font-medium transition-colors"
                    >
                      Détails / Facture
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};
