/**
 * generate-article.js
 * ---------------------------------------------------------------
 * Ce script est l'"agent de contenu" réel d'Easy Booking.
 * Il tourne chaque jour via GitHub Actions (voir publish-daily.yml),
 * PAS dans le navigateur d'un visiteur — c'est ce qui le rend
 * réellement autonome, même quand personne n'ouvre le site.
 *
 * Ce qu'il fait à chaque exécution :
 *  1. Choisit une ville/angle (rotation programmée, pas aléatoire)
 *  2. Demande à Claude de rédiger un article optimisé SEO
 *  3. Écrit l'article en HTML dans /posts/
 *  4. Met à jour sitemap.xml pour que Google découvre la nouvelle page
 *
 * Prérequis :
 *  - Un vrai hébergement qui sert le contenu du dossier /posts (ex: GitHub
 *    Pages, Netlify, Vercel) relié à ce même dépôt Git
 *  - Une clé API Anthropic valide, stockée dans les "Secrets" du dépôt
 *    GitHub sous le nom ANTHROPIC_API_KEY (jamais en clair dans le code)
 *  - Un compte Google Search Console avec le domaine vérifié, pour que
 *    l'indexation soit rapide (voir README.md)
 *
 * ⚠️ Ce script rédige et publie du contenu chaque jour. Il n'apporte
 * AUCUNE garantie de volume de trafic — voir README.md pour une
 * explication honnête de ce que ça change réellement.
 * ---------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

const SITE_URL = 'https://easybookingg.netlify.app'; // ⚠️ à remplacer par ton domaine définitif une fois choisi
const POSTS_DIR = path.join(__dirname, '..', 'posts');
const SITEMAP_PATH = path.join(__dirname, '..', 'sitemap.xml');
const POSTS_INDEX_PATH = path.join(POSTS_DIR, 'posts-index.json');
const INDEXNOW_KEY = process.env.INDEXNOW_KEY || '97904166754bebfd411a8db678468e9d';

function loadPostsIndex() {
  try { return JSON.parse(fs.readFileSync(POSTS_INDEX_PATH, 'utf8')); }
  catch (e) { return []; }
}
function savePostsIndex(index) {
  fs.mkdirSync(POSTS_DIR, { recursive: true });
  fs.writeFileSync(POSTS_INDEX_PATH, JSON.stringify(index, null, 2), 'utf8');
}

/**
 * Maillage interne automatique : construit un bloc HTML de liens vers
 * 1) la page d'accueil (annonces de la ville concernée)
 * 2) jusqu'à 2 articles précédents sur la même ville
 * Ceci aide Google à comprendre la structure du site et fait circuler
 * l'autorité entre les pages — un vrai levier SEO, sans backend complexe.
 */
function buildInternalLinks(city, index) {
  const related = index.filter(p => p.city === city).slice(0, 2);
  let html = `<h2>Pour aller plus loin</h2><ul>`;
  html += `<li><a href="${SITE_URL}/index.html#annonces">Voir les appartements disponibles à ${city}</a></li>`;
  related.forEach(p => {
    html += `<li><a href="${SITE_URL}/posts/${p.slug}.html">${p.title}</a></li>`;
  });
  html += `</ul>`;
  return html;
}

// Rotation simple : un pays différent chaque jour de la semaine.
// Remplace/complète cette liste par ta propre stratégie éditoriale.
const ROTATION = [
  { city: 'Singapour',    angle: 'quartier ou style de vie pour expatriés' },
  { city: 'Shanghai',     angle: 'comparatif de quartiers pour familles ou jeunes actifs' },
  { city: 'New York',     angle: 'budget réaliste pour un séjour meublé' },
  { city: 'Finlande',     angle: 'vie quotidienne et hiver à Helsinki' },
  { city: 'Royaume-Uni',  angle: 'démarches administratives pour un locataire étranger' },
  { city: 'Malte',        angle: 'vivre à Malte : climat, coût de la vie, quartiers' },
  { city: 'Dubaï',        angle: 's\'installer à Dubaï en tant qu\'expatrié' },
  { city: 'Luxembourg',   angle: 'travailler et se loger au Luxembourg' },
  { city: 'Madrid',       angle: 'se loger près des universités à Madrid' },
  { city: 'Barcelone',    angle: 'quartiers étudiants et vie locale à Barcelone' },
  { city: 'Milan',        angle: 'coût de la vie et logement étudiant à Milan' },
  { city: 'Rome',         angle: 'vivre en colocation à Rome' },
  { city: 'Singapour',    angle: 'transports et mobilité au quotidien' },
  { city: 'Shanghai',     angle: 'coût de la vie comparé à l’Europe' },
];

function pickToday() {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now - startOfYear) / 86400000); // jour de l'année (1-365/366)
  return ROTATION[dayOfYear % ROTATION.length];
}

async function callClaude(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY manquante dans les secrets GitHub.');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    throw new Error(`Erreur API Anthropic : ${response.status} ${await response.text()}`);
  }
  const data = await response.json();
  return data.content.map(b => b.text || '').join('').trim();
}

