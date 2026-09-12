import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { z } from 'zod';

/**
 * Vérificateur de conformité publicitaire — module 6.4.1 du cahier des charges.
 *
 * Différenciateur n°2. Deux règles structurent ce service :
 *
 *  1. Il a un DROIT DE VETO. Aucun contenu ne s'exporte sans son verdict.
 *     Ce n'est pas une étape du pipeline, c'en est la sortie.
 *  2. Sa base de règles vit dans une table de configuration éditable SANS
 *     déploiement de code. Le cahier des charges qualifie ce point de
 *     « non négociable » : les politiques Meta et TikTok changent plusieurs
 *     fois par an, et un redéploiement par changement de politique est ingérable.
 */

const ruleSchema = z.object({
  id: z.string(),
  category: z.string(),
  severity: z.enum(['block', 'warn']),
  description: z.string(),
  patterns: z.array(z.string()).min(1),
  action: z.string(),
  rewriteHint: z.string(),
});

const configSchema = z.object({
  version: z.string(),
  updatedAt: z.string(),
  note: z.string().optional(),
  rules: z.array(ruleSchema).min(1),
  requiredDisclaimer: z.string(),
});

export type ComplianceRule = z.infer<typeof ruleSchema>;
export type ComplianceConfig = z.infer<typeof configSchema>;

export interface ComplianceFinding {
  ruleId: string;
  category: string;
  severity: 'block' | 'warn';
  /** Extrait exact du texte qui a déclenché la règle — l'utilisateur doit voir quoi corriger. */
  matched: string;
  /** Position dans le texte soumis, pour surligner côté client. */
  offset: number;
  action: string;
  rewriteHint: string;
}

export interface ComplianceVerdict {
  /** false ⇒ export interdit. Le client ne doit proposer aucun contournement. */
  exportAllowed: boolean;
  rulesVersion: string;
  checkedAt: string;
  findings: ComplianceFinding[];
  requiredDisclaimer: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(here, '..', '..', 'config', 'compliance-rules.json');

let cache: { config: ComplianceConfig; compiled: Map<string, RegExp[]> } | null = null;

/**
 * Charge et compile la table de règles. Le cache est vidé par `reloadRules()`,
 * ce qui permettra à l'administrateur de recharger sans redémarrer le serveur.
 */
async function getConfig() {
  if (cache) return cache;

  const raw = await readFile(CONFIG_PATH, 'utf8');
  const config = configSchema.parse(JSON.parse(raw));

  const compiled = new Map<string, RegExp[]>();
  for (const rule of config.rules) {
    compiled.set(
      rule.id,
      rule.patterns.map((p) => new RegExp(p, 'giu')),
    );
  }

  cache = { config, compiled };
  return cache;
}

export function reloadRules(): void {
  cache = null;
}

/**
 * Analyse un contenu textuel et rend un verdict.
 *
 * Volontairement déterministe : des expressions régulières auditables, pas un
 * appel LLM. Un vérificateur de conformité dont on ne peut pas expliquer la
 * décision n'est pas défendable devant un utilisateur dont la publicité est
 * bloquée. Un second passage LLM pourra affiner les cas ambigus (Lot 2), mais
 * jamais lever un blocage décidé ici.
 */
export async function checkText(text: string): Promise<ComplianceVerdict> {
  const { config, compiled } = await getConfig();
  const findings: ComplianceFinding[] = [];

  for (const rule of config.rules) {
    for (const regex of compiled.get(rule.id) ?? []) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        findings.push({
          ruleId: rule.id,
          category: rule.category,
          severity: rule.severity,
          matched: match[0],
          offset: match.index,
          action: rule.action,
          rewriteHint: rule.rewriteHint,
        });
        // Garde-fou contre les motifs de longueur nulle.
        if (match.index === regex.lastIndex) regex.lastIndex += 1;
      }
    }
  }

  findings.sort((a, b) => a.offset - b.offset);

  return {
    exportAllowed: !findings.some((f) => f.severity === 'block'),
    rulesVersion: config.version,
    checkedAt: new Date().toISOString(),
    findings,
    requiredDisclaimer: config.requiredDisclaimer,
  };
}

/** Métadonnées de la table active, pour affichage dans le back-office. */
export async function getRulesMetadata() {
  const { config } = await getConfig();
  return {
    version: config.version,
    updatedAt: config.updatedAt,
    ruleCount: config.rules.length,
    categories: [...new Set(config.rules.map((r) => r.category))],
  };
}
