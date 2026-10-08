import 'dotenv/config';
import { z } from 'zod';

/**
 * Valeurs rognées, et une variable vide tenue pour non renseignée.
 *
 * Deux accidents que la configuration ne doit pas transformer en panne :
 *
 * 1. La variable créée avant d'être connue. Chez un hébergeur, on déclare les noms puis
 *    on remplit plus tard ; elles arrivent alors toutes vides. Sans filtre, `PORT=`
 *    devient 0 et `NODE_ENV=` ne vaut aucune valeur attendue : la construction s'arrête
 *    sur une liste d'erreurs qui accuse à tort des variables facultatives.
 *
 * 2. Le retour à la ligne collé avec la valeur. Copier une adresse de connexion depuis
 *    une page ou un message emporte souvent le saut de ligne final ; il se glisse dans le
 *    nom de la base et la connexion échoue sans que rien ne le laisse deviner. Aucun
 *    espace de bordure n'a jamais de sens ici : on les retire tous.
 *
 * Le nettoyage porte sur l'ensemble plutôt que sur chaque champ : appliqué schéma par
 * schéma, il finit toujours par être oublié quelque part.
 */
function cleanedEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(source)
      .map(([name, value]) => [name, value?.trim()] as const)
      .filter(([, value]) => value !== undefined && value !== ''),
  );
}

/**
 * Code de validation d'un moteur de recherche (Google Search Console, Bing Webmaster Tools).
 *
 * Les deux outils donnent à copier une balise entière — « <meta name="google-site-verification"
 * content="…" /> » — ou un enregistrement « google-site-verification=… ». C'est ce que colle
 * naturellement le propriétaire du site : le code en est donc extrait, au lieu d'être refusé.
 */
