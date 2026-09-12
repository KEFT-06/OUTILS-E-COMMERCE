import React, { useState } from 'react';
import { X, Sparkles, Copy, Check, Send } from 'lucide-react';

interface InquiryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPrompt: (promptText: string) => void;
}

export const InquiryModal: React.FC<InquiryModalProps> = ({ isOpen, onClose, onSelectPrompt }) => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  if (!isOpen) return null;

  const presets = [
    {
      title: 'Restaurant, Bar ou Café',
      desc: 'Menu du jour, module de réservation de table en direct, photos de plats et plan d’accès.',
      prompt: 'Je souhaite créer un site web pour mon restaurant. Il me faut une présentation chaleureuse, un menu de saison par catégories (Entrées, Plats, Desserts), un système de réservation de table en direct avec date et heure, et nos horaires d’ouverture.'
    },
    {
      title: 'Portfolio & Freelance',
      desc: 'Grille de réalisations avec filtres, présentation de mes compétences et formulaire de contact direct.',
      prompt: 'Je veux un site portfolio moderne pour présenter mes réalisations. Il doit inclure une galerie filtrable par type de projet, une section À propos avec mes compétences clés et un formulaire pour que les prospects puissent m’écrire facilement.'
    },
    {
      title: 'Boutique en ligne & Artisanat',
      desc: 'Catalogue de produits, panier d’achat interactif avec calcul de sous-total et récapitulatif de commande.',
      prompt: 'Je souhaite une boutique en ligne élégante pour vendre mes créations. J’ai besoin d’une grille de produits avec prix et photos, d’un panier d’achat interactif avec gestion des quantités, et d’une page présentant nos engagements éco-responsables.'
    },
    {
      title: 'Landing Page & Startup / SaaS',
      desc: 'Page de conversion avec sélecteur de formules tarifaires, démonstration des fonctionnalités et FAQ.',
      prompt: 'Peux-tu me créer une landing page high-tech pour mon application ? Elle doit comprendre un titre percutant, 3 fonctionnalités phares illustrées, un comparatif de tarifs mensuel/annuel et une section FAQ interactive.'
    }
  ];

  const handleCopy = (prompt: string, idx: number) => {
    navigator.clipboard.writeText(prompt);
    setCopiedIndex(idx);
    onSelectPrompt(prompt);
    setTimeout(() => setCopiedIndex(null), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl relative border border-stone-200">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-full text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="space-y-1 mb-4">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-amber-500" />
            <span className="text-xs font-semibold uppercase tracking-wider text-stone-500">Prise en main rapide</span>
          </div>
          <h3 className="text-lg font-bold text-stone-900">Quel genre de site souhaitez-vous concevoir ?</h3>
          <p className="text-xs text-stone-500">
            Choisissez l'un des modèles ci-dessous pour copier une demande prête à envoyer dans notre chat :
          </p>
        </div>

        <div className="space-y-3 max-h-[450px] overflow-y-auto pr-1">
          {presets.map((preset, idx) => (
            <div
              key={idx}
              className="p-4 bg-stone-50 hover:bg-stone-100/80 rounded-xl border border-stone-200 transition-all space-y-2"
            >
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-sm text-stone-900">{preset.title}</h4>
                <button
                  onClick={() => handleCopy(preset.prompt, idx)}
                  className="px-3 py-1 bg-white hover:bg-stone-200 text-stone-800 text-xs font-semibold rounded-md border border-stone-200 flex items-center space-x-1 transition-all"
                >
                  {copiedIndex === idx ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedIndex === idx ? 'Copié !' : 'Copier cette idée'}</span>
                </button>
              </div>
              <p className="text-xs text-stone-600 leading-relaxed">{preset.desc}</p>
            </div>
          ))}
        </div>

        <div className="mt-5 pt-3 border-t border-stone-200 flex items-center justify-between text-xs text-stone-500">
          <span>Vous pouvez aussi simplement me décrire votre projet directement !</span>
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 bg-stone-900 text-white rounded-lg text-xs font-medium hover:bg-stone-800"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
