const fs = require('fs');
const file = 'src/components/strategic/RadarTrendsView.tsx';
let content = fs.readFileSync(file, 'utf8');

const graphInject = `
      {/* 📊 Data Visualization Dashboard - Injected */ }
      {scanResult && !isScanning && scanResult.niches.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-700 mt-6 mb-6">
          
          {/* Chart 1: Explosion Score vs Volume (Scatter Plot / Bubble Chart) */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-4">
              <Target className="w-4 h-4 text-indigo-500" />
              Matrice d'Opportunité (Volume vs Explosion)
            </h3>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: -20 }}>
                  <XAxis 
                    type="number" 
                    dataKey="score" 
                    name="Score Explosion" 
                    domain={[0, 100]} 
                    tick={{ fill: '#64748b', fontSize: 11 }} 
                  />
                  <YAxis 
                    type="number" 
                    dataKey="volume" 
                    name="Volume (K)" 
                    tick={{ fill: '#64748b', fontSize: 11 }} 
                  />
                  <ZAxis type="number" range={[100, 500]} />
                  <RechartsTooltip 
                    cursor={{ strokeDasharray: '3 3' }} 
                    content={({ payload }) => {
                      if (!payload || !payload.length) return null;
                      const data = payload[0].payload;
                      return (
                        <div className="bg-slate-900 text-white p-3 rounded-xl text-xs shadow-xl">
                          <p className="font-bold">{data.name}</p>
                          <p className="text-indigo-300">Score Explosion: {data.score}</p>
                          <p className="text-emerald-300">Volume est.: {data.rawVolume}</p>
                        </div>
                      );
                    }}
                  />
                  <Scatter 
                    data={scanResult.niches.map(n => {
                      const numVol = parseInt(n.searchVolumeEstimated.replace(/[^0-9]/g, ''), 10) || 5000;
                      return {
                        name: n.nicheName,
                        score: n.explosionScore,
                        volume: numVol / 1000,
                        rawVolume: n.searchVolumeEstimated,
                        fill: n.explosionScore > 85 ? '#f59e0b' : (n.explosionScore > 70 ? '#4f46e5' : '#10b981')
                      };
                    })}
                  >
                    {
                      scanResult.niches.map((entry, index) => (
                        <Cell key={\`cell-\${index}\`} fill={entry.explosionScore > 85 ? '#f59e0b' : (entry.explosionScore > 70 ? '#4f46e5' : '#10b981')} />
                      ))
                    }
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 2: Top Niches by Score (Bar Chart) */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-4">
              <BarChart3 className="w-4 h-4 text-emerald-500" />
              Classement des Niches par Score
            </h3>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart 
                  data={scanResult.niches.map(n => ({
                    name: n.nicheName.length > 15 ? n.nicheName.substring(0, 15) + '...' : n.nicheName,
                    score: n.explosionScore,
                    rawName: n.nicheName
                  })).sort((a,b) => b.score - a.score).slice(0, 5)} 
                  layout="vertical"
                  margin={{ top: 5, right: 30, left: 30, bottom: 5 }}
                >
                  <XAxis type="number" domain={[0, 100]} hide />
                  <YAxis type="category" dataKey="name" tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }} axisLine={false} tickLine={false} />
                  <RechartsTooltip 
                    cursor={{fill: 'transparent'}}
                    content={({ payload }) => {
                      if (!payload || !payload.length) return null;
                      const data = payload[0].payload;
                      return (
                        <div className="bg-slate-900 text-white p-3 rounded-xl text-xs shadow-xl">
                          <p className="font-bold">{data.rawName}</p>
                          <p className="text-emerald-400 font-mono">Score : {data.score}/100</p>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="score" radius={[0, 6, 6, 0]} barSize={24}>
                    {
                      scanResult.niches.map((entry, index) => (
                        <Cell key={\`cell-\${index}\`} fill={index === 0 ? '#10b981' : '#4f46e5'} />
                      ))
                    }
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
`;

content = content.replace("{/* Niches Cards Grid */}", graphInject + "\n      {/* Niches Cards Grid */}");

fs.writeFileSync(file, content);