const verificationCode = z
  .preprocess((value) => {
    if (typeof value !== 'string') return value;
    const fromTag = /content\s*=\s*["']?([A-Za-z0-9_-]+)/i.exec(value)?.[1];
    const fromRecord = /^(?:google-site-verification|msvalidate\.01)\s*[=:]\s*["']?([A-Za-z0-9_-]+)/i.exec(value)?.[1];
    return fromTag ?? fromRecord ?? value;
  }, z.string().regex(/^[A-Za-z0-9_-]{10,100}$/))
  .optional();

/**
 * Les hébergeurs annoncent la production par leur propre variable. Si NODE_ENV a été
 * créée vide, la retirer ferait retomber sur « development » : le serveur relâcherait
 * alors ses garde-fous de production sur un site public.
 */
function hostedEnvironment(source: NodeJS.ProcessEnv): 'production' | undefined {
  return source.VERCEL || source.RENDER ? 'production' : undefined;
}

/**
 * Adresse publique attribuée par l'hébergeur, utilisée quand APP_URL n'est pas renseignée.
 * Render la donne entière ; Vercel donne un domaine nu, et deux variables : celle du
 * domaine de production, stable, et celle du déploiement courant, propre à chaque envoi.
 */
const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || undefined;
const hostedUrl = process.env.RENDER_EXTERNAL_URL || (vercelHost ? `https://${vercelHost}` : undefined);

/**
 * Validation de l'environnement au démarrage.
 *
 * Un serveur qui démarre avec une configuration incomplète échoue plus tard,
 * en production, sur une requête utilisateur. Mieux vaut refuser de démarrer.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  /**
   * Adresse d'écoute. Vide : 127.0.0.1 hors production, pour que seul ce poste
   * joigne l'API — sinon tout appareil du même Wi-Fi pourrait lancer des
   * générations payées avec les clés du serveur. En production : 0.0.0.0, que
   * les hébergeurs exigent.
   */
  HOST: z.string().optional(),
  /**
   * Proxys placés devant le serveur, pour lire la vraie adresse IP du visiteur (limites de
   * débit, journal de sécurité). « 1 » derrière un hébergeur ou un répartiteur de charge ;
   * « 0 » quand le serveur est joint directement, sinon n'importe qui pourrait se forger une
   * adresse avec l'en-tête X-Forwarded-For. Vide : 1 en production, boucle locale sinon.
   */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).optional(),
  APP_URL: z.string().url().default(hostedUrl ?? 'http://localhost:5173'),
  /**
   * Dossier du site construit, quand il n'est pas à côté du serveur construit. Utile en
   * hébergement sans serveur, où le serveur est empaqueté séparément du site.
   */
  CLIENT_DIR: z.string().optional(),

  // Origines CORS autorisées, séparées par des virgules. Vide : l'adresse publique.
  CORS_ORIGINS: z.string().default(process.env.APP_URL || hostedUrl || 'http://localhost:5173')
    .transform((v) =>
      v
        .split(',')
        // Une origine envoyée par le navigateur ne finit jamais par « / ».
        .map((s) => s.trim().replace(/\/+$/, ''))
        .filter(Boolean),
    ),

  // Fournisseurs IA — optionnels : chaque route vérifie la clé dont elle dépend
  // et renvoie 503 avec un message explicite si elle manque.
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_API_URL: z.string().url().default('https://generativelanguage.googleapis.com'),
  /**
   * Direction artistique des couvertures (Anthropic) : elle écrit la scène que le moteur d'images
   * peint. Optionnelle — sans elle, la consigne est composée par le serveur, comme auparavant.
   */
  CLAUDE_API_KEY: z.string().min(1).optional(),
  CLAUDE_API_URL: z.string().url().default('https://api.anthropic.com'),
  CLAUDE_MODEL: z
    .string()
    .regex(/^[\w.-]+$/)
    .default('claude-opus-5-5'),
  /**
   * Modèle Gemini des analyses de niche, des rédactions et des traductions.
   *
   * 3.6 Flash est passé devant 3.5 Flash le 24 septembre 2026 : il est à la fois plus récent
   * et deux fois moins cher sur la grille de Google — 0,75 $ / 3,75 $ le million de jetons,
   * contre 1,50 $ / 9,00 $. L'ordre précédent faisait payer le double pour la génération
   * antérieure, et le secours coûtait moins que le principal qu'il remplaçait.
   */
  GEMINI_MODEL: z.string().regex(/^[\w.-]+$/).default('gemini-3.6-flash'),
  /**
   * Modèle de secours quand le modèle principal est saturé chez Google (réponse 503, « high
   * demand »), après une seconde tentative. « off » : pas de modèle de secours.
   *
   * Le secours est volontairement d'une autre génération : deux modèles de la même famille
   * sont servis par la même flotte, et sont donc saturés en même temps.
   */
  GEMINI_FALLBACK_MODEL: z
    .string()
    .regex(/^[\w.-]+$/)
    .default('gemini-3.5-flash')
    .transform((model) => (model === 'off' ? null : model)),
  /**
   * Dernier recours quand le principal et le secours refusent encore : une autre génération,
   * servie par une autre flotte, aux limites par minute bien plus larges que les versions
   * récentes. « off » : aucun.
   *
   * Figurer dans la liste des modèles ne suffit pas : « gemini-2.5-flash » y était encore le
   * 05/10/2026 et répondait pourtant 404, « no longer available to new users », à chaque appel —
   * le dernier recours faisait donc échouer la rédaction au moment précis où il devait la sauver.
   * Celui-ci a été appelé pour de bon ce jour-là, et a répondu.
   */
  /** Vagues de parties au plus par passage d'un rapport long ; 0 : seul le temps compte. Sert aux tests. */
  REPORT_SLICE_WAVES: z.coerce.number().int().min(0).default(0),
  GEMINI_LAST_RESORT_MODEL: z
    .string()
    .regex(/^[\w.-]+$/)
    .default('gemini-3.1-flash-lite')
    .transform((model) => (model === 'off' ? null : model)),
  /**
   * Étude de marché des analyses de niche : Perplexity cherche et lit le web (Agent API, repli
   * sur l'API Search), Gemini rédige ensuite le rapport sans rien avancer hors des sources citées.
   * La recherche Google intégrée à Gemini n'est pas utilisée : ses conditions interdisent de
   * conserver ou d'exporter les résultats. Sans clé, l'analyse de niche est refusée.
   */
  PERPLEXITY_API_KEY: z.string().min(1).optional(),
  PERPLEXITY_API_URL: z.string().url().default('https://api.perplexity.ai'),
  /**
   * Profondeur de l'étude menée par l'Agent API de Perplexity (préréglages de Perplexity) :
   * « medium » = recherche approfondie (défaut, environ une minute), « high » = la plus complète,
   * « low »/« fast » = plus rapides. « off » : seulement l'API Search (pages brutes, sans étude).
   */
  PERPLEXITY_RESEARCH_PRESET: z.enum(['fast', 'low', 'medium', 'high', 'off']).default('medium'),
  /**
   * Rédaction de l'analyse (fiche structurée) et du rapport, par l'Agent API de Perplexity.
   * « preset:<nom> » laisse Perplexity choisir le modèle (mesuré le 28/09/2026 : « low » ≈ 0,003 $
   * par appel court) ; un identifiant « fournisseur/modèle » l'impose (« perplexity/sonar » est
   * le seul modèle maison accepté par l'Agent API, ≈ 0,0002 $). Google n'intervient plus dans
   * l'analyse : décision du propriétaire du 28/09/2026.
   */
  PERPLEXITY_WRITER: z
    .string()
    .regex(/^(preset:(fast|low|medium|high)|[\w.-]+\/[\w.-]+)$/)
    .default('preset:low'),
  /**
   * Modèle d'image de Gemini (couvertures des guides et des ebooks). Exige la facturation activée
   * sur le projet Google de la clé : l'offre gratuite n'autorise aucune image.
   */
  /**
   * Modèle d'image de Gemini : secours des couvertures, et PREMIER CHOIX des visuels
   * publicitaires (voir `services/ai/image.ts`).
   *
   * « gemini-3-pro-image » (Nano Banana Pro) et non le modèle Flash : comparé le
   * 27 septembre 2026 sur la même consigne, il rend une scène du pays visé reconnaissable
   * là où les autres rendent un intérieur qui pourrait être partout. Il coûte 0,134 $
   * l'image contre 0,067 $ pour le Flash — réservé, pour cette raison, aux images qu'un
   * public verra.
   *
   * Ce modèle écrit du texte et dessine des marques de lui-même dès que la consigne ne le
   * lui interdit pas : les deux lignes de garde de `buildPrompt` ne sont pas décoratives.
   */
  GEMINI_IMAGE_MODEL: z.string().regex(/^[\w.-]+$/).default('gemini-3-pro-image'),
  /**
   * Autres modèles Nano Banana, essayés dans l'ordre quand le principal refuse (débit par minute
   * dépassé, surcharge). Chaque modèle a ses propres limites chez Google : un refus « quota
   * dépassé » sur l'un laisse passer l'autre. Présents dans la liste des modèles de la clé au
   * 29/09/2026. Séparés par des virgules ; « off » : aucun.
   */
  GEMINI_IMAGE_FALLBACK_MODELS: z
    .string()
    .regex(/^(off|[\w.-]+(,[\w.-]+)*)$/)
    .default('gemini-3.1-flash-image,gemini-2.5-flash-image')
    .transform((list) => (list === 'off' ? [] : list.split(','))),
  /**
   * Modèle d'image que Gamma utilise pour illustrer les storybooks.
   *
   * Liste des valeurs acceptées : developers.gamma.app, « Image model accepted values ».
   * Vérifié le 27 septembre 2026 — `gemini-3-pro-image` y figure, et dans le MÊME palier de
   * crédits Gamma (« Premium ») que le modèle Flash qu'il remplace. Meilleur rendu, sans
   * surcoût sur l'abonnement Gamma : c'est ce qui rend l'échange évident.
   *
   * Ne pas prendre `gemini-3-pro-image-hd` : il passe en palier « Ultra », à 120 crédits
   * Gamma par image. Un conte de vingt pages s'y paierait vingt fois.
   */
  GAMMA_IMAGE_MODEL: z.string().regex(/^[\w.-]+$/).default('gemini-3-pro-image'),
  /**
   * Modèles qui dessinent les pages d'un conte À PARTIR DE LA PLANCHE DES PERSONNAGES, essayés
   * dans l'ordre. Ils doivent accepter une image en entrée : c'est elle qui garde le même
   * visage et les mêmes vêtements d'une page à l'autre.
   *
   * Mesuré le 04/10/2026 sur « gemini-3.1-flash-image » : 9 à 13 secondes par page, personnage
   * principal ET personnage secondaire identiques sur toutes les scènes. Le modèle Pro n'est
   * pas pris ici : un conte de vingt pages compte vingt-deux images, et il coûte le double.
   */
  STORYBOOK_IMAGE_MODELS: z
    .string()
    .regex(/^[\w.-]+(,[\w.-]+)*$/)
    .default('gemini-3.1-flash-image,gemini-2.5-flash-image')
    .transform((list) => list.split(',')),
  /**
   * Génération d'images par Cloudflare Workers AI : fournisseur principal, Gemini en secours.
   * Le jeton demande les droits « Workers AI » en lecture ET en écriture
   * (dash.cloudflare.com → Workers AI → Use REST API). Sans ces deux variables, tout repasse
   * par Gemini, une vingtaine de fois plus cher.
   *
   * Deux modèles, aux capacités différentes — mesurées sur l'API, pas déduites de la doc :
   * celui de qualité accepte un format libre (couverture verticale) ; le rapide ne produit que
   * du carré 1024 et REFUSE width/height, mais coûte une vingtaine de fois moins.
   *
   * Le modèle de qualité est FLUX.2 [klein] 9B. Comparé le 24 septembre 2026 sur une même
   * consigne publicitaire en 720×1280, contre Lucid Origin, Phoenix 1.0, FLUX.2 [dev] et
   * FLUX.2 [klein] 4B : meilleure composition, et 0,015 $ l'image contre 0,034 $ pour Lucid
   * Origin qu'il remplace. Le 4B coûte quinze fois moins mais a dessiné un logo de marque sur
   * l'écran d'un ordinateur — inacceptable dans un visuel publicitaire destiné à un client.
   *
   * Attention en changeant cette valeur : la famille FLUX.2 n'accepte QUE le multipart, là où
   * les autres veulent du JSON (voir `encodeRequest`), et Phoenix répond les octets du JPEG au
   * lieu d'un JSON (voir `readImage`). Les deux cas sont gérés, mais ils existent.
   */
  CLOUDFLARE_ACCOUNT_ID: z
    .string()
    .regex(/^[0-9a-f]{32}$/, 'Identifiant de compte Cloudflare attendu : 32 caractères hexadécimaux.')
    .optional(),
  CLOUDFLARE_AI_TOKEN: z.string().min(1).optional(),
  /** Surchargeable pour tester contre un serveur factice. */
  CLOUDFLARE_AI_URL: z.string().url().default('https://api.cloudflare.com/client/v4'),
  CLOUDFLARE_IMAGE_MODEL: z.string().regex(/^@?[\w./-]+$/).default('@cf/black-forest-labs/flux-2-klein-9b'),
  CLOUDFLARE_IMAGE_MODEL_FAST: z.string().regex(/^@?[\w./-]+$/).default('@cf/black-forest-labs/flux-1-schnell'),
  /**
   * Rendu vidéo par fal.ai, payé à l'usage : 0,35 $ les cinq secondes, puis 0,07 $ par seconde,
   * contre un abonnement mensuel chez Higgsfield dont les crédits périmaient chaque mois.
   * Le jeton s'obtient sur fal.ai/dashboard/keys, portée « API » et non « ADMIN ».
   *
   * L'en-tête est « Authorization: Key <clé> », et non « Bearer » : l'erreur donne un 401
   * sans explication.
   */
  FAL_KEY: z.string().min(1).optional(),
  /** File d'attente de fal.ai. Surchargeable pour tester contre un serveur factice. */
  FAL_API_URL: z.string().url().default('https://queue.fal.run'),
  FAL_VIDEO_MODEL: z.string().regex(/^[\w./-]+$/).default('fal-ai/kling-video/v2.5-turbo/pro/text-to-video'),
  /**
   * Rendu vidéo par Veo 3.1, sur la clé Gemini — un seul abonnement pour l'image et la vidéo.
   *
   * « fast » et non le modèle complet : mesuré sur la grille de Google, la variante rapide
   * coûte 0,12 $ la seconde en 1080p contre 0,40 $ pour la complète. Huit secondes reviennent
   * donc à 0,96 $ au lieu de 3,20 $, sur une vidéo facturée douze points (~5 $). La complète
   * ne laisserait qu'une marge de 1,6 — intenable si le prix en points baisse un jour.
   *
   * Les bornes de ce modèle sont mesurées dans `services/veo` : 9:16 et 16:9 seulement,
   * durées 4, 6 ou 8 secondes, et rien d'autre.
   */
  VEO_VIDEO_MODEL: z.string().regex(/^[\w.-]+$/).default('veo-3.1-fast-generate-preview'),
  /**
   * Modèles Veo de secours quand le quota du principal est atteint : chacun a le sien chez Google.
   * « lite » plutôt que le modèle standard, deux fois et demie plus cher à la seconde. Présent
   * dans la liste des modèles de la clé au 29/09/2026. Séparés par des virgules ; « off » : aucun.
   */
  VEO_FALLBACK_MODELS: z
    .string()
    .regex(/^(off|[\w.-]+(,[\w.-]+)*)$/)
    .default('veo-3.1-lite-generate-preview')
    .transform((list) => (list === 'off' ? [] : list.split(','))),
  /** 720p, 1080p ou 4k — mesuré ; « 2160p » est refusé bien qu'il désigne la même chose. */
  VEO_RESOLUTION: z.enum(['720p', '1080p', '4k']).default('1080p'),
  GAMMA_API_KEY: z.string().min(1).optional(),
  /** Surchargeable pour tester contre un serveur factice. */
  GAMMA_API_URL: z.string().url().default('https://public-api.gamma.app'),

  /**
   * E-mails transactionnels (mot de passe oublié, confirmation d'adresse, alertes de
   * sécurité) : Brevo ou Resend. EMAIL_FROM : « Nom <adresse> » d'un domaine vérifié
   * chez le fournisseur. Sans eux, le mot de passe oublié passe par l'administrateur.
   */
  EMAIL_PROVIDER: z.enum(['brevo', 'resend']).optional(),
  EMAIL_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(3).optional(),
  /** Surchargeable pour tester contre un serveur factice. */
  EMAIL_API_URL: z.string().url().optional(),
  /**
   * Paiement en ligne des paliers (Stripe Checkout). STRIPE_API_KEY : clé secrète (sk_test_… en
   * mode test, sk_live_… en réel). STRIPE_WEBHOOK_SECRET : secret de signature du webhook
   * /api/billing/webhook (whsec_…), recommandé pour ne manquer aucun paiement.
   */
  STRIPE_API_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  STRIPE_API_URL: z.string().url().default('https://api.stripe.com'),

  /**
   * Premier administrateur d'une nouvelle installation (hébergeur sans terminal) : créé au
   * démarrage tant qu'aucun administrateur n'existe, avec un lien à usage unique dans le journal
   * du serveur. Sans effet ensuite. Voir server/services/admin/bootstrap.ts.
   */
  ADMIN_BOOTSTRAP_EMAIL: z.string().email().optional(),

  /**
   * SebPay (Mobile Money, Afrique de l'Ouest et centrale) : clés publique et secrète du tableau de bord.
   * Les clés sont limitées aux adresses IP autorisées chez SebPay ; l'administration affiche celle du serveur.
   */
  SEBPAY_PUBLIC_KEY: z.string().min(1).optional(),
  SEBPAY_SECRET_KEY: z.string().min(1).optional(),
  SEBPAY_API_URL: z.string().url().default('https://newapi.sebpay.bj/api/v1'),
  /** Service qui renvoie l'adresse IP publique du serveur (page « État des services ») ; « off » pour ne pas l'interroger. */
  PUBLIC_IP_URL: z.string().default('https://api.ipify.org?format=json'),

  /** Facultatif : boîte de l'équipe, qui reçoit une copie de chaque message de la page Contact et un avis à chaque paiement en ligne. */
  CONTACT_INBOX_EMAIL: z.string().email().optional(),

  /**
   * PostgreSQL (Supabase en production, obligatoire). Absente en développement :
   * base embarquée dans .data/pglite, exclue de Git. `memory://` : base éphémère
   * des tests.
   */
  DATABASE_URL: z.string().optional(),

  /**
   * Facultatif : copie des vidéos Veo dans le stockage de fichiers de Supabase. Google n'en
   * garde une que deux jours ; sans cette clé, une vidéo non téléchargée à temps est perdue.
   * Clé secrète du projet (Project Settings → API Keys → Secret keys, « sb_secret_… »).
   * L'adresse du projet est déduite de DATABASE_URL, sauf si SUPABASE_URL la donne.
   */
  SUPABASE_API_SECRET_KEY: z.string().min(20).optional(),

  /**
   * Facultatif : « Continuer avec Google ». Identifiants d'un client OAuth de type
   * « Application Web » (Google Cloud Console → API et services → Identifiants), avec pour URI
   * de redirection autorisée : <APP_URL>/api/auth/google/callback. Sans eux, le bouton n'apparaît pas.
   */
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(10).optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(10).optional(),
  /** Surchargeables pour tester contre un serveur factice. */
  GOOGLE_OAUTH_AUTH_URL: z.string().url().default('https://accounts.google.com/o/oauth2/v2/auth'),
  GOOGLE_OAUTH_TOKEN_URL: z.string().url().default('https://oauth2.googleapis.com/token'),

  /** Tests seulement (ignoré en production) : faux serveur Shopify à la place de <boutique>.myshopify.com. */
  SHOPIFY_TEST_BASE_URL: z.string().url().optional(),
  SUPABASE_URL: z.string().url().optional(),
  /** Espace de stockage (privé) des vidéos archivées ; créé au premier dépôt. */
  CREATIVES_BUCKET: z.string().regex(/^[a-z0-9-]{3,63}$/).default('creatifs'),

  /**
   * Clé de chiffrement des secrets stockés en base (double authentification, clés
   * API Chariow des utilisateurs) : 64 caractères hexadécimaux, soit 256 bits.
   * Générer avec : openssl rand -hex 32. La perdre rend ces secrets illisibles.
   */
  DATA_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, '64 caractères hexadécimaux attendus (openssl rand -hex 32).').optional(),

  /** Fuseau des statistiques « aujourd'hui, ce mois, cette année » de l'administration. */
  REPORTING_TIMEZONE: z
    .string()
    .refine((zone) => {
      try {
        new Intl.DateTimeFormat('fr-FR', { timeZone: zone });
        return true;
      } catch {
        return false;
      }
    }, 'Fuseau horaire inconnu (exemple : Africa/Abidjan).')
    .default('UTC'),

  /** Paliers d'abonnement : quotas, prix et fonctions ouvertes. */
  PLANS_PATH: z.string().optional(),

  /**
   * Taux de change (base EUR), rafraîchis chaque jour pour afficher les prix dans
   * la devise du pays de chaque utilisateur. Données ouvertes, sans clé ; aucune
   * donnée personnelle n'est envoyée. « off » : taux de repli de
   * server/config/exchange-rates.json uniquement.
   */
  EXCHANGE_RATES_URL: z.union([z.literal('off'), z.string().url()]).default('https://open.er-api.com/v6/latest/EUR'),

  /**
   * Emplacement de la table de règles de conformité.
   *
   * Doit rester un fichier EXTERNE au bundle : le CdC §6.4.1 exige de pouvoir
   * l'éditer sans redéployer. L'inliner dans le build réglerait le problème de
   * chemin mais supprimerait cette propriété — ce serait résoudre un incident
   * en cassant une exigence.
   */
  COMPLIANCE_RULES_PATH: z.string().optional(),

  /** Grille tarifaire des research points (CdC §8). Mêmes contraintes. */
  CREDIT_COSTS_PATH: z.string().optional(),

  /** Fourchettes de prix produits et coûts publicitaires (CdC §2). */
  PRICING_PATH: z.string().optional(),

  /** Paramètres et corpus du vérificateur d'originalité (feuille de route 3.2). */
  ORIGINALITY_PATH: z.string().optional(),

  /** Structures de campagnes Meta et TikTok (feuille de route 5.4). */
  CAMPAIGN_BLUEPRINTS_PATH: z.string().optional(),

  /** Boutons d'appel à l'action et découpages des scripts du kit de lancement (5.1). */
  LAUNCH_KIT_PATH: z.string().optional(),

  /**
   * Clé API Chariow (connecteur marketplace, feuille de route 5.2), créée dans
   * app.chariow.com → Paramètres → Clés API. Serveur uniquement : la
   * documentation Chariow interdit de l'exposer au navigateur.
   */
  CHARIOW_API_KEY: z.string().min(1).optional(),
  /** Surchargeable pour tester le connecteur contre un serveur factice. */
  CHARIOW_API_URL: z.string().url().default('https://api.chariow.com/v1'),

  /**
   * Radar — vitrine publique des boutiques Chariow. Aucune clé : ce service sert le
   * catalogue que la boutique affiche déjà à ses visiteurs
   * (/storefront/{boutique}/products, relevé le 22/09/2026).
   * Ne jamais y envoyer la clé CHARIOW_API_KEY : elle n'y a pas cours et cette adresse
   * est surchargeable, donc potentiellement pointée ailleurs par un test.
   */
  CHARIOW_STOREFRONT_URL: z.string().url().default('https://api-edge.chariow.com'),
  /**
   * Intervalle entre deux balayages d'une même surveillance. Une journée : les ventes
   * et les prix d'une boutique ne bougent pas à l'heure, et un passage plus fréquent
   * pèserait sur le site d'un tiers sans rien apprendre de plus.
   */
  RADAR_SWEEP_INTERVAL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  /**
   * Devise dans laquelle le radar demande les prix à la vitrine. Sans cela, la plateforme répond
   * dans la devise du LIEU D'OÙ PART LA REQUÊTE : depuis un serveur en Irlande, un produit à
   * 1 100 FCFA revenait « 2 EUR » (mesuré en production le 04/10/2026), puis était reconverti à
   * l'écran en 1 312 FCFA. Le franc CFA est la devise de la grande majorité des boutiques suivies.
   */
  RADAR_PRICE_CURRENCY: z.string().regex(/^[A-Z]{3}$/).default('XAF'),

  /**
   * Collecte publicitaire (découverte de boutiques et mur d'espionnage) : jeton Apify, créé sur
   * console.apify.com → Settings → API & Integrations. Sans jeton, la collecte est absente et
   * le reste fonctionne.
   *
   * L'acteur facture AU RÉSULTAT : 5,80 $ les 1 000 publicités sur l'offre gratuite (5 $ offerts
   * par mois, qui BLOQUE au dépassement), 5,00 $ sur l'offre Starter (19 $ par mois, 19 $ d'usage
   * inclus), mesuré le 28/09/2026 sur apify.com.
   *
   * RÉGLAGE PAR DÉFAUT : offre Starter (19 $ inclus), choisie par le propriétaire le 28/09/2026,
   * partagée entre deux usages :
   *   · collecte du mur, une fois par semaine : 2 mots-clés × 200 + 20 annonceurs × 10 = 600
   *     publicités au plus ≈ 2 600 par mois ≈ 13 $ ;
   *   · recherches à la demande (« comme sur Meta ») : 1 200 publicités par mois au plus ≈ 6 $,
   *     soit 24 recherches nouvelles de 50 ; une recherche déjà faite depuis moins de 24 h est
   *     relue gratuitement, pour tous les comptes.
   * Le mur est MUTUALISÉ : sa dépense ne bouge pas avec le nombre d'utilisateurs. Les recherches,
   * elles, sont bornées par le plafond mensuel ci-dessous et par le quota de chaque palier.
   *
   * Sur l'offre gratuite, poser RADAR_DISCOVERY_QUERY=mychariow, RADAR_DISCOVERY_LIMIT=150,
   * SPY_PAGES_MAX=0 et SPY_SEARCH_MONTHLY_ADS=0 : 600 publicités par mois ≈ 3,50 $.
   */
  APIFY_TOKEN: z.string().min(1).optional(),
  APIFY_API_URL: z.string().url().default('https://api.apify.com/v2'),
  /** Acteur maintenu par Apify. Le « ~ » remplace le « / » dans les adresses de l'API. */
  APIFY_ADS_ACTOR: z.string().regex(/^[\w.~-]+$/).default('apify~facebook-ads-scraper'),
  /** Publicités relevées au plus PAR MOT-CLÉ et par passage. Chaque unité est facturée. */
  RADAR_DISCOVERY_LIMIT: z.coerce.number().int().min(10).max(2000).default(200),
  /**
   * Heures entre deux passages. Hebdomadaire : une annonce toujours en vie est RETROUVÉE assez
   * souvent pour que son ancienneté avance et que son état (en cours, arrêtée) reste juste ;
   * l'aperçu, lui, est conservé chez nous et ne dépend plus du rythme.
   */
  RADAR_DISCOVERY_INTERVAL_HOURS: z.coerce.number().int().min(6).max(720).default(168),
  /**
   * Mots-clés cherchés dans la bibliothèque publicitaire, séparés par des virgules.
   * « mychariow » apparaît dans l'adresse de destination de toute boutique Chariow ;
   * « chariow » attrape aussi les annonces qui citent la plateforme dans leur texte.
   */
  RADAR_DISCOVERY_QUERY: z.string().min(2).max(300).default('mychariow,chariow'),
  /**
   * Annonceurs relevés en entier à chaque passage : les plus actifs du mur, page par page. Une
   * recherche par mot-clé ne ramène que les annonces qui le contiennent ; la page d'un annonceur
   * les ramène toutes, y compris celles dont le lien ne dit pas « mychariow ». 0 : désactivé.
   */
  SPY_PAGES_MAX: z.coerce.number().int().min(0).max(200).default(20),
  /** Publicités relevées au plus par annonceur et par passage. */
  SPY_PAGE_ADS_LIMIT: z.coerce.number().int().min(1).max(200).default(10),
  /** Publicités ramenées au plus par recherche nouvelle (facturées). */
  SPY_SEARCH_RESULTS: z.coerce.number().int().min(10).max(500).default(50),
  /**
   * Publicités au plus par mois, toutes recherches nouvelles confondues : la borne de la dépense
   * des recherches, quel que soit le nombre de comptes. 0 : recherche à la demande fermée.
   */
  SPY_SEARCH_MONTHLY_ADS: z.coerce.number().int().min(0).max(1_000_000).default(1_200),
  /** Heures pendant lesquelles une recherche faite est relue gratuitement, par tous les comptes. */
  SPY_SEARCH_CACHE_HOURS: z.coerce.number().int().min(1).max(720).default(24),
  /**
   * Collecteur maison (dossier collecteur/) : pays où il cherche, et annonces lues au plus par
   * mot-clé et par pays. « ALL » relève tous pays confondus ; un pays nommé permet de dire où
   * une annonce est diffusée, ce que la bibliothèque ne publie pas hors d'Europe.
   */
  SPY_COLLECT_COUNTRIES: z
    .string()
    .default('ALL,CM,CI,SN,BJ,TG,BF,ML,CD,GA,CG,FR')
    .transform((value) => [...new Set(value.split(',').map((code) => code.trim().toUpperCase()).filter((code) => /^(ALL|[A-Z]{2})$/.test(code)))]),
  SPY_COLLECT_MAX_PER_QUERY: z.coerce.number().int().min(20).max(5_000).default(600),
  /**
   * Boutiques des autres plateformes (Maketou, Shopify) : mots cherchés par le collecteur, pays
   * où il les cherche, et annonces lues au plus par mot et par pays. Jamais « ALL » : ces mots,
   * tous pays confondus, ramèneraient le monde entier. « off » : aucune recherche de ce genre.
   */
  SPY_COLLECT_EXTRA_QUERIES: z
    .string()
    .default('mymaketou,myshopify')
    .transform((value) => (value.trim() === 'off' ? [] : [...new Set(value.split(',').map((word) => word.trim().toLowerCase()).filter((word) => /^[a-z0-9.-]{3,40}$/.test(word)))])),
  SPY_COLLECT_EXTRA_COUNTRIES: z
    .string()
    .default('CM,CI,SN,BJ,TG,BF,ML,CD,GA,CG')
    .transform((value) => [...new Set(value.split(',').map((code) => code.trim().toUpperCase()).filter((code) => /^[A-Z]{2}$/.test(code)))]),
  SPY_COLLECT_EXTRA_MAX: z.coerce.number().int().min(20).max(2_000).default(150),

  /**
   * Seuils des alertes (services/alerts). Produit gagnant : ventes atteintes dans les premiers
   * jours d'un lancement. Tendance : boutiques différentes lançant un produit proche dans la même
   * fenêtre. Publicité installée : jours de diffusion avant qu'un arrêt mérite une alerte.
   */
  ALERT_WINNER_SALES: z.coerce.number().int().min(1).max(100_000).default(30),
  ALERT_WINNER_DAYS: z.coerce.number().int().min(1).max(30).default(3),
  ALERT_TREND_STORES: z.coerce.number().int().min(2).max(50).default(3),
  ALERT_TREND_HOURS: z.coerce.number().int().min(24).max(720).default(72),
  /*
    Parrainage. La commission est un POURCENTAGE du paiement du filleul, ou un montant FIXE par
    paiement si REFERRAL_COMMISSION_FIXED_FCFA est supérieur à zéro (il l'emporte alors).
  */
  REFERRAL_COMMISSION_PERCENT: z.coerce.number().min(0).max(90).default(20),
  REFERRAL_COMMISSION_FIXED_FCFA: z.coerce.number().int().min(0).max(10_000_000).default(0),
  /** Jours de garde avant qu'une commission soit validée : le temps qu'un remboursement se déclare. */
  REFERRAL_HOLD_DAYS: z.coerce.number().int().min(0).max(180).default(14),
  /** Solde validé à atteindre pour demander un retrait. */
  REFERRAL_MIN_PAYOUT_FCFA: z.coerce.number().int().min(0).max(100_000_000).default(10_000),
  /** Durée de vie du lien suivi : au-delà, une inscription n'est plus rattachée au parrain. */
  REFERRAL_COOKIE_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** Une publicité « installée » : désactivée après avoir tourné entre ces deux durées. */
  ALERT_AD_MIN_DAYS: z.coerce.number().int().min(7).max(720).default(80),
  ALERT_AD_MAX_DAYS: z.coerce.number().int().min(7).max(1_000).default(110),
  /** Ventes dans la journée : premier signal, puis confirmation. */
  ALERT_TRACTION_SALES: z.coerce.number().int().min(1).max(10_000).default(5),
  ALERT_SCALE_SALES: z.coerce.number().int().min(2).max(100_000).default(10),
  /** Scale éclair : au moins tant de ventes aujourd'hui, au plus tant la veille. */
  ALERT_FLASH_SALES: z.coerce.number().int().min(2).max(100_000).default(25),
  ALERT_FLASH_BEFORE: z.coerce.number().int().min(0).max(10_000).default(5),
  /** Chute brutale : au moins tant de ventes la veille, aucune aujourd'hui, publicité active. */
  ALERT_STOCKOUT_BEFORE: z.coerce.number().int().min(1).max(100_000).default(15),

  /**
   * Référence marché : combien de produits numériques existent déjà sur une niche, depuis quand,
   * et à quel prix — mesuré sur Gumroad, la plus grande place de marché de produits numériques.
   *
   * Ce que la sonde du 22/09/2026 a établi sur 25 produits, et qui fixe la conception :
   *   · prix, devise, type, nombre d'avis et DATE DE CRÉATION : renseignés à 100 % ;
   *   · nombre de ventes : renseigné à 28 % seulement (le vendeur peut le masquer) ;
   *   · le rapport ventes/avis va de 8 à 40 — il ne permet donc PAS d'estimer les ventes
   *     d'un produit donné, seulement de les classer entre eux ;
   *   · prix médian 199,99 $, minimum 30 $ — dix à trente fois les prix africains relevés par
   *     le radar (4 000 à 12 000 XAF). Cette source mesure donc la SATURATION d'une niche et
   *     valide un CONCEPT ; elle ne calibre pas un prix pour l'Afrique. Le radar s'en charge.
   *
   * `includeProductDetails` n'est volontairement pas activé : il double le coût pour un champ
   * absent trois fois sur quatre.
   */
  APIFY_GUMROAD_ACTOR: z.string().regex(/^[\w.~-]+$/).default('scrapesage~gumroad-scraper'),
  /** Produits relevés par niche. Facturé à l'unité : 1,10 $ les 1 000. */
  MARKET_BENCHMARK_PRODUCTS: z.coerce.number().int().min(10).max(200).default(40),
  /** Jours de validité d'une mesure. Une niche ne change pas de visage en un mois. */
  MARKET_BENCHMARK_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /**
   * Relevés neufs autorisés par jour, pour tout le serveur. Garde-fou de dépense : 40 produits
   * coûtent 0,044 $, donc 3 par jour ≈ 4 $ par mois — le budget qui reste une fois la découverte
   * passée en mensuel. Au-delà, la lecture du cache continue, seule la collecte attend.
   */
  MARKET_BENCHMARK_DAILY_CAP: z.coerce.number().int().min(0).max(100).default(3),

  /**
   * Secret du déclencheur périodique (`GET /api/cron/radar`).
   *
   * INDISPENSABLE en hébergement sans serveur. Le serveur classique garde un minuteur en
   * mémoire, mais en sans-serveur « rien ne tourne entre deux requêtes » (server/vercel.ts) :
   * sans appel extérieur, le radar ne relèverait JAMAIS, et sa promesse — ne pas dormir —
   * serait fausse. Vercel envoie ce secret en « Authorization: Bearer … » sur ses tâches
   * planifiées ; tout autre planificateur (cron-job.org, Render Cron) fait de même.
   *
   * Vide : la route répond 503 et refuse de travailler. Elle n'est jamais ouverte sans secret,
   * sinon n'importe qui pourrait déclencher des relevés chez des tiers et des dépenses de collecte.
   */
  CRON_SECRET: z.string().min(16).optional(),

  /**
   * Référencement. Codes de validation donnés par les outils pour propriétaires de sites : celui
   * de Google (Search Console → « Balise HTML », la valeur de « content ») et celui de Bing
   * (Webmaster Tools → « Balise meta », la valeur de « content »). Posés sur l'accueil, ils
   * prouvent que le site appartient à celui qui le déclare.
   */
  GOOGLE_SITE_VERIFICATION: verificationCode,
  BING_SITE_VERIFICATION: verificationCode,
  /**
   * Déclaration des pages aux moteurs (IndexNow). L'adresse du service ; « off » : aucune
   * déclaration. La clé est facultative : sans elle, le site en tire une de ses secrets, stable
   * d'une mise en ligne à l'autre, qu'il publie à « /<clé>.txt ».
   */
  INDEXNOW_URL: z.union([z.literal('off'), z.string().url()]).default('https://api.indexnow.org/indexnow'),
  INDEXNOW_KEY: z.string().regex(/^[A-Za-z0-9-]{8,128}$/).optional(),
});

