/**
 * gsc.js — Connexion à Google Search Console
 * ---------------------------------------------------------------
 * Récupère les vraies statistiques de trafic organique (clics,
 * impressions, position moyenne) fournies par Google lui-même.
 * C'est la seule source fiable pour savoir si le SEO fonctionne
 * réellement — plus fiable qu'une estimation.
 *
 * Nécessite un compte de service Google (gratuit) :
 *  1. console.cloud.google.com → créer un projet → activer
 *     "Search Console API"
 *  2. IAM & Admin → Comptes de service → créer une clé JSON
 *  3. Dans Google Search Console → Paramètres → Utilisateurs et
 *     autorisations → ajouter l'email du compte de service comme
 *     utilisateur "Lecture seule" sur la propriété du site
 *  4. Coller le contenu du fichier JSON dans le secret GitHub
 *     GOOGLE_SERVICE_ACCOUNT_JSON
 * ---------------------------------------------------------------
 */

const crypto = require('crypto');

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function getAccessToken(serviceAccount, scope) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: serviceAccount.client_email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  const signature = signer
    .sign(serviceAccount.private_key)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const jwt = `${unsigned}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error('Échec d’authentification Google : ' + JSON.stringify(data));
  }
  return data.access_token;
}

/**
 * Renvoie {clicks, impressions, ctr, position} pour l'avant-veille
 * (Search Console publie les données avec ~48h de délai).
 */
async function getSearchConsoleStats(serviceAccountJsonStr, siteUrl) {
  const serviceAccount = JSON.parse(serviceAccountJsonStr);
  const token = await getAccessToken(serviceAccount, 'https://www.googleapis.com/auth/webmasters.readonly');
  const targetDate = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);

  const res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ startDate: targetDate, endDate: targetDate, dimensions: ['date'] }),
    }
  );
  const data = await res.json();
  const row = data.rows && data.rows[0];
  return {
    date: targetDate,
    clicks: row ? row.clicks : 0,
    impressions: row ? row.impressions : 0,
    ctr: row ? row.ctr : 0,
    position: row ? row.position : null,
  };
}

module.exports = { getSearchConsoleStats };
