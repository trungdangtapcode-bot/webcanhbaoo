const NEWS_CACHE_TTL_MS = Number(process.env.NEWS_CACHE_TTL_MS || 10 * 60 * 1000);
const REQUEST_TIMEOUT_MS = Number(process.env.NEWS_REQUEST_TIMEOUT_MS || 8000);
const GOOGLE_NEWS_BASE = 'https://news.google.com/rss/search';

const CATEGORY_CONFIG = {
  storm_flood: {
    label: 'Storm and flood',
    queries: ['"bao lu"', '"ngap lut"', '"mua lon"', '"sat lo"', '"ap thap nhiet doi"'],
    keywords: ['bao lu', 'ngap lut', 'mua lon', 'sat lo', 'ap thap', 'thien tai'],
  },
  fire: {
    label: 'Fire',
    queries: ['"dam chay"', '"chay nha"', '"chay chung cu"', '"chay rung"', '"phong chay"'],
    keywords: ['dam chay', 'chay nha', 'chay chung cu', 'chay rung', 'phong chay', 'cuu hoa'],
  },
  traffic: {
    label: 'Traffic',
    queries: ['"un tac giao thong"', '"tai nan giao thong"', '"cam duong"', '"ket xe"'],
    keywords: ['giao thong', 'un tac', 'tai nan', 'cam duong', 'ket xe', 'phuong tien'],
  },
};

const DIRECT_RSS_FEEDS = [
  {
    category: 'storm_flood',
    query: 'vnexpress-thoi-su',
    url: 'https://vnexpress.net/rss/thoi-su.rss',
  },
  {
    category: 'storm_flood',
    query: 'thanhnien-thoi-su',
    url: 'https://thanhnien.vn/rss/thoi-su.rss',
  },
  {
    category: 'traffic',
    query: 'vnexpress-giao-thong',
    url: 'https://vnexpress.net/rss/giao-thong.rss',
  },
  {
    category: 'traffic',
    query: 'thanhnien-giao-thong',
    url: 'https://thanhnien.vn/rss/xe.htm',
  },
  {
    category: 'fire',
    query: 'vnexpress-phap-luat',
    url: 'https://vnexpress.net/rss/phap-luat.rss',
  },
  {
    category: 'fire',
    query: 'thanhnien-thoi-su',
    url: 'https://thanhnien.vn/rss/thoi-su.rss',
  },
];

const cache = new Map();

function getCategories() {
  return Object.entries(CATEGORY_CONFIG).map(([id, config]) => ({
    id,
    label: config.label,
  }));
}

function normalizeCategory(category) {
  return CATEGORY_CONFIG[category] ? category : 'all';
}

function buildFeedUrl(query) {
  const params = new URLSearchParams({
    q: query,
    hl: 'vi',
    gl: 'VN',
    ceid: 'VN:vi',
  });
  return `${GOOGLE_NEWS_BASE}?${params.toString()}`;
}

function stripCdata(value) {
  return String(value || '').replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');
}

