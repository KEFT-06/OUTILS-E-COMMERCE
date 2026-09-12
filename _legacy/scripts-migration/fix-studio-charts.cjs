const fs = require('fs');
const file = 'src/components/strategic/MetaVideoStudioView.tsx';
let content = fs.readFileSync(file, 'utf8');

if (!content.includes('import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Cell, ScatterChart, Scatter, ZAxis } from "recharts";') && !content.includes('import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Cell, ScatterChart, Scatter, ZAxis } from \'recharts\';')) {
  content = content.replace("import { motion, AnimatePresence } from 'motion/react';", "import { motion, AnimatePresence } from 'motion/react';\nimport { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Cell, ScatterChart, Scatter, ZAxis, AreaChart, Area, CartesianGrid } from 'recharts';\nimport { usePreferences } from '../../context/PreferencesContext';");
  
  content = content.replace("}) => {\n  const [selectedCampaign, setSelectedCampaign] = useState<MetaAdCampaign>(campaigns[0] || null);", "}) => {\n  const { t } = usePreferences();\n  const [selectedCampaign, setSelectedCampaign] = useState<MetaAdCampaign>(campaigns[0] || null);");

  // On injecte un Area Chart pour le hook retention rate simulé
  const graphInject = `
      {/* 📊 Data Visualization Dashboard - Injected for Meta Ads */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Chart 1: Simulated Retention Curve (Area Chart) */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-4">
            <Flame className="w-4 h-4 text-rose-500" />
            {t("Courbe de Rétention Estimée (Hook 3s)", "Estimated Retention Curve (3s Hook)")}
          </h3>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={[
                  { second: 0, retention: 100 },
                  { second: 1, retention: 92 },
                  { second: 2, retention: 85 },
                  { second: 3, retention: 70 }, // Hook drop
                  { second: 6, retention: 65 },
                  { second: 10, retention: 58 },
                  { second: 15, retention: 45 },
                  { second: selectedCampaign?.durationSeconds || 18, retention: 35 },
                ]}
                margin={{ top: 10, right: 30, left: -20, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="colorRetention" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="second" tickFormatter={(v) => \`\${v}s\`} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <YAxis tickFormatter={(v) => \`\${v}%\`} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <RechartsTooltip 
                  content={({ payload }) => {
                    if (!payload || !payload.length) return null;
                    const data = payload[0].payload;
                    return (
                      <div className="bg-slate-900 text-white p-3 rounded-xl text-xs shadow-xl">
                        <p className="font-bold text-slate-300">À la seconde {data.second}</p>
                        <p className="text-rose-400 font-mono text-lg">{data.retention}% d'audience restante</p>
                      </div>
                    );
                  }}
                />
                <Area type="monotone" dataKey="retention" stroke="#f43f5e" strokeWidth={3} fillOpacity={1} fill="url(#colorRetention)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: Time Allocation per Phase (Bar Chart) */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-indigo-500" />
            {t("Allocation du Temps par Phase", "Time Allocation per Phase")}
          </h3>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={selectedCampaign?.scenes.map(s => {
                  const times = s.timing.split(' - ').map(t => parseInt(t.split(':')[1]));
                  return {
                    phase: s.phase,
                    duration: times[1] - times[0],
                  };
                }) || []}
                margin={{ top: 10, right: 30, left: -20, bottom: 25 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="phase" tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }} angle={-20} textAnchor="end" />
                <YAxis tickFormatter={(v) => \`\${v}s\`} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <RechartsTooltip 
                  cursor={{fill: '#f8fafc'}}
                  content={({ payload }) => {
                    if (!payload || !payload.length) return null;
                    const data = payload[0].payload;
                    return (
                      <div className="bg-slate-900 text-white p-3 rounded-xl text-xs shadow-xl">
                        <p className="font-bold">{data.phase}</p>
                        <p className="text-indigo-400 font-mono">Durée : {data.duration} secondes</p>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="duration" radius={[6, 6, 0, 0]}>
                  {
                    (selectedCampaign?.scenes || []).map((entry, index) => (
                      <Cell key={\`cell-\${index}\`} fill={index === 0 ? '#f59e0b' : index === 3 ? '#10b981' : '#4f46e5'} />
                    ))
                  }
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
`;

  content = content.replace("{/* MAIN CONTENT SPLIT */}", graphInject + "\n      {/* MAIN CONTENT SPLIT */}");
  
  fs.writeFileSync(file, content);
}
