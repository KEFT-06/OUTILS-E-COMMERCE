const fs = require('fs');
const file = 'src/components/navigation/BottomLeftModuleMenu.tsx';
let content = fs.readFileSync(file, 'utf8');

if (!content.includes("usePreferences")) {
  content = content.replace("import { StrategicTab } from '../strategic/NexusHeader';", "import { StrategicTab } from '../strategic/NexusHeader';\nimport { usePreferences } from '../../context/PreferencesContext';");
}

content = content.replace(/const MODULES_CONFIG: ModuleItem\[\] = \[([\s\S]*?)\];/, `const getModulesConfig = (t: any): ModuleItem[] => [$1];`);

content = content.replace("title: 'Cockpit Créateur',", "title: t('Cockpit Créateur', 'Creator Cockpit'),");
content = content.replace("description: 'Tableau de bord, performances réelles & solde IA',", "description: t('Tableau de bord, performances réelles & solde IA', 'Dashboard, real performance & AI balance'),");

content = content.replace("title: 'Radar des Tendances',", "title: t('Radar des Tendances', 'Trend Radar'),");
content = content.replace("description: 'Détection en temps réel des niches explosives',", "description: t('Détection en temps réel des niches explosives', 'Real-time detection of explosive niches'),");

content = content.replace("title: 'Veille & Intelligence',", "title: t('Veille & Intelligence', 'Intelligence & Watch'),");
content = content.replace("shortName: 'Veille',", "shortName: t('Veille', 'Watch'),");
content = content.replace("description: 'Analyse complète de la niche et de la concurrence',", "description: t('Analyse complète de la niche et de la concurrence', 'Complete niche and competition analysis'),");

content = content.replace("title: 'Générateur de Produits',", "title: t('Générateur de Produits', 'Product Generator'),");
content = content.replace("shortName: 'Produits',", "shortName: t('Produits', 'Products'),");
content = content.replace("description: 'Conception d\\'E-books, Templates et Outils',", "description: t('Conception d\\'E-books, Templates et Outils', 'Design E-books, Templates, and Tools'),");

content = content.replace("title: 'Meta Video Studio',", "title: t('Meta Video Studio', 'Meta Video Studio'),");
content = content.replace("shortName: 'Studio Ads',", "shortName: t('Studio Ads', 'Ads Studio'),");
content = content.replace("description: 'Scripts et frameworks (AIDA, PAS) pour Ads',", "description: t('Scripts et frameworks (AIDA, PAS) pour Ads', 'Scripts and frameworks (AIDA, PAS) for Ads'),");

content = content.replace("title: 'Dossier HD PDF',", "title: t('Dossier HD PDF', 'HD PDF Report'),");
content = content.replace("shortName: 'Export PDF',", "shortName: t('Export PDF', 'PDF Export'),");
content = content.replace("description: 'Rapport stratégique prêt à télécharger',", "description: t('Rapport stratégique prêt à télécharger', 'Strategic report ready for download'),");

content = content.replace("export const BottomLeftModuleMenu: React.FC<BottomLeftModuleMenuProps> = ({", "export const BottomLeftModuleMenu: React.FC<BottomLeftModuleMenuProps> = ({\n  activeTab,\n  setActiveTab,\n  currentNicheName,\n}) => {\n  const { t } = usePreferences();\n  const MODULES_CONFIG = getModulesConfig(t);");

content = content.replace("  activeTab,\n  setActiveTab,\n  currentNicheName,\n}) => {\n  const { t } = usePreferences();\n  const MODULES_CONFIG = getModulesConfig(t);\n  activeTab,\n  setActiveTab,\n  currentNicheName,\n}) => {", "export const BottomLeftModuleMenu: React.FC<BottomLeftModuleMenuProps> = ({\n  activeTab,\n  setActiveTab,\n  currentNicheName,\n}) => {\n  const { t } = usePreferences();\n  const MODULES_CONFIG = getModulesConfig(t);");


fs.writeFileSync(file, content);