const cleaned = cleanedEnv(process.env);
const submitted: Record<string, unknown> = { NODE_ENV: hostedEnvironment(process.env), ...cleaned };
let parsed = schema.safeParse(submitted);

/**
 * Réglages facultatifs écartés parce que leur valeur n'a pas la forme attendue (noms seuls,
 * jamais les valeurs).
 *
 * Un réglage FACULTATIF mal rempli éteint sa fonction, comme s'il était absent ; il n'empêche
 * plus le site de démarrer. Du 04 au 06/10/2026, une seule valeur mal collée chez l'hébergeur a
 * fait refuser tous les déploiements pendant deux jours sans que personne le voie : la
 * production restait sur une ancienne version, et chaque correction publiée n'arrivait jamais.
 * Un réglage obligatoire, ou doté d'une valeur par défaut, reste refusé : là, une valeur fausse
 * changerait le comportement du site sans qu'on l'ait voulu.
 */
export const ignoredSettings: string[] = [];

if (!parsed.success) {
  const faulty = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
  const optional = faulty.filter((name) => (schema.shape as Record<string, z.ZodTypeAny>)[name] instanceof z.ZodOptional);
  if (optional.length > 0) {
    for (const name of optional) delete submitted[name];
    const retried = schema.safeParse(submitted);
    if (retried.success) {
      ignoredSettings.push(...optional);
      console.warn(`\n⚠️  Réglage(s) facultatif(s) ignoré(s), valeur au mauvais format : ${optional.join(', ')}.`);
      console.warn('   La fonction correspondante reste éteinte jusqu’à correction ; le site démarre normalement.\n');
    }
    parsed = retried.success ? retried : parsed;
  }
}

