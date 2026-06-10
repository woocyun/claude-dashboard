import * as https from 'https';
import type { RequestOptions } from 'https';

// Anthropic Admin (Usage & Cost) API client.
// Requires an Admin API key (sk-ant-admin...), available only to organization
// admins — NOT individual Pro/Max accounts. All calls are best-effort: any
// failure is returned as { error } rather than thrown, so the dashboard can
// degrade gracefully when no key is set or the account is individual.

const HOST = 'api.anthropic.com';

function get(pathWithQuery: string, adminKey: string): Promise<Record<string, any>> {
  return new Promise((resolve) => {
    const options: RequestOptions = {
      host: HOST,
      path: pathWithQuery,
      method: 'GET',
      headers: {
        'anthropic-version': '2023-06-01',
        'x-api-key': adminKey,
        'User-Agent': 'claude-dashboard/1.0',
      },
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (c: Buffer) => (body += c));
      res.on('end', () => {
        let json: Record<string, any>;
        try {
          json = JSON.parse(body);
        } catch {
          json = { raw: body };
        }
        if ((res.statusCode ?? 0) >= 400) {
          resolve({ error: `HTTP ${res.statusCode}`, detail: json });
        } else {
          resolve(json);
        }
      });
    });
    req.on('error', (e: Error) => resolve({ error: e.message }));
    req.end();
  });
}

function iso(d: number): string {
  return new Date(d).toISOString().replace(/\.\d+Z$/, 'Z');
}

// Daily token usage grouped by model for the last `days` days.
export async function usageReport(
  adminKey: string,
  days: number = 7,
): Promise<Record<string, any>> {
  const now = Date.now();
  const start = now - days * 86400 * 1000;
  const q = new URLSearchParams({
    starting_at: iso(start),
    ending_at: iso(now),
    bucket_width: '1d',
  });
  q.append('group_by[]', 'model');
  return get(`/v1/organizations/usage_report/messages?${q}`, adminKey);
}

// Daily cost breakdown for the last `days` days.
export async function costReport(
  adminKey: string,
  days: number = 30,
): Promise<Record<string, any>> {
  const now = Date.now();
  const start = now - days * 86400 * 1000;
  const q = new URLSearchParams({
    starting_at: iso(start),
    ending_at: iso(now),
  });
  q.append('group_by[]', 'description');
  return get(`/v1/organizations/cost_report?${q}`, adminKey);
}

export interface AdminData {
  configured: boolean;
  usage?: Record<string, any>;
  cost?: Record<string, any>;
}

export async function fetchAll(adminKey: string): Promise<AdminData> {
  if (!adminKey) {
    return { configured: false };
  }
  const [usage, cost] = await Promise.all([
    usageReport(adminKey, 7),
    costReport(adminKey, 30),
  ]);
  return { configured: true, usage, cost };
}
