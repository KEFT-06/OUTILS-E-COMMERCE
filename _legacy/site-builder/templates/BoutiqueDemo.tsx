import React, { useState } from 'react';
import { BOUTIQUE_PRODUCTS } from '../../data/templates';
import { ShoppingBag, Star, Plus, Minus, Trash2, X, Check, Heart, Shield, RefreshCw } from 'lucide-react';

interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  image: string;
}

export const BoutiqueDemo: React.FC = () => {
  const [cart, setCart] = useState<CartItem[]>([
    { id: 'p1', name: 'Vase Amphore Terrecuite', price: 68, quantity: 1, image: BOUTIQUE_PRODUCTS[0].image }
  ]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [orderCompleted, setOrderCompleted] = useState(false);
  const [favorites, setFavorites] = useState<string[]>(['p2']);

  const addToCart = (product: typeof BOUTIQUE_PRODUCTS[0]) => {
    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) {
        return prev.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { id: product.id, name: product.name, price: product.price, quantity: 1, image: product.image }];
    });
    setIsCartOpen(true);
  };

  const updateQuantity = (id: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        const newQty = item.quantity + delta;
        return newQty > 0 ? { ...item, quantity: newQty } : item;
      }
      return item;
    }));
  };

  const removeFromCart = (id: string) => {
    setCart(prev => prev.filter(item => item.id !== id));
  };

  const toggleFavorite = (id: string) => {
    setFavorites(prev => prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]);
  };

  const cartTotal = cart.reduce((acc, item) => acc + item.price * item.quantity, 0);
  const totalItemsCount = cart.reduce((acc, item) => acc + item.quantity, 0);

  const handleCheckout = () => {
    setOrderCompleted(true);
    setTimeout(() => {
      setCart([]);
      setOrderCompleted(false);
      setIsCartOpen(false);
    }, 3000);
  };

  return (
    <div className="bg-stone-50 text-stone-800 font-sans min-h-full">
      {/* Announcement */}
      <div className="bg-emerald-900 text-emerald-100 text-[11px] py-1.5 px-4 text-center">
        🌿 Livraison offerte dès 70 € d’achat en France métropolitaine • Emballages 100% recyclables
      </div>

      {/* Header */}
      <header className="border-b border-stone-200 bg-white/90 backdrop-blur sticky top-0 z-10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="font-serif text-lg font-bold tracking-tight text-stone-900">Maison Terre & Lin</span>
        </div>
        <div className="hidden sm:flex items-center space-x-6 text-xs text-stone-600">
          <a href="#catalogue" className="hover:text-emerald-800">Céramiques</a>
          <a href="#catalogue" className="hover:text-emerald-800">Linge & Textile</a>
          <a href="#engagements" className="hover:text-emerald-800">Nos Engagements</a>
        </div>
        <button
          id="boutique-cart-btn"
          onClick={() => setIsCartOpen(true)}
          className="flex items-center space-x-2 px-3 py-1.5 bg-stone-100 hover:bg-stone-200 rounded-full text-xs font-semibold text-stone-800 transition-colors relative"
        >
          <ShoppingBag className="w-4 h-4 text-emerald-800" />
          <span>Panier</span>
          {totalItemsCount > 0 && (
            <span className="w-5 h-5 rounded-full bg-emerald-700 text-white text-[10px] flex items-center justify-center font-bold">
              {totalItemsCount}
            </span>
          )}
        </button>
      </header>

      {/* Hero */}
      <section className="relative bg-emerald-950 text-emerald-50 py-16 px-6 text-center overflow-hidden">
        <div 
          className="absolute inset-0 bg-cover bg-center opacity-25"
          style={{ backgroundImage: `url('https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?w=1200&auto=format&fit=crop&q=80')` }}
        />
        <div className="relative max-w-2xl mx-auto space-y-3">
          <span className="uppercase text-[11px] font-bold tracking-widest text-emerald-300">Artisanat Français d'Exception</span>
          <h1 className="text-3xl sm:text-5xl font-serif font-bold text-white leading-tight">
            La beauté des matières brutes & durables
          </h1>
          <p className="text-emerald-200 text-xs sm:text-sm">
            Chaque pièce raconte une histoire de patience, façonnée à la main pour illuminer votre intérieur au quotidien.
          </p>
        </div>
      </section>

      {/* Catalogue */}
      <section id="catalogue" className="max-w-5xl mx-auto px-6 py-12">
        <div className="flex justify-between items-end mb-8">
          <div>
            <h2 className="text-xl font-serif font-bold text-stone-900">Nos Pièces Phares</h2>
            <p className="text-xs text-stone-500">Séries limitées conçues avec des terres et fibres locales.</p>
          </div>
          <span className="text-xs text-stone-500">{BOUTIQUE_PRODUCTS.length} pièces disponibles</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {BOUTIQUE_PRODUCTS.map((product) => {
            const isFav = favorites.includes(product.id);
            return (
              <div key={product.id} className="bg-white rounded-xl border border-stone-200 overflow-hidden group hover:shadow-md transition-all flex flex-col justify-between">
                <div>
                  <div className="relative aspect-square overflow-hidden bg-stone-100">
                    <img
                      src={product.image}
                      alt={product.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      referrerPolicy="no-referrer"
                    />
                    <button
                      onClick={() => toggleFavorite(product.id)}
                      className="absolute top-2 right-2 p-1.5 rounded-full bg-white/80 hover:bg-white text-stone-600 transition-colors"
                    >
                      <Heart className={`w-4 h-4 ${isFav ? 'fill-rose-500 text-rose-500' : ''}`} />
                    </button>
                    <span className="absolute bottom-2 left-2 text-[10px] uppercase tracking-wider font-semibold bg-stone-900/70 text-white px-2 py-0.5 rounded-sm">
                      {product.category}
                    </span>
                  </div>
                  <div className="p-4 space-y-1.5">
                    <div className="flex items-center space-x-1 text-amber-500">
                      <Star className="w-3.5 h-3.5 fill-amber-400" />
                      <span className="text-xs font-semibold text-stone-700">{product.rating}</span>
                    </div>
                    <h3 className="font-serif font-semibold text-stone-900 text-sm leading-snug">{product.name}</h3>
                    <p className="text-[11px] text-stone-500 line-clamp-2">{product.desc}</p>
                  </div>
                </div>

                <div className="p-4 pt-0 flex items-center justify-between border-t border-stone-100 mt-2">
                  <span className="font-serif font-bold text-stone-900 text-base">{product.price} €</span>
                  <button
                    id={`add-to-cart-${product.id}`}
                    onClick={() => addToCart(product)}
                    className="px-3 py-1.5 bg-emerald-800 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg flex items-center space-x-1 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Ajouter</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Engagements */}
      <section id="engagements" className="bg-stone-100 border-t border-stone-200 py-10 px-6">
        <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-6 text-center">
          <div className="space-y-2">
            <Shield className="w-6 h-6 text-emerald-800 mx-auto" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-stone-800">Fait Main en France</h4>
            <p className="text-xs text-stone-500">Créé dans notre atelier en Normandie avec amour du geste.</p>
          </div>
          <div className="space-y-2">
            <RefreshCw className="w-6 h-6 text-emerald-800 mx-auto" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-stone-800">Retours Sous 30 Jours</h4>
            <p className="text-xs text-stone-500">Échanges et retours simplifiés sans frais cachés.</p>
          </div>
          <div className="space-y-2">
            <Heart className="w-6 h-6 text-emerald-800 mx-auto" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-stone-800">Éco-responsable</h4>
            <p className="text-xs text-stone-500">Matières naturelles et emballages zéro plastique.</p>
          </div>
        </div>
      </section>

      {/* Cart Drawer */}
      {isCartOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex justify-end">
          <div className="bg-white w-full max-w-md h-full shadow-2xl flex flex-col justify-between p-6 overflow-y-auto">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-stone-200">
                <div className="flex items-center space-x-2">
                  <ShoppingBag className="w-5 h-5 text-emerald-800" />
                  <h3 className="font-serif font-bold text-stone-900 text-lg">Mon Panier</h3>
                  <span className="text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-semibold">
                    {totalItemsCount}
                  </span>
                </div>
                <button
                  onClick={() => setIsCartOpen(false)}
                  className="p-1 rounded-full text-stone-400 hover:text-stone-700 hover:bg-stone-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {orderCompleted ? (
                <div className="py-12 text-center space-y-3">
                  <Check className="w-12 h-12 text-emerald-600 mx-auto" />
                  <h4 className="font-serif text-lg font-bold text-stone-900">Merci pour votre commande !</h4>
                  <p className="text-xs text-stone-600">
                    Votre commande a été validée avec succès. Notre atelier prépare soigneusement vos pièces artisanales.
                  </p>
                </div>
              ) : cart.length === 0 ? (
                <div className="py-16 text-center text-stone-400 space-y-2">
                  <ShoppingBag className="w-10 h-10 mx-auto opacity-40" />
                  <p className="text-xs">Votre panier est actuellement vide.</p>
                </div>
              ) : (
                <div className="divide-y divide-stone-100 mt-4 space-y-3">
                  {cart.map((item) => (
                    <div key={item.id} className="pt-3 flex items-center justify-between gap-3">
                      <img src={item.image} alt={item.name} className="w-14 h-14 rounded-lg object-cover bg-stone-100 shrink-0" referrerPolicy="no-referrer" />
                      <div className="flex-1 min-w-0">
                        <h4 className="text-xs font-semibold text-stone-900 truncate">{item.name}</h4>
                        <span className="text-xs text-stone-500 font-serif">{item.price} €</span>
                        <div className="flex items-center space-x-2 mt-1">
                          <button
                            onClick={() => updateQuantity(item.id, -1)}
                            className="p-1 rounded bg-stone-100 hover:bg-stone-200 text-stone-700"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="text-xs font-semibold px-1">{item.quantity}</span>
                          <button
                            onClick={() => updateQuantity(item.id, 1)}
                            className="p-1 rounded bg-stone-100 hover:bg-stone-200 text-stone-700"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-xs font-bold font-serif text-stone-900 block">
                          {item.price * item.quantity} €
                        </span>
                        <button
                          onClick={() => removeFromCart(item.id)}
                          className="text-stone-400 hover:text-rose-600 p-1 mt-1 inline-block"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {!orderCompleted && cart.length > 0 && (
              <div className="border-t border-stone-200 pt-4 space-y-3">
                <div className="flex justify-between text-xs text-stone-600">
                  <span>Sous-total</span>
                  <span className="font-serif font-bold">{cartTotal} €</span>
                </div>
                <div className="flex justify-between text-xs text-stone-600">
                  <span>Frais de livraison</span>
                  <span className="font-medium text-emerald-700">
                    {cartTotal >= 70 ? 'Gratuit' : '4,90 €'}
                  </span>
                </div>
                <div className="flex justify-between text-sm font-bold text-stone-900 pt-2 border-t border-stone-100">
                  <span>Total TTC</span>
                  <span className="font-serif text-base text-emerald-900">
                    {cartTotal >= 70 ? cartTotal : cartTotal + 4.90} €
                  </span>
                </div>
                <button
                  id="boutique-checkout-btn"
                  onClick={handleCheckout}
                  className="w-full py-3 bg-emerald-800 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors"
                >
                  Valider et Commander (Démo)
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="py-6 text-center text-xs text-stone-500 border-t border-stone-200">
        © 2026 Maison Terre & Lin. Artisans céramistes et tisseurs passionnés.
      </footer>
    </div>
  );
};
