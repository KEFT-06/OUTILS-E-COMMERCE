import assert from 'node:assert/strict';
import { exec } from 'node:child_process';
import { describe, it } from 'node:test';
import { promisify } from 'node:util';

const run = promisify(exec);

/**
 * Lecture de la configuration au démarrage.
 *
 * `server/env.ts` valide pendant son chargement et coupe le processus si la configuration
 * ne tient pas : ces cas se vérifient donc dans un processus séparé, dont on lit le code
 * de sortie et la sortie standard.
 */

const PROBE = 'server/tests/support/print-env.ts';

/** Environnement minimal : le .env du poste ne doit pas souffler les réponses. */
function baseEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    // dotenv chargerait sinon le .env réel et masquerait ce qu'on teste.
    DOTENV_CONFIG_PATH: 'server/tests/support/inexistant.env',
    ...extra,
  };
}

async function readEnv(extra: Record<string, string>) {
  const { stdout } = await run(`npx tsx ${PROBE}`, { env: baseEnv(extra), cwd: process.cwd() });
  return JSON.parse(stdout.trim().split('\n').at(-1)!);
}

describe('Configuration au démarrage', () => {
  it('traite une variable vide comme absente, et non comme une valeur fautive', async () => {
    /*
      Le cas exact d'un hébergeur où les variables sont créées avant d'être renseignées :
      elles existent toutes, toutes vides. Chacune de celles-ci faisait échouer la
      construction — « PORT must be greater than 0 », « GEMINI_API_URL Invalid url »… —
      en accusant des variables pourtant facultatives.
    */
    const result = await readEnv({
      NODE_ENV: '',
      PORT: '',
      GEMINI_API_KEY: '',
      GEMINI_API_URL: '',
      HIGGSFIELD_API_KEY_ID: '',
      HIGGSFIELD_API_KEY_SECRET: '',
      HIGGSFIELD_API_URL: '',
      CHARIOW_API_KEY: '',
      CHARIOW_API_URL: '',
      DATABASE_URL: '',
      REPORTING_TIMEZONE: '   ',
    });

    assert.equal(result.port, 3001, 'PORT vide retombe sur sa valeur par défaut');
    assert.equal(result.geminiApiUrl, 'https://generativelanguage.googleapis.com');
    assert.equal(result.reportingTimezone, 'UTC', 'une valeur faite d’espaces vaut absente');
    assert.equal(result.geminiApiKey, null, 'une clé vide n’est pas une clé');
    assert.equal(result.higgsfieldId, null);
    assert.equal(result.databaseUrl, null);
  });

  it('se tient pour la production chez un hébergeur, même si NODE_ENV a été créée vide', async () => {
    /*
      Sans cela, retirer un NODE_ENV vide ferait retomber sur « development » : le serveur
      relâcherait ses garde-fous de production sur un site public.
    */
    // En production, les deux secrets sont exigés : sans eux le processus sort avant d'imprimer.
    const hosted = await readEnv({
      NODE_ENV: '',
      VERCEL: '1',
      APP_URL: 'https://exemple.test',
      DATABASE_URL: 'postgresql://exemple',
      DATA_ENCRYPTION_KEY: 'a'.repeat(64),
    });
    assert.equal(hosted.nodeEnv, 'production');
    assert.equal(hosted.isProd, true);

    const local = await readEnv({ NODE_ENV: '' });
    assert.equal(local.nodeEnv, 'development', 'hors hébergeur, le défaut reste le développement');
  });

  it('laisse une valeur explicite l’emporter sur le défaut de l’hébergeur', async () => {
    const result = await readEnv({ NODE_ENV: 'test', VERCEL: '1' });
    assert.equal(result.nodeEnv, 'test');
  });

  it('refuse toujours de démarrer sur une valeur renseignée mais invalide', async () => {
    await assert.rejects(
      () => readEnv({ PORT: 'abc' }),
      (error: { code?: number; stderr?: string }) => {
        assert.equal(error.code, 1, 'le processus sort en échec');
        assert.match(error.stderr ?? '', /PORT/, 'et nomme la variable fautive');
        return true;
      },
    );
  });
});
