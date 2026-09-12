import React, { useState } from 'react';
import { Zap, Check, ChevronDown, ChevronUp, Layers, ShieldCheck, BarChart3, Rocket, ArrowRight } from 'lucide-react';

export const SaasDemo: React.FC = () => {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('annual');
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);

  const faqs = [
    {
      q: 'Puis-je changer de forfait à tout moment ?',
      a: 'Oui, vous pouvez upgrader ou downgrader votre abonnement directement depuis vos paramètres. Les calculs sont effectués au prorata.'
    },
    {
      q: 'Y a-t-il une période d’essai gratuite ?',
      a: 'Absolument. Vous bénéficiez de 14 jours d’essai sans renseigner de carte bancaire, avec accès complet à toutes les fonctionnalités Pro.'
    },
    {
      q: 'Mes données sont-elles hébergées en Europe ?',
      a: 'Oui, l’intégralité de vos bases de données et sauvegardes quotidiennes sont chiffrées de bout en bout et hébergées dans l’UE (RGPD conforme).'
    }
  ];

  return (
    <div className="bg-slate-900 text-slate-100 font-sans min-h-full">
      {/* SaaS Nav */}
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white">
            <Zap className="w-4 h-4 fill-white" />
          </div>
          <span className="font-bold text-base tracking-tight text-white">Nexus Cloud</span>
        </div>
        <div className="hidden md:flex items-center space-x-6 text-xs text-slate-300">
          <a href="#features" className="hover:text-indigo-400 transition-colors">Fonctionnalités</a>
          <a href="#pricing" className="hover:text-indigo-400 transition-colors">Tarification</a>
          <a href="#faq" className="hover:text-indigo-400 transition-colors">FAQ</a>
        </div>
        <div className="flex items-center space-x-2">
          <button className="px-3 py-1.5 text-xs text-slate-300 hover:text-white font-medium">Connexion</button>
          <a
            href="#pricing"
            className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg shadow-sm transition-all flex items-center space-x-1"
          >
            <span>Essai Gratuit</span>
            <ArrowRight className="w-3 h-3" />
          </a>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 pt-16 pb-14 text-center space-y-5">
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-indigo-950/80 text-indigo-300 text-xs border border-indigo-700/50">
          <Rocket className="w-3.5 h-3.5 text-indigo-400" />
          <span>Nouvelle version 3.2 • Connecteurs IA intégrés</span>
        </div>
        <h1 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight leading-tight">
          Automatisez vos flux de travail sans écrire une seule ligne de code
        </h1>
        <p className="text-slate-400 text-xs sm:text-sm max-w-xl mx-auto leading-relaxed">
          Centralisez vos données, synchronisez vos applications préférées et gagnez jusqu’à 15 heures par collaborateur chaque semaine.
        </p>
        <div className="pt-2 flex flex-wrap justify-center gap-3">
          <a
            href="#pricing"
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg shadow-lg shadow-indigo-600/30 transition-all flex items-center space-x-2"
          >
            <span>Démarrer l’essai 14 jours</span>
            <ArrowRight className="w-4 h-4" />
          </a>
          <button className="px-5 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold rounded-lg transition-all">
            Voir la démo vidéo
          </button>
        </div>
      </section>

      {/* Feature Grid */}
      <section id="features" className="max-w-5xl mx-auto px-6 py-12">
        <div className="text-center mb-10 space-y-2">
          <h2 className="text-xl sm:text-2xl font-bold text-white">Pensé pour la vélocité de vos équipes</h2>
          <p className="text-xs sm:text-sm text-slate-400">Une infrastructure résiliente capable de traiter des millions d'événements par seconde.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-6 bg-slate-950/70 border border-slate-800 rounded-xl space-y-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-950 border border-indigo-800/80 flex items-center justify-center text-indigo-400">
              <Layers className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-white text-base">Workflows Déclaratifs</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Connectez plus de 200 connecteurs natifs avec un éditeur visuel glisser-déposer d'une fluidité remarquable.
            </p>
          </div>

          <div className="p-6 bg-slate-950/70 border border-slate-800 rounded-xl space-y-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-950 border border-indigo-800/80 flex items-center justify-center text-indigo-400">
              <BarChart3 className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-white text-base">Analytique en Direct</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Surveillez la santé de vos pipelines, détectez les goulets d'étranglement et anticipez les anomalies instantanément.
            </p>
          </div>

          <div className="p-6 bg-slate-950/70 border border-slate-800 rounded-xl space-y-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-950 border border-indigo-800/80 flex items-center justify-center text-indigo-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-white text-base">Sécurité Bancaire</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Conformité SOC2 Type II, ISO 27001, chiffrement AES-256 et gestion granulaire des rôles et permissions.
            </p>
          </div>
        </div>
      </section>

      {/* Interactive Pricing */}
      <section id="pricing" className="max-w-5xl mx-auto px-6 py-14 border-t border-slate-800">
        <div className="text-center space-y-3 mb-8">
          <span className="text-xs uppercase font-semibold text-indigo-400 tracking-wider">Tarifs Transparents</span>
          <h2 className="text-2xl sm:text-3xl font-bold text-white">Choisissez le plan adapté à votre croissance</h2>
          
          {/* Cycle switcher */}
          <div className="flex items-center justify-center space-x-3 pt-2">
            <span className={`text-xs ${billingCycle === 'monthly' ? 'text-white font-medium' : 'text-slate-400'}`}>Mensuel</span>
            <button
              onClick={() => setBillingCycle(billingCycle === 'monthly' ? 'annual' : 'monthly')}
              className="w-12 h-6 bg-slate-800 rounded-full p-1 transition-colors relative border border-slate-700"
            >
              <div className={`w-4 h-4 rounded-full bg-indigo-500 transition-transform ${billingCycle === 'annual' ? 'translate-x-6' : 'translate-x-0'}`} />
            </button>
            <div className="flex items-center space-x-1.5">
              <span className={`text-xs ${billingCycle === 'annual' ? 'text-white font-medium' : 'text-slate-400'}`}>Annuel</span>
              <span className="text-[10px] bg-emerald-900/80 text-emerald-300 font-bold px-2 py-0.5 rounded-full border border-emerald-700">
                -20%
              </span>
            </div>
          </div>
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Starter */}
          <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between">
            <div>
              <h3 className="font-semibold text-white text-base">Starter</h3>
              <p className="text-xs text-slate-400 mt-1">Idéal pour les indépendants et petites équipes.</p>
              <div className="my-6">
                <span className="text-3xl font-bold text-white">{billingCycle === 'annual' ? '29 €' : '39 €'}</span>
                <span className="text-xs text-slate-400"> /mois</span>
              </div>
              <ul className="space-y-2.5 text-xs text-slate-300">
                <li className="flex items-center space-x-2">
                  <Check className="w-4 h-4 text-indigo-400" />
                  <span>Jusqu’à 5 utilisateurs</span>
                </li>
                <li className="flex items-center space-x-2">
                  <Check className="w-4 h-4 text-indigo-400" />
                  <span>10 000 exécutions /mois</span>
                </li>
                <li className="flex items-center space-x-2">
                  <Check className="w-4 h-4 text-indigo-400" />
                  <span>Support standard sous 48h</span>
                </li>
              </ul>
            </div>
            <button
              onClick={() => setSelectedPlan('Starter')}
              className="mt-6 w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-lg transition-colors"
            >
              Sélectionner Starter
            </button>
          </div>

          {/* Pro (Recommended) */}
          <div className="bg-gradient-to-b from-indigo-950/50 to-slate-950 border-2 border-indigo-500 rounded-2xl p-6 relative flex flex-col justify-between shadow-xl">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-indigo-600 text-white text-[11px] font-bold px-3 py-0.5 rounded-full uppercase tracking-wider">
              Recommandé
            </div>
            <div>
              <h3 className="font-semibold text-white text-base">Professionnel</h3>
              <p className="text-xs text-slate-400 mt-1">Pour les scale-ups avec des besoins d'automatisation avancés.</p>
              <div className="my-6">
                <span className="text-3xl font-bold text-white">{billingCycle === 'annual' ? '79 €' : '99 €'}</span>
                <span className="text-xs text-slate-400"> /mois</span>
              </div>
              <ul className="space-y-2.5 text-xs text-slate-200">
                <li className="flex items-center space-x-2">
                  <Check className="w-4 h-4 text-indigo-400" />
                  <span>Utilisateurs illimités</span>
                </li>
                <li className="flex items-center space-x-2">
                  <Check className="w-4 h-4 text-indigo-400" />
                  <span>100 000 exécutions /mois</span>
                </li>
                <li className="flex items-center space-x-2">
                  <Check className="w-4 h-4 text-indigo-400" />
                  <span>Connecteurs IA avancés</span>
                </li>
                <li className="flex items-center space-x-2">
                  <Check className="w-4 h-4 text-indigo-400" />
                  <span>Support prioritaire dédié 24/7</span>
                </li>
              </ul>
            </div>
            <button
              onClick={() => setSelectedPlan('Pro')}
              className="mt-6 w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition-colors shadow-md"
            >
              Démarrer avec Pro
            </button>
          </div>

          {/* Enterprise */}
          <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between">
            <div>
              <h3 className="font-semibold text-white text-base">Enterprise</h3>
              <p className="text-xs text-slate-400 mt-1">Contrôle absolu, sécurité sur-mesure et SLA garanti.</p>
              <div className="my-6">
                <span className="text-3xl font-bold text-white">Sur Mesure</span>
              </div>
              <ul className="space-y-2.5 text-xs text-slate-300">
                <li className="flex items-center space-x-2">
                  <Check className="w-4 h-4 text-indigo-400" />
                  <span>Déploiement VPC dédié</span>
                </li>
                <li className="flex items-center space-x-2">
                  <Check className="w-4 h-4 text-indigo-400" />
                  <span>SSO / SAML & logs d'audit</span>
                </li>
                <li className="flex items-center space-x-2">
                  <Check className="w-4 h-4 text-indigo-400" />
                  <span>SLA 99.99% contractuel</span>
                </li>
              </ul>
            </div>
            <button
              onClick={() => setSelectedPlan('Enterprise')}
              className="mt-6 w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-lg transition-colors"
            >
              Contacter les ventes
            </button>
          </div>
        </div>

        {selectedPlan && (
          <div className="mt-6 p-4 bg-indigo-900/60 border border-indigo-600 rounded-xl text-center text-xs text-indigo-200">
            Vous avez sélectionné le forfait <strong>{selectedPlan}</strong>. (Simulation d'inscription : formulaire prêt à brancher).
          </div>
        )}
      </section>

      {/* FAQ */}
      <section id="faq" className="max-w-3xl mx-auto px-6 py-12 border-t border-slate-800">
        <h2 className="text-xl font-bold text-white text-center mb-6">Questions Fréquentes</h2>
        <div className="space-y-3">
          {faqs.map((faq, i) => (
            <div key={i} className="bg-slate-950/60 border border-slate-800 rounded-xl overflow-hidden">
              <button
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                className="w-full p-4 text-left flex justify-between items-center text-xs sm:text-sm font-semibold text-slate-200 hover:text-white"
              >
                <span>{faq.q}</span>
                {openFaq === i ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
              </button>
              {openFaq === i && (
                <div className="px-4 pb-4 text-xs text-slate-400 leading-relaxed border-t border-slate-900 pt-3">
                  {faq.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="py-6 text-center text-xs text-slate-600 border-t border-slate-800">
        © 2026 Nexus Cloud Technologies Inc. Hébergé en conformité RGPD.
      </footer>
    </div>
  );
};
