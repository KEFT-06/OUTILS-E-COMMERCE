import { CustomSiteConfig } from '../types';

export function generateStandaloneHtml(config: CustomSiteConfig): string {
  const primaryColor = config.colorScheme === 'emerald' ? '#047857'
    : config.colorScheme === 'amber' ? '#d97706'
    : config.colorScheme === 'rose' ? '#e11d48'
    : config.colorScheme === 'slate' ? '#1e293b'
    : config.colorScheme === 'violet' ? '#7c3aed'
    : '#4f46e5';

  return `<!DOCTYPE html>
<html lang="fr" class="scroll-smooth">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${config.siteName} — ${config.tagline}</title>
  <meta name="description" content="${config.description}">
  <!-- Tailwind CSS CDN -->
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            brand: '${primaryColor}',
          }
        }
      }
    }
  </script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Plus Jakarta Sans', sans-serif; }
  </style>
</head>
<body class="bg-stone-50 text-stone-800 antialiased selection:bg-stone-200">

  <!-- Top Info Bar -->
  <div class="bg-stone-900 text-stone-200 text-xs py-2 px-4">
    <div class="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center space-x-4">
        ${config.phone ? `<span>📞 ${config.phone}</span>` : ''}
        ${config.email ? `<span>✉️ ${config.email}</span>` : ''}
      </div>
      <div class="flex items-center space-x-2">
        <span class="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
        <span>Disponible pour vos projets</span>
      </div>
    </div>
  </div>

  <!-- Header Navigation -->
  <header class="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-stone-200 shadow-sm">
    <div class="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
      <a href="#" class="flex items-center space-x-2.5">
        <div class="w-9 h-9 rounded-xl bg-[${primaryColor}] text-white flex items-center justify-center font-bold text-base shadow-sm">
          ${config.siteName.charAt(0)}
        </div>
        <span class="font-bold text-lg text-stone-900 tracking-tight">${config.siteName}</span>
      </a>

      <nav class="hidden md:flex items-center space-x-6 text-sm font-medium text-stone-600">
        ${config.sections.services ? '<a href="#services" class="hover:text-stone-900 transition-colors">Services</a>' : ''}
        ${config.sections.gallery ? '<a href="#galerie" class="hover:text-stone-900 transition-colors">Réalisations</a>' : ''}
        ${config.sections.pricing ? '<a href="#tarifs" class="hover:text-stone-900 transition-colors">Tarifs</a>' : ''}
        ${config.sections.testimonials ? '<a href="#avis" class="hover:text-stone-900 transition-colors">Avis</a>' : ''}
        ${config.sections.contact ? '<a href="#contact" class="hover:text-stone-900 transition-colors">Contact</a>' : ''}
      </nav>

      <a href="#contact" class="px-4 py-2 bg-[${primaryColor}] text-white text-xs sm:text-sm font-semibold rounded-lg shadow-sm hover:opacity-90 transition-all">
        ${config.ctaText}
      </a>
    </div>
  </header>

  <!-- Hero Section -->
  ${config.sections.hero ? `
  <section class="relative py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-stone-100/80 to-stone-50 border-b border-stone-200">
    <div class="max-w-4xl mx-auto text-center space-y-6">
      <span class="inline-block uppercase tracking-wider text-xs font-semibold px-3 py-1 rounded-full bg-stone-200 text-stone-700">
        ${config.category}
      </span>
      <h1 class="text-3xl sm:text-5xl font-extrabold text-stone-950 tracking-tight leading-tight">
        ${config.tagline}
      </h1>
      <p class="text-stone-600 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed">
        ${config.description}
      </p>
      <div class="pt-4 flex flex-wrap justify-center gap-3">
        <a href="#contact" class="px-6 py-3 bg-[${primaryColor}] text-white font-semibold text-sm rounded-xl shadow-md hover:opacity-90 transition-all">
          ${config.ctaText}
        </a>
        <a href="#services" class="px-6 py-3 bg-white text-stone-800 font-medium text-sm rounded-xl border border-stone-300 hover:bg-stone-50 transition-all">
          Découvrir nos prestations
        </a>
      </div>
    </div>
  </section>` : ''}

  <!-- Services Section -->
  ${config.sections.services && config.servicesList?.length > 0 ? `
  <section id="services" class="py-16 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto">
    <div class="text-center max-w-2xl mx-auto mb-12 space-y-2">
      <h2 class="text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight">Nos Prestations & Savoir-Faire</h2>
      <p class="text-stone-500 text-sm">Des solutions adaptées avec un engagement d'excellence.</p>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      ${config.servicesList.map(s => `
        <div class="bg-white p-6 rounded-2xl border border-stone-200 shadow-sm hover:shadow-md transition-shadow space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="font-bold text-lg text-stone-900">${s.title}</h3>
            ${s.price ? `<span class="px-2.5 py-1 text-xs font-semibold rounded-md bg-stone-100 text-stone-800">${s.price}</span>` : ''}
          </div>
          <p class="text-stone-600 text-sm leading-relaxed">${s.description}</p>
          ${s.duration ? `<div class="text-xs text-stone-400">⏱️ Délai estimé : ${s.duration}</div>` : ''}
        </div>
      `).join('')}
    </div>
  </section>` : ''}

  <!-- Gallery Section -->
  ${config.sections.gallery && config.galleryList?.length > 0 ? `
  <section id="galerie" class="py-16 bg-white border-y border-stone-200">
    <div class="max-w-6xl mx-auto px-4 sm:px-6">
      <div class="text-center max-w-2xl mx-auto mb-12 space-y-2">
        <h2 class="text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight">Galerie & Réalisations</h2>
        <p class="text-stone-500 text-sm">Quelques exemples de nos projets récents.</p>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
        ${config.galleryList.map(g => `
          <div class="group rounded-2xl overflow-hidden border border-stone-200 shadow-sm bg-stone-100">
            <div class="aspect-4/3 overflow-hidden">
              <img src="${g.imageUrl}" alt="${g.title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300">
            </div>
            <div class="p-4">
              <span class="text-[11px] font-semibold uppercase tracking-wider text-stone-400">${g.category}</span>
              <h4 class="font-bold text-stone-900 text-sm mt-0.5">${g.title}</h4>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  </section>` : ''}

  <!-- Testimonials Section -->
  ${config.sections.testimonials && config.testimonialsList?.length > 0 ? `
  <section id="avis" class="py-16 px-4 sm:px-6 max-w-5xl mx-auto">
    <div class="text-center max-w-2xl mx-auto mb-12 space-y-2">
      <h2 class="text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight">Ce que disent nos clients</h2>
      <p class="text-stone-500 text-sm">La confiance et la satisfaction de nos partenaires.</p>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      ${config.testimonialsList.map(t => `
        <div class="bg-white p-6 rounded-2xl border border-stone-200 shadow-sm space-y-3">
          <div class="text-amber-400 text-sm">★★★★★</div>
          <p class="text-stone-700 text-sm italic leading-relaxed">« ${t.comment} »</p>
          <div class="pt-2 border-t border-stone-100">
            <span class="font-bold text-xs text-stone-900 block">${t.author}</span>
            <span class="text-[11px] text-stone-500">${t.role}</span>
          </div>
        </div>
      `).join('')}
    </div>
  </section>` : ''}

  <!-- Pricing Section -->
  ${config.sections.pricing && config.pricingList?.length > 0 ? `
  <section id="tarifs" class="py-16 bg-stone-100/70 border-y border-stone-200">
    <div class="max-w-6xl mx-auto px-4 sm:px-6">
      <div class="text-center max-w-2xl mx-auto mb-12 space-y-2">
        <h2 class="text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight">Nos Formules & Tarifs</h2>
        <p class="text-stone-500 text-sm">Une tarification claire et sans mauvaise surprise.</p>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        ${config.pricingList.map(p => `
          <div class="bg-white p-6 rounded-2xl border ${p.highlight ? 'border-stone-900 shadow-md ring-2 ring-stone-900' : 'border-stone-200 shadow-sm'} flex flex-col justify-between">
            <div class="space-y-4">
              <div>
                <h3 class="font-bold text-lg text-stone-900">${p.name}</h3>
                <p class="text-xs text-stone-500 mt-1">${p.description}</p>
              </div>
              <div class="text-2xl sm:text-3xl font-black text-stone-950">
                ${p.price} <span class="text-xs font-normal text-stone-500">${p.period}</span>
              </div>
              <ul class="space-y-2 text-xs text-stone-600 pt-2 border-t border-stone-100">
                ${p.features.map(f => `<li class="flex items-center space-x-2"><span>✓</span><span>${f}</span></li>`).join('')}
              </ul>
            </div>
            <a href="#contact" class="mt-6 w-full text-center py-2.5 px-4 rounded-xl text-xs font-semibold ${p.highlight ? `bg-[${primaryColor}] text-white` : 'bg-stone-100 text-stone-800 hover:bg-stone-200'} transition-all">
              Choisir cette formule
            </a>
          </div>
        `).join('')}
      </div>
    </div>
  </section>` : ''}

  <!-- Contact Section -->
  ${config.sections.contact ? `
  <section id="contact" class="py-16 px-4 sm:px-6 max-w-4xl mx-auto">
    <div class="bg-white rounded-3xl border border-stone-200 p-8 sm:p-12 shadow-sm">
      <div class="max-w-xl mx-auto text-center space-y-3 mb-8">
        <h2 class="text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight">Contactez-nous</h2>
        <p class="text-stone-500 text-sm">Une question ou une demande de devis ? Réponse garantie sous 24 heures.</p>
      </div>
      <form onsubmit="event.preventDefault(); alert('Merci pour votre message ! Nous vous recontacterons très rapidement.');" class="space-y-4 max-w-lg mx-auto">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-medium text-stone-700 mb-1">Votre Nom</label>
            <input type="text" required placeholder="Jean Dupont" class="w-full px-3 py-2 text-sm border border-stone-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-stone-900">
          </div>
          <div>
            <label class="block text-xs font-medium text-stone-700 mb-1">Votre Email</label>
            <input type="email" required placeholder="jean@exemple.fr" class="w-full px-3 py-2 text-sm border border-stone-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-stone-900">
          </div>
        </div>
        <div>
          <label class="block text-xs font-medium text-stone-700 mb-1">Téléphone</label>
          <input type="tel" placeholder="06 12 34 56 78" class="w-full px-3 py-2 text-sm border border-stone-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-stone-900">
        </div>
        <div>
          <label class="block text-xs font-medium text-stone-700 mb-1">Votre Projet / Message</label>
          <textarea rows="4" required placeholder="Décrivez brièvement vos attentes ou la date souhaitée..." class="w-full px-3 py-2 text-sm border border-stone-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-stone-900"></textarea>
        </div>
        <button type="submit" class="w-full py-3 bg-[${primaryColor}] text-white font-semibold text-sm rounded-xl shadow-md hover:opacity-95 transition-all">
          Envoyer ma demande
        </button>
      </form>
    </div>
  </section>` : ''}

  <!-- Footer -->
  <footer class="bg-stone-900 text-stone-400 py-12 px-4 sm:px-6 border-t border-stone-800 text-xs">
    <div class="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
      <div class="space-y-1 text-center md:text-left">
        <span class="font-bold text-sm text-white">${config.siteName}</span>
        <p class="text-stone-400">${config.tagline}</p>
        ${config.address ? `<p class="text-stone-500">${config.address}</p>` : ''}
      </div>
      <div class="text-center md:text-right space-y-1">
        <p>© ${new Date().getFullYear()} ${config.siteName}. Tous droits réservés.</p>
        <p class="text-stone-500">Site moderne optimisé pour mobile & référencement.</p>
      </div>
    </div>
  </footer>

</body>
</html>`;
}
