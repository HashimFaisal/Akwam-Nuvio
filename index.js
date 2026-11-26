'use strict';

const BASE = 'https://akwam.ss';
const CINEMETA = 'https://v3-cinemeta.strem.io';
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36';
const cache = new Map();

function cached(key, loader, ttl = 120000) {
  const old = cache.get(key);
  if (old && Date.now() - old.time < ttl) return old.value;
  const value = Promise.resolve().then(loader).catch(error => { cache.delete(key); throw error; });
  cache.set(key, { time: Date.now(), value });
  return value;
}
function settings() {
  return typeof globalThis !== 'undefined' && globalThis.SCRAPER_SETTINGS || {};
}
function baseUrl() {
  return String(settings().domain || BASE).trim().replace(/\/+$/, '');
}
function request(url, referer) {
  return fetch(url, { headers: {
    'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ar,en-US;q=0.8,en;q=0.7', ...(referer ? { Referer: referer } : {})
  }}).then(async response => {
    if (!response.ok) throw new Error('HTTP ' + response.status + ' for ' + url);
    return { text: await response.text(), url: response.url || url };
  });
}
function normalizeTitle(value) {
  return String(value || '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .normalize('NFD').replace(/[\u0300-\u036f\u064B-\u065F\u0670]/g, '')
    .toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function stripTags(value) {
  return String(value || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/\s+/g, ' ').trim();
}
function absolute(url, origin = baseUrl()) {
  try { return new URL(url, origin).href; } catch (_) { return ''; }
}
function yearOf(value) {
  const match = String(value || '').match(/(?:19|20)\d{2}/);
  return match ? match[0] : null;
}
async function targetInfo(id, type) {
  const clean = String(id || '').replace(/^(tmdb:|movie:|series:|tv:)/i, '').split(':')[0];
  if (/^akwam_/i.test(clean)) return { direct: decodeURIComponent(clean.slice(6).replace(/~/g, '%')) };
  let tmdbId = clean;
  if (/^tt\d+$/i.test(clean)) {
    const found = await fetchJson('https://api.themoviedb.org/3/find/' + clean + '?api_key=' + tmdbKey() + '&external_source=imdb_id');
    const list = type === 'movie' ? (found.movie_results || found.tv_results) : (found.tv_results || found.movie_results);
    tmdbId = list && list[0] ? String(list[0].id) : '';
  }
  if (!/^\d+$/.test(tmdbId)) return { titles: [] };
  const details = await fetchJson('https://api.themoviedb.org/3/' + (type === 'movie' ? 'movie/' : 'tv/') + tmdbId + '?api_key=' + tmdbKey() + '&append_to_response=translations');
  const titles = [];
  [details.title, details.name, details.original_title, details.original_name].forEach(t => { if (t && !titles.includes(t)) titles.push(t); });
  (((details.translations || {}).translations) || []).forEach(tr => {
    if (tr.iso_639_1 === 'ar' && tr.data) {
      const t = tr.data.title || tr.data.name;
      if (t && !titles.includes(t)) titles.push(t);
    }
  });
  return { titles, year: yearOf(details.release_date || details.first_air_date) };
}
function tmdbKey() {
  return typeof globalThis !== 'undefined' && globalThis.TMDB_API_KEY ? String(globalThis.TMDB_API_KEY) : '8265bd1679663a7ea12ac168da84d2e8';
}
async function fetchJson(url) {
  const result = await request(url);
  return JSON.parse(result.text);
}
function parseEntries(html, type) {
  const out = [], seen = new Set();
  const re = /<h[1-6][^>]*class=["'][^"']*entry-title[^"']*["'][^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = absolute(m[1]);
    if (!href || seen.has(href)) continue;
    if (type === 'movie' ? !/\/movie\//i.test(href) : !/\/(series|shows)\//i.test(href)) continue;
    seen.add(href);
    out.push({ url: href, title: stripTags(m[2]) });
  }
  return out;
}
function chooseEntry(entries, titles, year) {
  const wanted = titles.map(normalizeTitle).filter(Boolean);
  let best = null, score = 0;
  for (const entry of entries) {
    const actual = normalizeTitle(entry.title);
    let current = wanted.some(t => t === actual) ? 100 : 0;
    if (!current) {
      for (const t of wanted) {
        const a = new Set(t.split(' ')), b = new Set(actual.split(' '));
        let common = 0; a.forEach(word => { if (b.has(word)) common++; });
        const s = (2 * common) / Math.max(1, a.size + b.size);
        if (s > current) current = s;
      }
    }
    if (year && new RegExp('(?:^|\\D)' + year + '(?:\\D|$)').test(entry.title)) current += 0.08;
    if (current > score) { score = current; best = entry; }
  }
  return score >= 0.72 ? best : null;
}
function episodeNumber(text, href) {
  const value = stripTags(text) + ' ' + href;
  const patterns = [
    /(?:الحلقة|حلقة|episode|ep)\s*[-:#]?\s*(\d+)/i,
    /(?:^|[-_/])(?:e|ep)[-_. ]?(\d+)(?:\D|$)/i,
    /(?:^|[-_/])الحلقه[-_. ]?(\d+)(?:\D|$)/i
  ];
  for (const re of patterns) { const m = value.match(re); if (m) return Number(m[1]); }
  return null;
}
function seasonNumber(text, href) {
  const m = (stripTags(text) + ' ' + href).match(/(?:الموسم|موسم|season|s)[\s_-]*(\d+)/i);
  return m ? Number(m[1]) : null;
}
function findEpisode(html, season, episode) {
  const re = /<a[^>]*href=["']([^"']*\/episode\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const found = []; let m;
  while ((m = re.exec(html))) {
    const href = absolute(m[1]);
    const ep = episodeNumber(m[2], href);
    const sn = seasonNumber(m[2], href);
    if (ep !== null && ep === Number(episode) && (sn === null || sn === Number(season))) found.push(href);
  }
  return [...new Set(found)][0] || null;
}
function extractWatchUrls(html) {
  const re = /href=["']([^"']*\/watch\/\d+\/[^"']*)["']/gi;
  const found = []; let m;
  while ((m = re.exec(html))) { const url = absolute(m[1]); if (url && !found.includes(url)) found.push(url); }
  return found;
}
function qualityOf(tag, url) {
  // Akwam may put resolution in different attributes or in the media URL.
  const value = String(tag || '') + ' ' + String(url || '');
  const m = value.match(/(?:2160|1440|1080|720|576|540|480|360)\\s*p?/i);
  return m ? m[0].replace(/\\s+/g, '').toLowerCase().replace(/p?$/, 'p') : 'Unknown';
}
async function extractStreams(watchUrl) {
  const page = await request(watchUrl);
  const out = [];
  const re = /<source\b[^>]*>/gi; let m;
  while ((m = re.exec(page.text))) {
    const tag = m[0], src = tag.match(/\bsrc=["']([^"']+)["']/i);
    if (!src) continue;
    const url = absolute(src[1], page.url);
    if (!/^https?:/i.test(url)) continue;
    const quality = qualityOf(tag, url);
    out.push({ name: 'Akwam | أكوام - ' + quality, title: 'Akwam • ' + quality + ' (Direct)', url, quality,
      provider: 'akwam', type: 'mp4', language: 'ar', headers: { 'User-Agent': UA, Referer: page.url }, subtitles: [] });
  }
  return out;
}
async function getStreams(id, mediaType, season, episode) {
  try {
    const type = String(mediaType || 'movie').toLowerCase() === 'movie' ? 'movie' : 'tv';
    const info = await cached('target:' + type + ':' + id, () => targetInfo(id, type), 6 * 60 * 60 * 1000);
    let itemUrl = info.direct ? absolute(info.direct) : '';
    if (!itemUrl) {
      for (const title of info.titles || []) {
        const search = await request(baseUrl() + '/search?q=' + encodeURIComponent(title) + '&section=' + (type === 'movie' ? 'movie' : 'series'));
        const match = chooseEntry(parseEntries(search.text, type), [title], info.year);
        if (match) { itemUrl = match.url; break; }
      }
    }
    if (!itemUrl) return [];
    const item = await request(itemUrl);
    let html = item.text;
    if (type === 'tv') {
      const chosen = findEpisode(html, season == null ? 1 : season, episode == null ? 1 : episode);
      if (!chosen) return [];
      const epPage = await request(chosen, item.url);
      html = epPage.text;
    }
    const watchUrls = extractWatchUrls(html).slice(0, 4);
    const streams = [];
    for (const url of watchUrls) streams.push(...await extractStreams(url));
    // Keep only one stream per detected quality across all watch pages.
    // Unknown-quality streams are deduplicated by URL so distinct links are not lost.
    const seen = new Set();
    return streams.filter(s => {
      const key = s.quality && s.quality !== 'Unknown'
        ? 'quality:' + s.quality.toLowerCase()
        : 'url:' + s.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => {
      const qa = parseInt(a.quality, 10) || 0;
      const qb = parseInt(b.quality, 10) || 0;
      return qb - qa;
    });
  } catch (error) {
    console.error('[Akwam] ' + (error && error.message || error));
    return [];
  }
}
function onSettings() {
  return [{ type: 'header', label: 'Akwam | أكوام' },
    { type: 'text', key: 'domain', label: 'Base URL', placeholder: BASE, defaultValue: BASE }];
}
if (typeof module !== 'undefined' && module.exports) module.exports = { getStreams, onSettings };
if (typeof globalThis !== 'undefined') { globalThis.getStreams = getStreams; globalThis.onSettings = onSettings; }
