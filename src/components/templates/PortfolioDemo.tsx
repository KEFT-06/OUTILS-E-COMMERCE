import React, { useState } from 'react';
import { PORTFOLIO_PROJECTS } from '../../data/templates';
import { Camera, Eye, ArrowUpRight, Check, Send, X, Sparkles } from 'lucide-react';

export const PortfolioDemo: React.FC = () => {
  const [activeFilter, setActiveFilter] = useState<string>('Tous');
  const [selectedProject, setSelectedProject] = useState<typeof PORTFOLIO_PROJECTS[0] | null>(null);
  const [contactSent, setContactSent] = useState(false);
  const [contactForm, setContactForm] = useState({ name: '', email: '', message: '' });

  const filteredProjects = activeFilter === 'Tous'
    ? PORTFOLIO_PROJECTS
    : PORTFOLIO_PROJECTS.filter(p => p.category === activeFilter);

  const handleContactSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setContactSent(true);
    setTimeout(() => {
      setContactSent(false);
      setContactForm({ name: '', email: '', message: '' });
    }, 3500);
  };

  return (
    <div className="bg-stone-900 text-stone-100 font-sans min-h-full">
      {/* Top bar */}
      <header className="border-b border-stone-800 bg-stone-950/70 backdrop-blur sticky top-0 z-10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-full bg-white text-stone-950 flex items-center justify-center font-bold text-xs">
            SL
          </div>
          <span className="font-semibold text-base tracking-tight text-white">Studio Lumina</span>
        </div>
        <div className="hidden sm:flex items-center space-x-6 text-xs text-stone-400">
          <a href="#projets" className="hover:text-white transition-colors">Projets</a>
          <a href="#expertise" className="hover:text-white transition-colors">Expertise</a>
          <a href="#contact" className="hover:text-white transition-colors">Contact</a>
        </div>
        <a
          href="#contact"
          className="px-3.5 py-1.5 bg-stone-100 hover:bg-white text-stone-900 text-xs font-semibold rounded-full transition-all"
        >
          Me contacter
        </a>
      </header>

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 pt-16 pb-12 text-center space-y-4">
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-stone-800 text-stone-300 text-xs border border-stone-700">
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>Direction Artistique • Photographie • Web Design</span>
        </div>
        <h1 className="text-3xl sm:text-5xl font-light text-stone-100 tracking-tight leading-tight">
          Façonner des expériences visuelles <span className="italic font-serif text-stone-300">mémorables</span>.
        </h1>
        <p className="text-stone-400 text-xs sm:text-sm max-w-xl mx-auto leading-relaxed">
          Accompagnement de marques indépendantes et d'entreprises innovantes dans la création d'identités fortes, de récits photographiques et d'interfaces intuitives.
        </p>
      </section>

      {/* Metrics */}
      <div className="max-w-4xl mx-auto px-6 pb-12 grid grid-cols-2 sm:grid-cols-4 gap-4 border-b border-stone-800">
        <div className="p-4 bg-stone-950/60 rounded-xl border border-stone-800/80 text-center">
          <span className="block text-2xl font-bold text-white">120+</span>
          <span className="text-[11px] text-stone-400">Projets Livrés</span>
        </div>
        <div className="p-4 bg-stone-950/60 rounded-xl border border-stone-800/80 text-center">
          <span className="block text-2xl font-bold text-white">8</span>
          <span className="text-[11px] text-stone-400">Distinctions Design</span>
        </div>
        <div className="p-4 bg-stone-950/60 rounded-xl border border-stone-800/80 text-center">
          <span className="block text-2xl font-bold text-white">100%</span>
          <span className="text-[11px] text-stone-400">Clients Satisfaits</span>
        </div>
        <div className="p-4 bg-stone-950/60 rounded-xl border border-stone-800/80 text-center">
          <span className="block text-2xl font-bold text-white">7 Ans</span>
          <span className="text-[11px] text-stone-400">D'expérience</span>
        </div>
      </div>

      {/* Project Filter & Gallery */}
      <section id="projets" className="max-w-5xl mx-auto px-6 py-12">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <h2 className="text-xl font-medium text-white tracking-tight">Sélection de Projets</h2>
          <div className="flex space-x-1 bg-stone-800/80 p-1 rounded-lg border border-stone-700">
            {['Tous', 'Branding', 'Photographie', 'Web Design'].map((filter) => (
              <button
                key={filter}
                onClick={() => setActiveFilter(filter)}
                className={`px-3 py-1 text-xs rounded-md font-medium transition-all ${
                  activeFilter === filter
                    ? 'bg-stone-100 text-stone-900 shadow-xs'
                    : 'text-stone-400 hover:text-white'
                }`}
              >
                {filter}
              </button>
            ))}
          </div>
        </div>

        {/* Projects Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredProjects.map((project) => (
            <div
              key={project.id}
              onClick={() => setSelectedProject(project)}
              className="group cursor-pointer bg-stone-950 rounded-xl overflow-hidden border border-stone-800 hover:border-stone-600 transition-all"
            >
              <div className="relative aspect-4/3 overflow-hidden bg-stone-800">
                <img
                  src={project.image}
                  alt={project.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <span className="px-3 py-1.5 bg-white text-stone-900 text-xs font-semibold rounded-full flex items-center space-x-1 shadow-lg">
                    <Eye className="w-3.5 h-3.5" />
                    <span>Explorer</span>
                  </span>
                </div>
              </div>
              <div className="p-4 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white group-hover:text-amber-300 transition-colors">
                    {project.title}
                  </h3>
                  <p className="text-xs text-stone-500">{project.category} • {project.year}</p>
                </div>
                <ArrowUpRight className="w-4 h-4 text-stone-500 group-hover:text-white group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Project Modal Preview */}
      {selectedProject && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-stone-900 border border-stone-700 rounded-2xl max-w-2xl w-full overflow-hidden shadow-2xl relative">
            <button
              onClick={() => setSelectedProject(null)}
              className="absolute top-4 right-4 z-10 p-2 bg-stone-950/80 rounded-full text-stone-300 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="aspect-16/9 bg-stone-950 overflow-hidden">
              <img
                src={selectedProject.image}
                alt={selectedProject.title}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-widest text-amber-400 font-semibold">{selectedProject.category}</span>
                <span className="text-xs text-stone-400">Année : {selectedProject.year}</span>
              </div>
              <h3 className="text-xl font-bold text-white">{selectedProject.title}</h3>
              <p className="text-sm text-stone-300 leading-relaxed">{selectedProject.desc}</p>
              <div className="pt-2 border-t border-stone-800 flex justify-between items-center text-xs text-stone-400">
                <span>Rôle : Conception, Direction Artistique</span>
                <button
                  onClick={() => setSelectedProject(null)}
                  className="px-4 py-2 bg-stone-100 text-stone-950 font-medium rounded-lg hover:bg-white"
                >
                  Fermer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Contact Section */}
      <section id="contact" className="max-w-2xl mx-auto px-6 py-16 text-center border-t border-stone-800">
        <h2 className="text-2xl font-bold text-white mb-2">Un projet en tête ?</h2>
        <p className="text-xs sm:text-sm text-stone-400 mb-6">Parlons de votre prochaine réalisation ou de votre refonte visuelle.</p>

        {contactSent ? (
          <div className="p-6 bg-emerald-950/50 border border-emerald-800 rounded-xl text-emerald-200 text-center space-y-2">
            <Check className="w-8 h-8 text-emerald-400 mx-auto" />
            <p className="font-semibold text-sm">Message envoyé avec succès !</p>
            <p className="text-xs text-emerald-300">Nous vous répondrons sous 24 heures ouvrées.</p>
          </div>
        ) : (
          <form onSubmit={handleContactSubmit} className="space-y-3 text-left">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-stone-400 mb-1">Votre Nom</label>
                <input
                  type="text"
                  required
                  placeholder="Claire V."
                  value={contactForm.name}
                  onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                  className="w-full px-3 py-2 bg-stone-950 border border-stone-700 rounded-lg text-xs text-white placeholder-stone-600 focus:border-amber-400 outline-hidden"
                />
              </div>
              <div>
                <label className="block text-xs text-stone-400 mb-1">Votre Email</label>
                <input
                  type="email"
                  required
                  placeholder="claire@domaine.com"
                  value={contactForm.email}
                  onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                  className="w-full px-3 py-2 bg-stone-950 border border-stone-700 rounded-lg text-xs text-white placeholder-stone-600 focus:border-amber-400 outline-hidden"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-stone-400 mb-1">Votre Message ou Idée</label>
              <textarea
                rows={3}
                required
                placeholder="Je souhaite refaire l'identité visuelle et le site de mon atelier..."
                value={contactForm.message}
                onChange={(e) => setContactForm({ ...contactForm, message: e.target.value })}
                className="w-full px-3 py-2 bg-stone-950 border border-stone-700 rounded-lg text-xs text-white placeholder-stone-600 focus:border-amber-400 outline-hidden"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2.5 bg-stone-100 hover:bg-white text-stone-950 font-semibold text-xs rounded-lg flex items-center justify-center space-x-2 transition-all"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Envoyer ma demande</span>
            </button>
          </form>
        )}
      </section>

      {/* Footer */}
      <footer className="py-6 text-center text-xs text-stone-600 border-t border-stone-800">
        © 2026 Studio Lumina. Tous droits réservés.
      </footer>
    </div>
  );
};
