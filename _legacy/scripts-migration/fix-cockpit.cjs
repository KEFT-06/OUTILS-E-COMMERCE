const fs = require('fs');
const file = 'src/components/strategic/CockpitDashboard.tsx';
let content = fs.readFileSync(file, 'utf8');

if (!content.includes("usePreferences")) {
  content = content.replace("import { MarketAnalysisReport } from '../../types/analysis';", "import { MarketAnalysisReport } from '../../types/analysis';\nimport { usePreferences } from '../../context/PreferencesContext';");
  
  content = content.replace("}) => {\n  // Mock Data", "}) => {\n  const { t } = usePreferences();\n  // Mock Data");
}

content = content.replace(">Cockpit Créateur<", ">{t('Cockpit Créateur', 'Creator Cockpit')}<");
content = content.replace(">Vision consolidée de vos performances et ressources.<", ">{t('Vision consolidée de vos performances et ressources.', 'Consolidated view of your performance and resources.')}<");
content = content.replace(">Système En Ligne<", ">{t('Système En Ligne', 'System Online')}<");

fs.writeFileSync(file, content);
