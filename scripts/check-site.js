/**
 * check-site.js
 * ---------------------------------------------------------------
 * Contrôle quotidien autonome de l'état du site Easy Booking.
 * Ce script NE MODIFIE JAMAIS le site. Il se contente de :
 *   1. Tester que les pages clés répondent correctement
 *   2. Mesurer les temps de réponse
 *   3. Vérifier le certificat HTTPS et les en-têtes de sécurité de base
 *   4. Demander à Claude de résumer ces résultats en un rapport lisible
 *   5. Déposer ce rapport dans la messagerie de l'espace administrateur
 *      du site (conversation spéciale "system-alerts"), pour que
 *      l'administrateur le voie directement dans son tableau de bord.
 *
 * Toute correction reste manuelle et validée par un humain — volontairement.
 * ---------------------------------------------------------------
 */

const SITE_URL = process.env.SITE_URL || 'https://easybookingg.netlify.app';
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const GSC_SITE_URL = process.env.GSC_SITE_URL || SITE_URL + '/';

const { getSearchConsoleStats } = require('./lib/gsc.js');

const PAGES_TO_CHECK = [
  { label: 'Page d’accueil', url: SITE_URL },
  { label: 'Sitemap', url: `${SITE_URL}/sitemap.xml` },
  { label: 'Robots.txt', url: `${SITE_URL}/robots.txt` },
];

async function checkPage(page) {
  const start = Date.now();
  try {
    const res = await fetch(page.url, { redirect: 'follow' });
    const durationMs = Date.now() - start;
    return {
      label: page.label,
      url: page.url,
      ok: res.ok,
      status: res.status,
      durationMs,
      https: page.url.startsWith('https://'),
      hstsHeader: res.headers.get('strict-transport-security') || null,
    };
  } catch (err) {
    return {
      label: page.label,
      url: page.url,
      ok: false,
      status: null,
      durationMs: Date.now() - start,
      error: err.message,
    };
  }
}

async function summarizeWithClaude(results, gscStats) {
  if (!ANTHROPIC_API_KEY) {
    return "⚠️ Rapport brut (résumé IA indisponible, ANTHROPIC_API_KEY manquante) :\n" + JSON.stringify({ results, gscStats }, null, 2);
  }
  const trafficBlock = gscStats
    ? `\nStatistiques de trafic réelles (Google Search Console, ${gscStats.date}) :\n${JSON.stringify(gscStats, null, 2)}`
    : '\nStatistiques de trafic : non disponibles (Search Console non connecté).';

  const prompt = `Tu es l'agent de surveillance technique et SEO du site Easy Booking. Voici les résultats bruts d'un contrôle automatique du jour au format JSON :
${JSON.stringify(results, null, 2)}
${trafficBlock}

Rédige un rapport court en français (10 lignes maximum), destiné à l'administrateur du site, qui :
- indique clairement si le site technique va bien ou s'il y a un problème
- signale les pages lentes (plus de 2000 ms) ou en erreur
- signale l'absence de HTTPS ou d'en-tête HSTS si c'est le cas
- si les statistiques de trafic sont disponibles, donne le nombre de clics et d'impressions, et indique si la tendance est positive, stable ou en baisse par rapport à ce qu'on attend d'un site en croissance progressive (pas de comparaison inventée si aucune donnée historique n'est fournie)
- termine par UNE recommandation concrète et réaliste, sans jamais promettre un volume de trafic
Ne fais aucune supposition non vérifiée par les données ci-dessus.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!response.ok) throw new Error(`Erreur API Anthropic : ${response.status}`);
  const data = await response.json();
  return data.content.map(b => b.text || '').join('').trim();
}

async function postReportToDashboard(reportText, hasIssue) {
  if (!FIREBASE_PROJECT_ID || !FIREBASE_API_KEY) {
    console.log('Firebase non configuré — rapport affiché ici uniquement :\n', reportText);
    return;
  }
  const base = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
  const ts = Date.now();
  const prefix = hasIssue ? '🔴 ' : '🟢 ';

  // Ajoute le message dans la conversation "system-alerts"
  await fetch(`${base}/chats/system-alerts/messages?key=${FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        sender: { stringValue: 'system' },
        text: { stringValue: prefix + reportText },
        ts: { integerValue: String(ts) },
      },
    }),
  });

  // Met à jour le résumé de la conversation pour l'affichage dans la liste
  await fetch(`${base}/chats/system-alerts?key=${FIREBASE_API_KEY}&updateMask.fieldPaths=lastMessage&updateMask.fieldPaths=lastTs&updateMask.fieldPaths=convId`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        lastMessage: { stringValue: prefix + reportText.slice(0, 80) },
        lastTs: { integerValue: String(ts) },
        convId: { stringValue: 'system-alerts' },
      },
    }),
  });
  console.log('Rapport déposé dans le tableau de bord administrateur.');
}

async function main() {
  console.log(`Contrôle du site — ${new Date().toISOString()}`);
  const results = [];
  for (const page of PAGES_TO_CHECK) {
    const result = await checkPage(page);
    results.push(result);
    console.log(`${result.ok ? 'OK ' : 'ÉCHEC'} — ${result.label} (${result.status ?? 'erreur'}, ${result.durationMs}ms)`);
  }

  const hasIssue = results.some(r => !r.ok || r.durationMs > 2000 || (r.https && !r.hstsHeader));

  let gscStats = null;
  if (GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      gscStats = await getSearchConsoleStats(GOOGLE_SERVICE_ACCOUNT_JSON, GSC_SITE_URL);
      console.log(`Search Console (${gscStats.date}) — clics: ${gscStats.clicks}, impressions: ${gscStats.impressions}, position moyenne: ${gscStats.position ? gscStats.position.toFixed(1) : 'n/a'}`);
    } catch (err) {
      console.warn('Statistiques Search Console indisponibles :', err.message);
    }
  }

  const report = await summarizeWithClaude(results, gscStats);
  console.log('\n--- Rapport ---\n' + report);

  await postReportToDashboard(report, hasIssue);

  if (hasIssue) {
    console.log('\n⚠️ Un problème a été détecté. Aucune correction automatique n’a été appliquée — vérification manuelle nécessaire.');
  }
}

main().catch(err => {
  console.error('Échec du contrôle du site :', err);
  process.exit(1);
});
