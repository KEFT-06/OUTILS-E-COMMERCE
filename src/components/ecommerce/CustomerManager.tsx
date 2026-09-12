import React, { useState } from 'react';
import { useEcommerce } from '../../context/EcommerceContext';
import { Users, Search, Mail, Phone, MapPin, Award, ShoppingBag, Download } from 'lucide-react';

export const CustomerManager: React.FC = () => {
  const { customers } = useEcommerce();
  const [searchTerm, setSearchTerm] = useState('');

  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.city.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-2xl border border-stone-200 shadow-xs">
        <div>
          <div className="flex items-center space-x-2">
            <Users className="w-5 h-5 text-blue-600" />
            <h1 className="text-xl font-serif font-bold text-stone-900">Base Clients & CRM E-Commerce</h1>
          </div>
          <p className="text-xs text-stone-500 mt-0.5">
            Historique d'achat, valeur vie client (LTV) et segmentation automatique des acheteurs.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-xs text-stone-500 font-mono">
            {customers.length} contacts enregistrés
          </span>
        </div>
      </div>

      {/* Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-xs flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Rechercher par nom, email, ville..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs text-stone-900 placeholder:text-stone-400 focus:ring-2 focus:ring-amber-500/30"
          />
        </div>
      </div>

      {/* Customers Table */}
      <div className="bg-white rounded-2xl border border-stone-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-stone-50 text-stone-500 uppercase tracking-wider font-semibold border-b border-stone-100">
              <tr>
                <th className="px-5 py-3">Client</th>
                <th className="px-4 py-3">Coordonnées</th>
                <th className="px-4 py-3">Ville</th>
                <th className="px-4 py-3 text-center">Commandes</th>
                <th className="px-4 py-3 font-mono">Total Dépensé (LTV)</th>
                <th className="px-4 py-3">Segment CRM</th>
                <th className="px-4 py-3 text-right">Dernière Activité</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 text-stone-700">
              {filteredCustomers.map(customer => (
                <tr key={customer.id} className="hover:bg-stone-50/60 transition-colors">
                  
                  {/* Name & Avatar */}
                  <td className="px-5 py-3.5">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 rounded-full bg-stone-900 text-amber-300 font-bold text-xs flex items-center justify-center">
                        {customer.name.charAt(0)}
                      </div>
                      <div className="font-semibold text-stone-900 text-xs">
                        {customer.name}
                      </div>
                    </div>
                  </td>

                  {/* Contact */}
                  <td className="px-4 py-3.5">
                    <div className="text-stone-600 flex items-center space-x-1">
                      <Mail className="w-3 h-3 text-stone-400" />
                      <span>{customer.email}</span>
                    </div>
                    {customer.phone && (
                      <div className="text-[11px] text-stone-400 flex items-center space-x-1 mt-0.5">
                        <Phone className="w-2.5 h-2.5" />
                        <span>{customer.phone}</span>
                      </div>
                    )}
                  </td>

                  {/* City */}
                  <td className="px-4 py-3.5 text-stone-600">
                    <div className="flex items-center space-x-1">
                      <MapPin className="w-3 h-3 text-stone-400" />
                      <span>{customer.city}</span>
                    </div>
                  </td>

                  {/* Orders */}
                  <td className="px-4 py-3.5 text-center font-mono font-bold text-stone-900">
                    {customer.ordersCount}
                  </td>

                  {/* Total spent */}
                  <td className="px-4 py-3.5 font-mono font-bold text-stone-900">
                    {customer.totalSpent.toFixed(2)} €
                  </td>

                  {/* Status Badge */}
                  <td className="px-4 py-3.5">
                    {customer.status === 'vip' && (
                      <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                        <Award className="w-2.5 h-2.5 text-amber-600" />
                        <span>CLIENT VIP</span>
                      </span>
                    )}
                    {customer.status === 'regular' && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        Client Actif
                      </span>
                    )}
                    {customer.status === 'lead' && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-stone-100 text-stone-600">
                        Prospect
                      </span>
                    )}
                  </td>

                  {/* Last Activity */}
                  <td className="px-4 py-3.5 text-right font-mono text-stone-500 text-[11px]">
                    {customer.lastOrderDate}
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
