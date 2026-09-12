import React from 'react';
import { Smartphone, Zap, Palette, Database, ShieldCheck, Search, Code2, Layers, CheckCircle2 } from 'lucide-react';

export const TechFeatures: React.FC = () => {
  const pillars = [
    {
      icon: <Smartphone className="w-5 h-5 text-indigo-600" />,
      title: '100% Mobile First & Responsive',
      desc: 'Chaque mise en page est testée pour offrir une ergonomie tactile irréprochable sur iPhone, Android, tablettes et grands écrans 4K.'
    },
    {
      icon: <Zap className="w-5 h-5 text-amber-600" />,
      title: 'Performance & Vitesse Éclair',
      desc: 'Architecture ultra-rapide propulsée par Vite et Tailwind CSS v4. Zéro ralentissement, scores Lighthouse optimaux.'
    },
    {
      icon: <Palette className="w-5 h-5 text-rose-600" />,
      title: 'Design Anti-Slop & Identité Unique',
      desc: 'Typographies choisies avec soin, contrastes validés WCAG AA, pas de dégradés artificiels ni de clichés d’IA générique.'
    },
    {
      icon: <Layers className="w-5 h-5 text-emerald-600" />,
      title: 'Interactivité Réelle & État Vivant',
      desc: 'Paniers de boutique, filtres de catalogues, calendriers de réservation et formulaires avec validation instantanée.'
    },
    {
      icon: <Search className="w-5 h-5 text-blue-600" />,
      title: 'SEO & Balisage Sémantique',
      desc: 'Structure HTML5 propre, balises Open Graph, métadonnées soignées et indexabilité optimale pour Google.'
    },
    {
      icon: <Database className="w-5 h-5 text-purple-600" />,
      title: 'Évolutif Full-Stack sur Demande',
      desc: 'Possibilité d’ajouter une base de données cloud (Firestore, PostgreSQL), un compte utilisateur ou des automatisations.'
    },
  ];

  return (
    <div className="space-y-8">
      {/* Hero Banner */}
      <div className="bg-white rounded-2xl p-8 border border-stone-200 shadow-xs text-center max-w-3xl mx-auto space-y-3">
        <span className="text-xs uppercase tracking-widest font-semibold text-stone-500">Garanties & Qualité de Réalisation</span>
        <h2 className="text-2xl sm:text-3xl font-bold text-stone-900">
          Un développement web sur-mesure aux normes actuelles
        </h2>
        <p className="text-xs sm:text-sm text-stone-600 leading-relaxed">
          Que vous ayez besoin d'une simple page vitrine élégante ou d'une plateforme web applicative avec base de données, chaque projet est codé proprement avec les meilleures pratiques de l'industrie.
        </p>
      </div>

      {/* Pillars Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {pillars.map((pillar, idx) => (
          <div key={idx} className="bg-white p-6 rounded-2xl border border-stone-200 shadow-2xs space-y-3">
            <div className="w-10 h-10 rounded-xl bg-stone-100 flex items-center justify-center">
              {pillar.icon}
            </div>
            <h3 className="font-bold text-sm text-stone-900">{pillar.title}</h3>
            <p className="text-xs text-stone-600 leading-relaxed">{pillar.desc}</p>
          </div>
        ))}
      </div>

      {/* Tech Stack Summary */}
      <div className="bg-stone-900 text-stone-100 rounded-2xl p-8 border border-stone-800">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Code2 className="w-5 h-5 text-amber-400" />
              <h3 className="text-lg font-bold text-white">Stack Technique Moderne</h3>
            </div>
            <p className="text-xs text-stone-400 max-w-xl">
              React 19, TypeScript strict, Tailwind CSS v4, Motion pour les animations fluides, icônes vectorielles Lucide, intégration Express / API REST possible.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="bg-stone-800 px-3 py-1.5 rounded-lg border border-stone-700 text-stone-300">React 19</span>
            <span className="bg-stone-800 px-3 py-1.5 rounded-lg border border-stone-700 text-stone-300">TypeScript</span>
            <span className="bg-stone-800 px-3 py-1.5 rounded-lg border border-stone-700 text-stone-300">Tailwind CSS v4</span>
            <span className="bg-stone-800 px-3 py-1.5 rounded-lg border border-stone-700 text-stone-300">Motion React</span>
          </div>
        </div>
      </div>
    </div>
  );
};
