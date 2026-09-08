const defaultBaseUrl = 'https://keve-partner-hub.smkim3733.chatgpt.site';
const baseUrl = new URL(process.env.PARTNER_HUB_BASE_URL || defaultBaseUrl);

if (baseUrl.protocol !== 'https:' || baseUrl.username || baseUrl.password) {
  throw new Error('PARTNER_HUB_BASE_URL must be an HTTPS origin without credentials.');
}

const browserHeaders = {
  'content-security-policy': "frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
};

const checks = [
  { path: '/', status: 200, browser: true },
  { path: '/account', status: 200, browser: true },
  { path: '/account/setup', status: 200, browser: true },
  { path: '/api/state', status: 401, private: true },
  { path: '/api/application-draft', status: 401, private: true },
  { path: '/api/admin/file-inventory?filter=unlinked', status: 401, private: true },
  { path: '/api/ai-diagnosis/readiness', status: 401, private: true },
];

function expectHeader(response, key, expected) {
  const actual = response.headers.get(key);
  if (actual !== expected) {
    throw new Error(`${response.url}: ${key} was ${JSON.stringify(actual)}.`);
  }
}

for (const check of checks) {
  const url = new URL(check.path, baseUrl);
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    signal: AbortSignal.timeout(10_000),
    headers: {
      accept: check.browser ? 'text/html' : 'application/json',
      'cache-control': 'no-cache',
      'user-agent': 'partner-hub-anonymous-health-check/1.0',
    },
  });
  if (response.status !== check.status) {
    throw new Error(`${url.pathname}: expected ${check.status}, received ${response.status}.`);
  }
  if (check.browser) {
    for (const [key, value] of Object.entries(browserHeaders))
      expectHeader(response, key, value);
  }
  if (check.private) {
    expectHeader(response, 'cache-control', 'private, no-store, max-age=0');
    expectHeader(response, 'x-content-type-options', 'nosniff');
  }
  console.log(`PASS ${url.pathname}${url.search} ${response.status}`);
}

console.log(`Production health verified with ${checks.length} anonymous GET requests.`);