function decodeHtmlEntities(value) {
  return stripCdata(value)
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripHtml(value) {
  return decodeHtmlEntities(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactSentence(value, maxLength = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  const clipped = text.slice(0, maxLength);
  const sentenceEnd = Math.max(clipped.lastIndexOf('.'), clipped.lastIndexOf('?'), clipped.lastIndexOf('!'));
  if (sentenceEnd > 80) return clipped.slice(0, sentenceEnd + 1);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${clipped.slice(0, lastSpace > 80 ? lastSpace : maxLength).trim()}...`;
}

function makeNewsSummary({ title, description, category, source }) {
  const safeSource = String(source || '');
  const cleanedDescription = description
    .replace(title, '')
    .replace(safeSource ? new RegExp(`\\b${safeSource.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi') : /$a/, '')
    .replace(/\s+-\s+[^-]+$/, '')
    .replace(/\s*&nbsp;\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const base = cleanedDescription && normalizeSearchText(cleanedDescription) !== normalizeSearchText(title)
    ? cleanedDescription
    : title;
  const categoryLabel = CATEGORY_CONFIG[category]?.label || 'Situation';
  const summary = compactSentence(base, 190);
  return summary
    ? `${categoryLabel}: ${summary}${safeSource ? ` (${safeSource})` : ''}`
    : `${categoryLabel}: update from ${safeSource || 'news source'}.`;
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

function isRelevantToCategory(item, category) {
  const keywords = CATEGORY_CONFIG[category]?.keywords || [];
  if (!keywords.length) return true;
  const haystack = normalizeSearchText(`${item.title} ${item.summary} ${item.source}`);
  return keywords.some((keyword) => haystack.includes(keyword));
}

function readTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeHtmlEntities(match[1]).trim() : '';
}

function readTagAttr(xml, tag, attr) {
  const match = xml.match(new RegExp(`<${tag}\\s[^>]*${attr}=["']([^"']+)["'][^>]*>`, 'i'));
  return match ? decodeHtmlEntities(match[1]).trim() : '';
}

function parseRssItems(xml, category, query) {
  return Array.from(String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/gi)).map((match) => {
    const itemXml = match[1];
    const publishedAt = readTag(itemXml, 'pubDate');
    const parsedDate = publishedAt ? new Date(publishedAt) : null;
    const description = stripHtml(readTag(itemXml, 'description'));
    const title = stripHtml(readTag(itemXml, 'title'));
    const source = stripHtml(readTag(itemXml, 'source'));
    return {
      id: readTag(itemXml, 'guid') || readTag(itemXml, 'link') || `${category}:${title}`,
      category,
      query,
      title,
      summary: makeNewsSummary({ title, description, category, source }),
      raw_summary: description.slice(0, 320),
      url: readTag(itemXml, 'link'),
      source: source || 'Google News',
      source_url: readTagAttr(itemXml, 'source', 'url'),
      published_at: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : null,
    };
  }).filter((item) => item.title && item.url && isRelevantToCategory(item, category));
}

async function fetchFeed(category, query) {
  const response = await fetch(buildFeedUrl(query), {
    headers: {
      'user-agent': 'SmartAlertSystem/1.0',
      accept: 'application/rss+xml, application/xml, text/xml',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`News feed request failed (${response.status})`);
  }

  return parseRssItems(await response.text(), category, query);
}

async function fetchDirectFeed(feed) {
  const response = await fetch(feed.url, {
    headers: {
      'user-agent': 'SmartAlertSystem/1.0',
      accept: 'application/rss+xml, application/xml, text/xml',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Direct news feed request failed (${response.status})`);
  }

  return parseRssItems(await response.text(), feed.category, feed.query).map((item) => ({
    ...item,
    source: item.source === 'Google News' ? new URL(feed.url).hostname.replace(/^www\./, '') : item.source,
    source_url: item.source_url || feed.url,
  }));
}

function dedupeAndSort(items) {
  const seen = new Set();
  return items
    .filter((item) => {
      const key = (item.url || item.title).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0));
}

function getCategoryQueries(category) {
  if (category === 'all') {
    return Object.entries(CATEGORY_CONFIG).flatMap(([id, config]) =>
      config.queries.map((query) => ({ category: id, query }))
    );
  }

  return CATEGORY_CONFIG[category].queries.map((query) => ({ category, query }));
}

function getDirectFeeds(category) {
  if (category === 'all') return DIRECT_RSS_FEEDS;
  return DIRECT_RSS_FEEDS.filter((feed) => feed.category === category);
}

async function getNews(options = {}) {
  const category = normalizeCategory(options.category);
  const limit = Math.min(Math.max(Number(options.limit) || 24, 1), 80);
  const cacheKey = category;
  const now = Date.now();
  const cached = cache.get(cacheKey);

  if (!options.refresh && cached && cached.expiresAt > now) {
    return {
      category,
      updated_at: cached.updatedAt,
      cache_ttl_seconds: Math.max(0, Math.ceil((cached.expiresAt - now) / 1000)),
      news: cached.items.slice(0, limit),
      cached: true,
    };
  }

  const feedRequests = getCategoryQueries(category);
  const settled = await Promise.allSettled(
    feedRequests.map(({ category: itemCategory, query }) => fetchFeed(itemCategory, query))
  );
  let items = dedupeAndSort(settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : [])));
  let fallbackFailedFeeds = 0;
  let fallbackUsed = false;

  if (!items.length) {
    const fallbackSettled = await Promise.allSettled(getDirectFeeds(category).map(fetchDirectFeed));
    items = dedupeAndSort(
      fallbackSettled.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
    );
    fallbackFailedFeeds = fallbackSettled.filter((result) => result.status === 'rejected').length;
    fallbackUsed = true;
  }

  const updatedAt = new Date().toISOString();

  cache.set(cacheKey, {
    items,
    updatedAt,
    expiresAt: now + NEWS_CACHE_TTL_MS,
  });

  return {
    category,
    updated_at: updatedAt,
    cache_ttl_seconds: Math.ceil(NEWS_CACHE_TTL_MS / 1000),
    news: items.slice(0, limit),
    cached: false,
    failed_feeds: settled.filter((result) => result.status === 'rejected').length,
    fallback_failed_feeds: fallbackFailedFeeds,
    fallback_used: fallbackUsed,
  };
}

module.exports = {
  getCategories,
  getNews,
};