if (!parsed.success) {
  console.error('\n❌ Configuration d’environnement invalide :\n');
  for (const issue of parsed.error.issues) {
    console.error(`   · ${issue.path.join('.')} — ${issue.message}`);
  }
  console.error('\n   Copiez .env.example vers .env et complétez les valeurs.\n');
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
/** Hébergement sans serveur : rien ne tourne entre deux requêtes, un travail long se relance par une requête. */
export const isServerless = Boolean(process.env.VERCEL);
export const listenHost = env.HOST || (isProd ? '0.0.0.0' : '127.0.0.1');

/** Vrai si la clé du fournisseur est présente. Aucune route ne doit la lire directement. */
export const providers = {
  gemini: Boolean(env.GEMINI_API_KEY),
  claude: Boolean(env.CLAUDE_API_KEY),
  webSearch: Boolean(env.PERPLEXITY_API_KEY),
  email: Boolean(env.EMAIL_PROVIDER && env.EMAIL_API_KEY && env.EMAIL_FROM),
  payments: Boolean(env.STRIPE_API_KEY && !env.STRIPE_API_KEY.trim().startsWith('pk_')),
  cloudflareImages: Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_AI_TOKEN),
  fal: Boolean(env.FAL_KEY),
  gamma: Boolean(env.GAMMA_API_KEY),
  chariow: Boolean(env.CHARIOW_API_KEY),
  apify: Boolean(env.APIFY_TOKEN),
  videoArchive: Boolean(env.SUPABASE_API_SECRET_KEY),
  googleAuth: Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET),
} as const;

/**
 * Garde-fou de démarrage : en production, la base distante et la clé de chiffrement
 * sont obligatoires. Optionnelles en développement pour ne pas bloquer un
 * contributeur ; optionnelles en production, ce serait une faille.
 */
if (isProd) {
  // Sans adresse publique en https, les liens envoyés (paiement, mot de passe) pointeraient ailleurs.
  if (!env.APP_URL.startsWith('https://')) {
    console.warn(`\n⚠️  APP_URL vaut ${env.APP_URL} : indiquez l'adresse publique du site en https (liens de paiement et de mot de passe).\n`);
  }
  const missing = (['DATABASE_URL', 'DATA_ENCRYPTION_KEY'] as const).filter((k) => !env[k]);
  if (missing.length > 0) {
    console.error(`\n❌ En production, ces secrets sont obligatoires : ${missing.join(', ')}`);
    console.error('   Générez-les avec : openssl rand -hex 32\n');
    process.exit(1);
  }
}
