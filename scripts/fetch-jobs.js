// Daily job scraper — run via GitHub Actions
// Fetches Scottish tech jobs from Adzuna API and writes jobs.json
// Register free at: https://developer.adzuna.com/

const fs = require('fs');
const path = require('path');

const APP_ID  = process.env.ADZUNA_APP_ID;
const APP_KEY = process.env.ADZUNA_APP_KEY;

if (!APP_ID || !APP_KEY) {
  console.error('Missing ADZUNA_APP_ID or ADZUNA_APP_KEY env vars');
  process.exit(1);
}

const SEARCHES = [
  'software engineer',
  'software developer',
  'data scientist',
  'data engineer',
  'devops engineer',
  'cloud engineer',
  'product manager',
  'UX designer',
  'cybersecurity analyst',
  'machine learning engineer',
  'frontend developer',
  'backend developer',
  'full stack developer',
  'iOS developer',
  'android developer',
];

const TECH_TAGS = [
  'Python','JavaScript','TypeScript','React','Vue','Angular','Node.js',
  'AWS','Azure','GCP','Kubernetes','Docker','Terraform','Linux',
  'Java','Go','Rust','Swift','Kotlin','Scala','Ruby','PHP',
  'SQL','PostgreSQL','MySQL','MongoDB','Redis','Snowflake','dbt','Spark',
  'PyTorch','TensorFlow','Figma','Jira','Agile','CI/CD',
];

const CITIES = ['Edinburgh','Glasgow','Dundee','Aberdeen','Stirling','Inverness','Perth'];

async function fetchPage(query, page = 1) {
  const url = new URL(`https://api.adzuna.com/v1/api/jobs/gb/search/${page}`);
  url.searchParams.set('app_id', APP_ID);
  url.searchParams.set('app_key', APP_KEY);
  url.searchParams.set('results_per_page', '50');
  url.searchParams.set('where', 'Scotland');
  url.searchParams.set('what', query);
  url.searchParams.set('category', 'it-jobs');
  url.searchParams.set('content-type', 'application/json');

  const res = await fetch(url.toString());
  if (!res.ok) {
    console.warn(`Adzuna ${res.status} for "${query}" page ${page}`);
    return [];
  }
  const data = await res.json();
  return data.results || [];
}

function categorize(title) {
  const t = title.toLowerCase();
  if (/\b(data scientist|machine learning|ml engineer|ai engineer|nlp|llm)\b/.test(t)) return 'Data & AI';
  if (/\b(data engineer|etl|pipeline|analytics engineer)\b/.test(t)) return 'Data & AI';
  if (/\b(devops|sre|platform engineer|cloud engineer|infrastructure|devsecops)\b/.test(t)) return 'DevOps & Cloud';
  if (/\b(ux|ui|user experience|product design|interaction design|figma)\b/.test(t)) return 'Design & UX';
  if (/\b(product manager|product owner|head of product)\b/.test(t)) return 'Product';
  if (/\b(cyber|security analyst|penetration|soc analyst|infosec|information security)\b/.test(t)) return 'Cybersecurity';
  if (/\b(qa |quality assurance|test engineer|sdet|automation tester)\b/.test(t)) return 'QA & Testing';
  return 'Engineering';
}

function inferWorkType(description = '') {
  const d = description.toLowerCase();
  if (/\b(fully remote|100% remote|remote only|remote-first|remote position)\b/.test(d)) return 'Remote';
  if (/\bhybrid\b/.test(d)) return 'Hybrid';
  return 'On-site';
}

function extractCity(locationStr = '') {
  return CITIES.find(c => locationStr.includes(c)) || 'Scotland';
}

function extractTags(text) {
  const lower = text.toLowerCase();
  return TECH_TAGS.filter(t => lower.includes(t.toLowerCase())).slice(0, 6);
}

function formatSalary(min, max) {
  if (!min && !max) return '';
  const fmt = n => n >= 1000 ? `£${Math.round(n / 1000)}k` : `£${n}`;
  if (min && max) return `${fmt(min)} – ${fmt(max)}`;
  if (min) return `From ${fmt(min)}`;
  return `Up to ${fmt(max)}`;
}

function makeLogoInitials(company = '') {
  const words = company.trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return company.slice(0, 2).toUpperCase();
}

async function run() {
  const seen = new Set();
  const allJobs = [];

  for (const query of SEARCHES) {
    let results;
    try {
      results = await fetchPage(query, 1);
    } catch (e) {
      console.warn(`Error fetching "${query}": ${e.message}`);
      results = [];
    }

    for (const r of results) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);

      const desc = r.description || '';
      const company = r.company?.display_name || 'Unknown Company';
      const location = r.location?.display_name || '';

      allJobs.push({
        id:           String(r.id),
        title:        r.title || 'Tech Role',
        company,
        logo:         makeLogoInitials(company),
        city:         extractCity(location),
        category:     categorize(r.title || ''),
        type:         inferWorkType(desc),
        salary:       formatSalary(r.salary_min, r.salary_max),
        tags:         extractTags(r.title + ' ' + desc),
        description:  desc.slice(0, 800) + (desc.length > 800 ? '…' : ''),
        requirements: [],
        perks:        [],
        applyUrl:     r.redirect_url || '#',
        featured:     false,
        date:         r.created || new Date().toISOString(),
        source:       'adzuna',
      });
    }

    // Respect Adzuna rate limits
    await new Promise(r => setTimeout(r, 400));
  }

  // Sort newest first, cap at 300
  allJobs.sort((a, b) => new Date(b.date) - new Date(a.date));
  const jobs = allJobs.slice(0, 300);

  const out = { updated: new Date().toISOString(), jobs };
  fs.writeFileSync(
    path.join(__dirname, '..', 'jobs.json'),
    JSON.stringify(out, null, 2)
  );
  console.log(`✓ Written ${jobs.length} jobs to jobs.json`);
}

run().catch(err => { console.error(err); process.exit(1); });