function slugify(str) {
  return str.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function main() {
  const { city, angle } = pickToday();
  const today = new Date().toISOString().slice(0, 10);

  const prompt = `Tu es le rédacteur SEO senior d'Easy Booking, agence de location d'appartements meublés à Singapour, Shanghai, New York, en Finlande, au Royaume-Uni, à Malte, à Dubaï, au Luxembourg, en Espagne (Madrid, Barcelone) et en Italie (Milan, Rome).
Rédige un article de blog en français sur le thème "${angle}" pour la ville : ${city}.
Contraintes SEO : un titre H1 précis et naturel (pas de clickbait), une meta description de 150-160 caractères, 500 à 700 mots, sous-titres H2 pertinents, ton informatif et concret, aucune promesse chiffrée non vérifiable.
Mentionne la règle de caution d'Easy Booking si pertinent : 1 mois de loyer pour un séjour de 1 à 3 mois, 2 mois au-delà, intégralement remboursable.
Réponds UNIQUEMENT en JSON valide, sans markdown ni texte autour :
{"title":"...", "metaDescription":"...", "html":"...(le corps de l'article en HTML propre avec <h2> et <p>, sans <html> ni <body>)"}`;

  console.log(`Génération de l'article du ${today} — ${city} / ${angle}`);
  const raw = await callClaude(prompt);
  const cleaned = raw.replace(/```json|```/g, '').trim();
  const article = JSON.parse(cleaned);

  const slug = `${today}-${slugify(city)}-${slugify(angle)}`;
  const filePath = path.join(POSTS_DIR, `${slug}.html`);
  const postsIndex = loadPostsIndex();
  const internalLinksHtml = buildInternalLinks(city, postsIndex);

  const pageHtml = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${article.title} — Easy Booking</title>
<meta name="description" content="${article.metaDescription}">
<link rel="canonical" href="${SITE_URL}/posts/${slug}.html">
<meta name="robots" content="index, follow">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "headline": ${JSON.stringify(article.title)},
  "datePublished": "${today}",
  "author": {"@type": "Organization", "name": "Easy Booking"}
}
</script>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@600&family=Inter&display=swap" rel="stylesheet">
<style>
  body{font-family:Inter,sans-serif;max-width:720px;margin:0 auto;padding:40px 20px;color:#232323;line-height:1.7;}
  h1{font-family:Fraunces,serif;font-size:32px;}
  h2{font-family:Fraunces,serif;font-size:22px;margin-top:32px;}
  a.back{display:inline-block;margin-bottom:24px;color:#3A6B65;text-decoration:none;font-size:14px;}
</style>
</head>
<body>
  <a class="back" href="../index.html">← Retour à Easy Booking</a>
  <h1>${article.title}</h1>
  ${article.html}
  ${internalLinksHtml}
</body>
</html>`;

  fs.mkdirSync(POSTS_DIR, { recursive: true });
  fs.writeFileSync(filePath, pageHtml, 'utf8');
  console.log(`Article écrit : posts/${slug}.html`);

  postsIndex.unshift({ slug, title: article.title, city, date: today });
  savePostsIndex(postsIndex);
  console.log('Index des articles (maillage interne) mis à jour.');

  const newUrl = `${SITE_URL}/posts/${slug}.html`;
  updateSitemap(newUrl);
  console.log('Sitemap mis à jour.');

  await pingSearchEngines(newUrl);
}

/**
 * Notifie les moteurs de recherche qu'une nouvelle page existe, pour
 * accélérer l'indexation (au lieu d'attendre qu'ils la découvrent seuls).
 */
async function pingSearchEngines(newUrl) {
  // Google : notification classique via sitemap
  try {
    await fetch(`https://www.google.com/ping?sitemap=${SITE_URL}/sitemap.xml`);
    console.log('Google notifié du sitemap mis à jour.');
  } catch (e) { console.warn('Ping Google échoué :', e.message); }

  // Bing/Yandex/Seznam : protocole IndexNow (standard actuel, remplace l'ancien ping Bing)
  try {
    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: new URL(SITE_URL).host,
        key: INDEXNOW_KEY,
        keyLocation: `${SITE_URL}/${INDEXNOW_KEY}.txt`,
        urlList: [newUrl],
      }),
    });
    console.log(`IndexNow (Bing/Yandex) notifié — statut ${res.status}.`);
  } catch (e) { console.warn('Notification IndexNow échouée :', e.message); }
}

function updateSitemap(newUrl) {
  let xml = fs.existsSync(SITEMAP_PATH)
    ? fs.readFileSync(SITEMAP_PATH, 'utf8')
    : `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n`;

  const entry = `  <url>\n    <loc>${newUrl}</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>\n`;
  xml = xml.replace('</urlset>', `${entry}</urlset>`);
  fs.writeFileSync(SITEMAP_PATH, xml, 'utf8');
}

main().catch(err => {
  console.error('Échec de la génération automatique :', err);
  process.exit(1);
});
