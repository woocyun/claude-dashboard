'use strict';

const https = require('https');

// Anthropic Admin (Usage & Cost) API client.
// Requires an Admin API key (sk-ant-admin...), available only to organization
// admins — NOT individual Pro/Max accounts. All calls are best-effort: any
// failure is returned as { error } rather than thrown, so the dashboard can
// degrade gracefully when no key is set or the account is individual.

const HOST = 'api.anthropic.com';

function get(pathWithQuery, adminKey) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        host: HOST,
        path: pathWithQuery,
        method: 'GET',
        headers: {
          'anthropic-version': '2023-06-01',
          'x-api-key': adminKey,
          'User-Agent': 'claude-dashboard/1.0',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          let json;
          try {
            json = JSON.parse(body);
          } catch {
            json = { raw: body };
          }
          if (res.statusCode >= 400) {
            resolve({ error: `HTTP ${res.statusCode}`, detail: json });
          } else {
            resolve(json);
          }
        });
      }
    );
    req.on('error', (e) => resolve({ error: e.message }));
    req.end();
  });
}

function iso(d) {
  return new Date(d).toISOString().replace(/\.\d+Z$/, 'Z');
}

// Daily token usage grouped by model for the last `days` days.
async function usageReport(adminKey, days = 7) {
  const now = Date.now();
  const start = now - days * 86400 * 1000;
  const q = new URLSearchParams({
    starting_at: iso(start),
    ending_at: iso(now),
    bucket_width: '1d',
  });
  q.append('group_by[]', 'model');
  const r = await get(`/v1/organizations/usage_report/messages?${q}`, adminKey);
  return r;
}

// Daily cost breakdown for the last `days` days.
async function costReport(adminKey, days = 30) {
  const now = Date.now();
  const start = now - days * 86400 * 1000;
  const q = new URLSearchParams({
    starting_at: iso(start),
    ending_at: iso(now),
  });
  q.append('group_by[]', 'description');
  const r = await get(`/v1/organizations/cost_report?${q}`, adminKey);
  return r;
}

async function fetchAll(adminKey) {
  if (!adminKey) {
    return { configured: false };
  }
  const [usage, cost] = await Promise.all([
    usageReport(adminKey, 7),
    costReport(adminKey, 30),
  ]);
  return { configured: true, usage, cost };
}

module.exports = { fetchAll, usageReport, costReport };
