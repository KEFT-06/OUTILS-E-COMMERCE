import React, { useState } from 'react';
import { RESTAURANT_MENU } from '../../data/templates';
import { Utensils, Calendar, Clock, MapPin, Star, CheckCircle, X, ChevronRight, Phone } from 'lucide-react';

export const RestaurantDemo: React.FC = () => {
  const [activeCategory, setActiveCategory] = useState<'Entrées' | 'Plats' | 'Desserts'>('Entrées');
  const [isReserveModalOpen, setIsReserveModalOpen] = useState(false);
  const [bookingConfirmed, setBookingConfirmed] = useState(false);
  const [bookingDetails, setBookingDetails] = useState({
    name: 'Jean Dupont',
    date: '2026-09-18',
    time: '20:00',
    guests: '2',
  });

  const handleBookingSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setBookingConfirmed(true);
    setTimeout(() => {
      setIsReserveModalOpen(false);
      setBookingConfirmed(false);
    }, 2800);
  };

  const selectedCategoryItems = RESTAURANT_MENU.find(c => c.category === activeCategory)?.items || [];

  return (
    <div className="bg-stone-50 text-stone-800 font-sans min-h-full">
      {/* Top bar announcement */}
      <div className="bg-amber-950 text-amber-100 text-xs px-4 py-2 text-center flex items-center justify-center space-x-2">
        <span>✨ Nouvelle carte d'automne par le Chef Antoine Mercier</span>
        <span className="opacity-40">•</span>
        <span className="underline cursor-pointer" onClick={() => setIsReserveModalOpen(true)}>Réservez votre table</span>
      </div>

      {/* Nav */}
      <header className="border-b border-stone-200 bg-white/80 backdrop-blur sticky top-0 z-10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Utensils className="w-5 h-5 text-amber-700" />
          <span className="font-serif text-lg font-bold tracking-tight text-stone-900">L'Atelier Bistronomique</span>
        </div>
        <div className="hidden md:flex items-center space-x-6 text-sm text-stone-600">
          <a href="#menu" className="hover:text-amber-800">La Carte</a>
          <a href="#about" className="hover:text-amber-800">Notre Histoire</a>
          <a href="#info" className="hover:text-amber-800">Accès & Horaires</a>
        </div>
        <button
          id="restaurant-nav-reserve-btn"
          onClick={() => setIsReserveModalOpen(true)}
          className="px-4 py-2 bg-amber-800 hover:bg-amber-900 text-white text-xs font-semibold rounded-lg shadow-sm transition-all"
        >
          Réserver en ligne
        </button>
      </header>

      {/* Hero */}
      <section className="relative bg-stone-900 text-white py-16 px-6 sm:px-12 text-center overflow-hidden">
        <div 
          className="absolute inset-0 bg-cover bg-center opacity-30"
          style={{ backgroundImage: `url('https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1400&auto=format&fit=crop&q=80')` }}
        />
        <div className="relative max-w-2xl mx-auto space-y-4">
          <span className="inline-block uppercase text-xs tracking-widest text-amber-300 font-semibold bg-amber-900/60 px-3 py-1 rounded-full border border-amber-500/30">
            Cuisine du Terroir & Raffinement
          </span>
          <h1 className="text-3xl sm:text-5xl font-serif font-bold text-stone-100 leading-tight">
            Une table d'exception au cœur du Marais
          </h1>
          <p className="text-stone-300 text-sm sm:text-base leading-relaxed">
            Produits frais de saison sélectionnés auprès d'artisans locaux, sublimés par des cuissons lentes et des accords mets-vins minutieux.
          </p>
          <div className="pt-2 flex flex-wrap justify-center gap-3">
            <button
              id="restaurant-hero-reserve-btn"
              onClick={() => setIsReserveModalOpen(true)}
              className="px-6 py-3 bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold rounded-lg shadow-md transition-all flex items-center space-x-2"
            >
              <Calendar className="w-4 h-4" />
              <span>Réserver une table</span>
            </button>
            <a
              href="#menu"
              className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white text-sm font-semibold rounded-lg backdrop-blur transition-all"
            >
              Consulter la carte
            </a>
          </div>
        </div>
      </section>

      {/* Highlights */}
      <section className="max-w-5xl mx-auto px-6 py-8 grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="flex items-start space-x-3 p-4 bg-white rounded-xl border border-stone-200">
          <Star className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-semibold text-stone-900 text-sm">Guide Michelin & Avis 4.9/5</h4>
            <p className="text-xs text-stone-500">Reconnu par plus de 800 gourmets satisfaits.</p>
          </div>
        </div>
        <div className="flex items-start space-x-3 p-4 bg-white rounded-xl border border-stone-200">
          <Clock className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-semibold text-stone-900 text-sm">Du Mardi au Dimanche</h4>
            <p className="text-xs text-stone-500">Midi (12h-14h30) & Soir (19h30-23h00).</p>
          </div>
        </div>
        <div className="flex items-start space-x-3 p-4 bg-white rounded-xl border border-stone-200">
          <MapPin className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-semibold text-stone-900 text-sm">24 Rue des Rosiers, Paris 4e</h4>
            <p className="text-xs text-stone-500">Terrasse couverte & salon privé sur demande.</p>
          </div>
        </div>
      </section>

      {/* Menu Section */}
      <section id="menu" className="max-w-4xl mx-auto px-6 py-12">
        <div className="text-center space-y-2 mb-8">
          <span className="text-xs font-semibold uppercase tracking-wider text-amber-800">Saveurs & Découvertes</span>
          <h2 className="text-2xl sm:text-3xl font-serif font-bold text-stone-900">La Carte de Saison</h2>
          <p className="text-stone-500 text-xs sm:text-sm">Tous nos plats sont élaborés sur place à partir de produits bruts de nos terroirs.</p>
        </div>

        {/* Category Tabs */}
        <div className="flex justify-center space-x-2 mb-8 border-b border-stone-200 pb-2">
          {(['Entrées', 'Plats', 'Desserts'] as const).map((cat) => (
            <button
              key={cat}
              id={`tab-menu-${cat}`}
              onClick={() => setActiveCategory(cat)}
              className={`px-5 py-2 text-sm font-medium rounded-lg transition-colors ${
                activeCategory === cat
                  ? 'bg-amber-800 text-white shadow-xs'
                  : 'text-stone-600 hover:text-stone-900 hover:bg-stone-100'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Menu Items List */}
        <div className="space-y-4">
          {selectedCategoryItems.map((item, idx) => (
            <div
              key={idx}
              className="bg-white p-5 rounded-xl border border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-amber-400 transition-colors"
            >
              <div className="space-y-1">
                <div className="flex items-baseline space-x-3">
                  <h3 className="font-serif font-semibold text-stone-900 text-base">{item.name}</h3>
                </div>
                <p className="text-xs sm:text-sm text-stone-500">{item.desc}</p>
              </div>
              <div className="text-right sm:shrink-0">
                <span className="text-base font-semibold text-amber-900 font-serif">{item.price}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 text-center bg-amber-50 border border-amber-200 rounded-xl p-6">
          <p className="text-xs text-amber-800 font-medium">
            Formule Déjeuner en semaine : Entrée + Plat ou Plat + Dessert à 24 € • Menu complet à 29 €
          </p>
        </div>
      </section>

      {/* Reservation CTA banner */}
      <section className="bg-stone-900 text-stone-200 py-12 px-6 text-center">
        <div className="max-w-xl mx-auto space-y-4">
          <h3 className="text-xl sm:text-2xl font-serif font-bold text-white">Une envie de table ce soir ?</h3>
          <p className="text-xs sm:text-sm text-stone-400">
            Réservation instantanée sans prépaiement. Vous pouvez aussi nous joindre au <span className="text-amber-300 font-medium">+33 1 42 78 55 90</span>.
          </p>
          <button
            id="restaurant-cta-book-btn"
            onClick={() => setIsReserveModalOpen(true)}
            className="px-6 py-3 bg-amber-700 hover:bg-amber-600 text-white text-sm font-semibold rounded-lg shadow-sm transition-all inline-flex items-center space-x-2"
          >
            <Calendar className="w-4 h-4" />
            <span>Réserver ma table</span>
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer id="info" className="bg-stone-950 text-stone-400 text-xs py-8 px-6 border-t border-stone-800">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
          <p>© 2026 L'Atelier Bistronomique. Tous droits réservés.</p>
          <div className="flex items-center space-x-4">
            <span className="flex items-center space-x-1">
              <Phone className="w-3.5 h-3.5 text-amber-500" />
              <span>01 42 78 55 90</span>
            </span>
            <span>contact@latelier-paris.fr</span>
          </div>
        </div>
      </footer>

      {/* Modal Réserver une table */}
      {isReserveModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl relative border border-stone-200">
            <button
              onClick={() => setIsReserveModalOpen(false)}
              className="absolute top-4 right-4 p-1 rounded-full text-stone-400 hover:text-stone-700 hover:bg-stone-100"
            >
              <X className="w-5 h-5" />
            </button>

            {bookingConfirmed ? (
              <div className="text-center py-6 space-y-3">
                <CheckCircle className="w-12 h-12 text-emerald-600 mx-auto animate-bounce" />
                <h3 className="text-lg font-bold text-stone-900">Table Réservée avec Succès !</h3>
                <p className="text-xs text-stone-600">
                  Nous avons bien noté votre réservation au nom de <strong>{bookingDetails.name}</strong> pour <strong>{bookingDetails.guests} personne(s)</strong> le <strong>{bookingDetails.date}</strong> à <strong>{bookingDetails.time}</strong>.
                </p>
                <p className="text-[11px] text-stone-400">Un e-mail et SMS de confirmation ont été simulés.</p>
              </div>
            ) : (
              <form onSubmit={handleBookingSubmit} className="space-y-4">
                <div className="space-y-1">
                  <span className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Réservation en direct</span>
                  <h3 className="text-lg font-bold text-stone-900 font-serif">Réservez votre moment gourmand</h3>
                  <p className="text-xs text-stone-500">Confirmation immédiate selon nos disponibilités.</p>
                </div>

                <div className="space-y-3 pt-2 text-xs text-stone-700">
                  <div>
                    <label className="block font-medium mb-1">Votre Nom complet</label>
                    <input
                      type="text"
                      required
                      value={bookingDetails.name}
                      onChange={(e) => setBookingDetails({ ...bookingDetails, name: e.target.value })}
                      className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs focus:ring-2 focus:ring-amber-500 outline-hidden"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-medium mb-1">Date</label>
                      <input
                        type="date"
                        required
                        value={bookingDetails.date}
                        onChange={(e) => setBookingDetails({ ...bookingDetails, date: e.target.value })}
                        className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs focus:ring-2 focus:ring-amber-500 outline-hidden"
                      />
                    </div>
                    <div>
                      <label className="block font-medium mb-1">Heure</label>
                      <select
                        value={bookingDetails.time}
                        onChange={(e) => setBookingDetails({ ...bookingDetails, time: e.target.value })}
                        className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs focus:ring-2 focus:ring-amber-500 outline-hidden"
                      >
                        <option value="12:00">12:00 (Midi)</option>
                        <option value="12:30">12:30</option>
                        <option value="13:00">13:00</option>
                        <option value="19:30">19:30 (Soir)</option>
                        <option value="20:00">20:00</option>
                        <option value="20:30">20:30</option>
                        <option value="21:00">21:00</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block font-medium mb-1">Nombre de convives</label>
                    <div className="flex space-x-2">
                      {['1', '2', '4', '6', '8+'].map((num) => (
                        <button
                          key={num}
                          type="button"
                          onClick={() => setBookingDetails({ ...bookingDetails, guests: num })}
                          className={`flex-1 py-1.5 rounded-lg border text-xs font-semibold ${
                            bookingDetails.guests === num
                              ? 'bg-amber-800 text-white border-amber-800'
                              : 'bg-stone-50 border-stone-300 text-stone-700 hover:bg-stone-100'
                          }`}
                        >
                          {num}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    className="w-full py-2.5 bg-amber-800 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-all"
                  >
                    Confirmer la réservation
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
