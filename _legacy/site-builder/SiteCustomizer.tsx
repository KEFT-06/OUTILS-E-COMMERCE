import React, { useState } from 'react';
import { CustomSiteConfig, PresetKey, ViewportMode } from '../types';
import { PRESETS } from '../data/presets';
import { LiveCustomWebsite } from './LiveCustomWebsite';
import { generateStandaloneHtml } from '../utils/htmlExporter';
import { 
  Sparkles, Copy, Check, Palette, Layers, SlidersHorizontal, 
  ArrowRight, Eye, Phone, Mail, Download, Code, Maximize2, 
  RefreshCw, CheckCircle2, Edit3, Monitor, Tablet, Smartphone, FileText
} from 'lucide-react';

interface SiteCustomizerProps {
  onCopyPrompt: (promptText: string) => void;
  onToggleFullScreen?: () => void;
  initialConfig?: CustomSiteConfig;
}

export const SiteCustomizer: React.FC<SiteCustomizerProps> = ({ 
  onCopyPrompt,
  onToggleFullScreen,
  initialConfig
}) => {
  const [selectedPreset, setSelectedPreset] = useState<PresetKey>('artisan');
  const [config, setConfig] = useState<CustomSiteConfig>(initialConfig || PRESETS.artisan.config);
  const [customizerTab, setCustomizerTab] = useState<'preview' | 'settings' | 'code'>('preview');
  const [previewViewport, setPreviewViewport] = useState<ViewportMode>('desktop');
  const [isInlineEditMode, setIsInlineEditMode] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [copiedHtml, setCopiedHtml] = useState(false);

  const colors = [
    { id: 'amber', label: 'Ambre Terroir & BTP', bg: 'bg-amber-600', ring: 'ring-amber-500', text: 'text-amber-600' },
    { id: 'indigo', label: 'Indigo Pro & Tech', bg: 'bg-indigo-600', ring: 'ring-indigo-500', text: 'text-indigo-600' },
    { id: 'emerald', label: 'Émeraude Santé & Bio', bg: 'bg-emerald-700', ring: 'ring-emerald-600', text: 'text-emerald-700' },
    { id: 'rose', label: 'Rose Douceur & Mode', bg: 'bg-rose-600', ring: 'ring-rose-500', text: 'text-rose-600' },
    { id: 'slate', label: 'Ardoise Prestige & Luxe', bg: 'bg-slate-900', ring: 'ring-slate-700', text: 'text-slate-900' },
    { id: 'violet', label: 'Violet Studio & Créa', bg: 'bg-violet-600', ring: 'ring-violet-500', text: 'text-violet-600' },
  ];

  const handleSelectPreset = (key: PresetKey) => {
    setSelectedPreset(key);
    setConfig(PRESETS[key].config);
  };

  const toggleSection = (key: keyof CustomSiteConfig['sections']) => {
    setConfig(prev => ({
      ...prev,
      sections: {
        ...prev.sections,
        [key]: !prev.sections[key]
      }
    }));
  };

  const generatePrompt = () => {
    const activeSections = Object.entries(config.sections)
      .filter(([_, active]) => active)
      .map(([sec]) => {
        switch (sec) {
          case 'hero': return 'En-tête captivant avec bouton d’action';
          case 'services': return 'Grille détaillée des prestations';
          case 'gallery': return 'Galerie de photos / réalisations';
          case 'pricing': return 'Tableau de formules ou tarifs';
          case 'testimonials': return 'Avis clients certifiés';
          case 'contact': return 'Formulaire de devis avec coordonnées';
          default: return sec;
        }
      })
      .join(', ');

    return `Bonjour ! Peux-tu concevoir ce site web complet, moderne et interactif pour mon projet :
- Nom : ${config.siteName}
- Domaine d'activité : ${config.category}
- Slogan : ${config.tagline}
- Description : ${config.description}
- Thème couleur : ${config.colorScheme}
- Style visuel : ${config.styleMood}
- Sections requises : ${activeSections}
- Bouton d'action : "${config.ctaText}"
- Contact : Téléphone ${config.phone || 'N/A'}, Email ${config.email || 'N/A'}, Adresse ${config.address || 'N/A'}

Merci de coder une interface soignée, responsive et avec toutes les interactions en direct !`;
  };

  const handleCopyPrompt = () => {
    const prompt = generatePrompt();
    navigator.clipboard.writeText(prompt);
    setCopiedPrompt(true);
    onCopyPrompt(prompt);
    setTimeout(() => setCopiedPrompt(false), 2500);
  };

  const standaloneHtml = generateStandaloneHtml(config);

  const handleCopyHtml = () => {
    navigator.clipboard.writeText(standaloneHtml);
    setCopiedHtml(true);
    setTimeout(() => setCopiedHtml(false), 2500);
  };

  const handleDownloadHtml = () => {
    const blob = new Blob([standaloneHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${config.siteName.toLowerCase().replace(/[^a-z0-9]/g, '-') || 'mon-site'}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const getFrameWidthClass = () => {
    switch (previewViewport) {
      case 'mobile':
        return 'max-w-[390px] shadow-2xl rounded-3xl border-8 border-stone-800 my-4 mx-auto';
      case 'tablet':
        return 'max-w-[768px] shadow-xl rounded-2xl border-4 border-stone-700 my-4 mx-auto';
      case 'desktop':
      default:
        return 'w-full rounded-2xl border border-stone-200 shadow-sm';
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Top Banner & Preset Selector */}
      <div className="bg-white rounded-2xl p-5 sm:p-6 border border-stone-200 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <span className="p-1.5 rounded-lg bg-stone-900 text-white">
                <SlidersHorizontal className="w-4 h-4" />
              </span>
              <h2 className="text-xl font-bold text-stone-900">Générateur Instantané de Site Web</h2>
            </div>
            <p className="text-xs text-stone-500 mt-1">
              Choisissez un secteur d'activité prédéfini ou personnalisez vos textes, couleurs et prestations en temps réel.
            </p>
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setIsInlineEditMode(!isInlineEditMode)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all flex items-center space-x-1.5 ${
                isInlineEditMode 
                  ? 'bg-amber-500 text-white border-amber-500 shadow-xs' 
                  : 'bg-stone-50 text-stone-700 border-stone-200 hover:bg-stone-100'
              }`}
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>{isInlineEditMode ? 'Édition active' : 'Modifier les textes'}</span>
            </button>

            {onToggleFullScreen && (
              <button
                onClick={onToggleFullScreen}
                className="px-3 py-1.5 bg-stone-900 hover:bg-stone-800 text-white text-xs font-semibold rounded-lg transition-colors shadow-xs flex items-center space-x-1.5"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span>Tester en Plein Écran</span>
              </button>
            )}

            <button
              onClick={handleDownloadHtml}
              className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-lg transition-colors shadow-xs flex items-center space-x-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Exporter HTML</span>
            </button>
          </div>
        </div>

        {/* 1-Click Industry Presets */}
        <div className="space-y-2 pt-2 border-t border-stone-100">
          <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wider block">
            Modèles d'activités en 1 clic :
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            {(Object.keys(PRESETS) as PresetKey[]).map((key) => {
              const preset = PRESETS[key];
              const isSelected = selectedPreset === key;
              return (
                <button
                  key={key}
                  id={`preset-${key}`}
                  onClick={() => handleSelectPreset(key)}
                  className={`px-2.5 py-2 rounded-xl text-left border transition-all text-xs flex flex-col justify-between ${
                    isSelected
                      ? 'bg-stone-900 text-white border-stone-900 shadow-xs'
                      : 'bg-stone-50 text-stone-700 border-stone-200 hover:bg-white hover:border-stone-300'
                  }`}
                >
                  <span className="font-semibold truncate">{preset.label.split('&')[0]}</span>
                  <span className={`text-[10px] truncate ${isSelected ? 'text-stone-300' : 'text-stone-400'}`}>
                    {preset.label.split('&')[1] || preset.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Tabs Switcher: Preview vs Settings vs Code */}
      <div className="flex items-center justify-between border-b border-stone-200 pb-2">
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setCustomizerTab('preview')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all ${
              customizerTab === 'preview'
                ? 'bg-stone-900 text-white shadow-xs'
                : 'text-stone-600 hover:bg-stone-100'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Aperçu Live du Site</span>
          </button>

          <button
            onClick={() => setCustomizerTab('settings')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all ${
              customizerTab === 'settings'
                ? 'bg-stone-900 text-white shadow-xs'
                : 'text-stone-600 hover:bg-stone-100'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Paramètres & Contenu</span>
          </button>

          <button
            onClick={() => setCustomizerTab('code')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all ${
              customizerTab === 'code'
                ? 'bg-stone-900 text-white shadow-xs'
                : 'text-stone-600 hover:bg-stone-100'
            }`}
          >
            <Code className="w-3.5 h-3.5" />
            <span>Code Source HTML</span>
          </button>
        </div>

        {/* Viewport controls for preview */}
        {customizerTab === 'preview' && (
          <div className="flex items-center space-x-1 bg-stone-100 p-1 rounded-lg border border-stone-200">
            <button
              onClick={() => setPreviewViewport('desktop')}
              className={`p-1 rounded ${previewViewport === 'desktop' ? 'bg-white shadow-2xs text-stone-900' : 'text-stone-500'}`}
              title="Bureau"
            >
              <Monitor className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setPreviewViewport('tablet')}
              className={`p-1 rounded ${previewViewport === 'tablet' ? 'bg-white shadow-2xs text-stone-900' : 'text-stone-500'}`}
              title="Tablette"
            >
              <Tablet className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setPreviewViewport('mobile')}
              className={`p-1 rounded ${previewViewport === 'mobile' ? 'bg-white shadow-2xs text-stone-900' : 'text-stone-500'}`}
              title="Mobile"
            >
              <Smartphone className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Main Tab Content */}
      {customizerTab === 'preview' && (
        <div className="space-y-4">
          <div className="flex justify-center bg-stone-100/60 p-2 sm:p-4 rounded-2xl border border-stone-200">
            <div className={`w-full transition-all duration-300 overflow-hidden bg-white ${getFrameWidthClass()}`}>
              <LiveCustomWebsite
                config={config}
                onUpdateConfig={setConfig}
                isInlineEditMode={isInlineEditMode}
                onToggleFullScreen={onToggleFullScreen}
              />
            </div>
          </div>
        </div>
      )}

      {customizerTab === 'settings' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 bg-white rounded-2xl p-6 border border-stone-200 shadow-xs">
          {/* Identity & Basic Info (6 cols) */}
          <div className="lg:col-span-6 space-y-4">
            <h3 className="font-bold text-sm text-stone-900 border-b pb-2">Identité & Textes Principaux</h3>
            
            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">Nom de l'Entreprise</label>
              <input
                type="text"
                value={config.siteName}
                onChange={(e) => setConfig({ ...config, siteName: e.target.value })}
                className="w-full px-3 py-2 text-xs sm:text-sm border border-stone-300 rounded-lg outline-hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">Catégorie / Secteur</label>
              <input
                type="text"
                value={config.category}
                onChange={(e) => setConfig({ ...config, category: e.target.value })}
                className="w-full px-3 py-2 text-xs sm:text-sm border border-stone-300 rounded-lg outline-hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">Slogan Accrocheur</label>
              <input
                type="text"
                value={config.tagline}
                onChange={(e) => setConfig({ ...config, tagline: e.target.value })}
                className="w-full px-3 py-2 text-xs sm:text-sm border border-stone-300 rounded-lg outline-hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">Description Présentation</label>
              <textarea
                rows={3}
                value={config.description}
                onChange={(e) => setConfig({ ...config, description: e.target.value })}
                className="w-full px-3 py-2 text-xs sm:text-sm border border-stone-300 rounded-lg outline-hidden"
              />
            </div>

            {/* Contact Details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">Téléphone</label>
                <input
                  type="text"
                  value={config.phone || ''}
                  onChange={(e) => setConfig({ ...config, phone: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg outline-hidden"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">Email</label>
                <input
                  type="email"
                  value={config.email || ''}
                  onChange={(e) => setConfig({ ...config, email: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg outline-hidden"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">Adresse ou Ville d'intervention</label>
              <input
                type="text"
                value={config.address || ''}
                onChange={(e) => setConfig({ ...config, address: e.target.value })}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg outline-hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">Texte du Bouton d'Action (CTA)</label>
              <input
                type="text"
                value={config.ctaText}
                onChange={(e) => setConfig({ ...config, ctaText: e.target.value })}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg outline-hidden"
              />
            </div>
          </div>

          {/* Design, Theme & Sections (6 cols) */}
          <div className="lg:col-span-6 space-y-6">
            <div>
              <h3 className="font-bold text-sm text-stone-900 border-b pb-2 mb-3">Palette & Ambiance</h3>
              <div className="grid grid-cols-2 gap-2">
                {colors.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setConfig({ ...config, colorScheme: c.id as any })}
                    className={`p-2.5 rounded-xl border flex items-center space-x-2 text-left transition-all ${
                      config.colorScheme === c.id
                        ? 'border-stone-900 ring-2 ring-stone-900 bg-stone-50'
                        : 'border-stone-200 hover:bg-stone-50'
                    }`}
                  >
                    <div className={`w-4 h-4 rounded-full ${c.bg} shrink-0`} />
                    <span className="text-xs font-medium text-stone-800 truncate">{c.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Sections Toggle */}
            <div>
              <h3 className="font-bold text-sm text-stone-900 border-b pb-2 mb-3">Sections à afficher</h3>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { key: 'hero', label: 'Bannière Héro' },
                  { key: 'services', label: 'Services & Prestations' },
                  { key: 'gallery', label: 'Galerie & Réalisations' },
                  { key: 'pricing', label: 'Tarifs & Formules' },
                  { key: 'testimonials', label: 'Avis Clients Vérifiés' },
                  { key: 'contact', label: 'Formulaire de Contact' },
                ].map(({ key, label }) => {
                  const active = config.sections[key as keyof CustomSiteConfig['sections']];
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggleSection(key as any)}
                      className={`p-2.5 rounded-xl border flex items-center justify-between text-xs transition-all ${
                        active
                          ? 'bg-stone-900 text-white border-stone-900'
                          : 'bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100'
                      }`}
                    >
                      <span className="font-medium">{label}</span>
                      {active ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Preview Button */}
            <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 space-y-2">
              <span className="text-xs font-semibold text-stone-900">Visualisation immédiate</span>
              <p className="text-[11px] text-stone-500">
                Toutes vos modifications sont immédiatement appliquées au site en temps réel.
              </p>
              <button
                onClick={() => setCustomizerTab('preview')}
                className="w-full py-2 bg-stone-900 text-white text-xs font-semibold rounded-lg hover:bg-stone-800 transition-colors"
              >
                Voir le résultat dans l'onglet Aperçu
              </button>
            </div>
          </div>
        </div>
      )}

      {customizerTab === 'code' && (
        <div className="bg-white rounded-2xl p-6 border border-stone-200 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-sm text-stone-900 flex items-center space-x-2">
                <Code className="w-4 h-4 text-emerald-600" />
                <span>Code HTML Standalone Prêt au Déploiement</span>
              </h3>
              <p className="text-xs text-stone-500 mt-0.5">
                Un fichier HTML 100% autonome avec Tailwind CSS et responsive design. Vous pouvez le copier ou le télécharger pour l'héberger immédiatement.
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={handleCopyHtml}
                className="px-3.5 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-semibold rounded-lg transition-colors flex items-center space-x-1.5"
              >
                {copiedHtml ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedHtml ? 'Copié !' : 'Copier le code HTML'}</span>
              </button>
              <button
                onClick={handleDownloadHtml}
                className="px-3.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-lg transition-colors flex items-center space-x-1.5 shadow-2xs"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Télécharger index.html</span>
              </button>
            </div>
          </div>

          <div className="relative">
            <pre className="bg-stone-900 text-stone-200 p-4 rounded-xl text-xs font-mono max-h-96 overflow-y-auto overflow-x-auto leading-relaxed border border-stone-800">
              <code>{standaloneHtml}</code>
            </pre>
          </div>
        </div>
      )}

      {/* Bottom Brief Card */}
      <div className="p-4 bg-stone-900 text-white rounded-2xl border border-stone-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
        <div className="space-y-0.5">
          <span className="text-xs font-bold text-amber-300 flex items-center space-x-1.5">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Vous voulez ce site codé pour vous ?</span>
          </span>
          <p className="text-xs text-stone-300">
            Dites-moi simplement votre secteur ou cliquez sur « Copier le brief » pour me transmettre ces consignes exactes !
          </p>
        </div>
        <button
          onClick={handleCopyPrompt}
          className="px-4 py-2 bg-white text-stone-950 font-bold text-xs rounded-xl hover:bg-stone-100 transition-all flex items-center space-x-1.5 shrink-0 shadow-xs"
        >
          {copiedPrompt ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
          <span>{copiedPrompt ? 'Brief Copié !' : 'Copier mon brief'}</span>
        </button>
      </div>

    </div>
  );
};
