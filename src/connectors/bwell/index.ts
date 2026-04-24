// ============================================================
// MyHealthSpan Agent — b.well Connected Health Connector
// Replaces direct SMART on FHIR / Fasten Connect for US EHR access
//
// b.well aggregates 2.4M+ providers (Epic, Cerner, etc.)
// Same platform Perplexity Health uses.
//
// Docs: https://developer.bwell.com
// SDK: @icanbwell/bwell-sdk-ts (npm)
// ============================================================

export interface BWellConfig {
  clientKey: string;
  environment: 'sandbox' | 'production';
}

export interface BWellSession {
  accessToken: string;
  personId: string;
  userName: string;
}

export interface BWellConnection {
  id: string;
  name: string;
  status: string;       // Pending, Connected, Disconnected, Expired
  type: string;         // provider, payer
}

export interface BWellHealthData {
  resourceType: string;
  count: number;
  data: unknown[];
}

// API base URLs
const SANDBOX_GATEWAY = 'https://api-gateway.client-sandbox.icanbwell.com';
const SANDBOX_API = 'https://api.client-sandbox.icanbwell.com';
const PROD_GATEWAY = 'https://api-gateway.icanbwell.com';
const PROD_API = 'https://api.icanbwell.com';

export class BWellClient {
  private config: BWellConfig;
  private gatewayUrl: string;
  private apiUrl: string;
  private session: BWellSession | null = null;

  constructor(config: BWellConfig) {
    this.config = config;
    this.gatewayUrl = config.environment === 'sandbox' ? SANDBOX_GATEWAY : PROD_GATEWAY;
    this.apiUrl = config.environment === 'sandbox' ? SANDBOX_API : PROD_API;
    console.log(`[b.well] Client initialized (${config.environment})`);
  }

  // ── Authentication ──────────────────────────────────────────

  /**
   * Login with b.well test user credentials.
   * Returns OAuth token + person ID for FHIR queries.
   */
  async login(email: string, password: string): Promise<BWellSession> {
    console.log(`[b.well] Logging in as ${email}...`);

    const resp = await fetch(`${this.gatewayUrl}/identity/account/login`, {
      method: 'POST',
      headers: {
        'clientkey': this.config.clientKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      throw new Error(`[b.well] Login failed (${resp.status}): ${errorText}`);
    }

    const data = await resp.json() as {
      access_token?: string;
      token?: string;
      person_id?: string;
      personId?: string;
      id?: string;
      name?: string;
      [key: string]: unknown;
    };

    // b.well may return token in different fields
    const accessToken = data.access_token || data.token || '';
    const personId = data.person_id || data.personId || data.id || '';

    if (!accessToken) {
      console.log('[b.well] Login response:', JSON.stringify(data, null, 2));
      throw new Error('[b.well] No access token in login response');
    }

    this.session = {
      accessToken: typeof accessToken === 'string' ? accessToken : String(accessToken),
      personId: typeof personId === 'string' ? personId : String(personId),
      userName: email,
    };

    console.log(`[b.well] Logged in — person: ${this.session.personId || 'extracting from token...'}`);
    return this.session;
  }

  // ── Connection Management ───────────────────────────────────

  /**
   * Search for available healthcare data connections (providers, payers).
   */
  async searchConnections(query: string = ''): Promise<BWellConnection[]> {
    this.ensureSession();
    console.log(`[b.well] Searching connections: "${query || 'all'}"...`);

    try {
      const url = query
        ? `${this.apiUrl}/v1/connection/search?q=${encodeURIComponent(query)}`
        : `${this.apiUrl}/v1/connection/search`;

      const resp = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.session!.accessToken}`,
          'clientkey': this.config.clientKey,
          'Accept': 'application/json',
        },
      });

      if (!resp.ok) {
        console.warn(`[b.well] Connection search failed: ${resp.status}`);
        return [];
      }

      const data = await resp.json() as { data?: BWellConnection[] };
      const connections = data.data || [];
      console.log(`[b.well] Found ${connections.length} connections`);
      return connections;
    } catch (err) {
      console.error('[b.well] Connection search error:', err);
      return [];
    }
  }

  /**
   * Get current member connections (already linked providers/payers).
   */
  async getMemberConnections(): Promise<BWellConnection[]> {
    this.ensureSession();
    console.log('[b.well] Fetching member connections...');

    try {
      const resp = await fetch(`${this.apiUrl}/v1/connection/member`, {
        headers: {
          'Authorization': `Bearer ${this.session!.accessToken}`,
          'clientkey': this.config.clientKey,
          'Accept': 'application/json',
        },
      });

      if (!resp.ok) {
        console.warn(`[b.well] Member connections failed: ${resp.status}`);
        return [];
      }

      const data = await resp.json() as { data?: BWellConnection[] };
      return data.data || [];
    } catch (err) {
      console.error('[b.well] Member connections error:', err);
      return [];
    }
  }

  // ── Health Data Retrieval ───────────────────────────────────

  /**
   * Fetch ALL health data via FHIR $everything for the logged-in patient.
   * This is the main data retrieval endpoint — returns everything b.well has aggregated.
   */
  async fetchEverything(): Promise<BWellHealthData[]> {
    this.ensureSession();
    const personId = this.session!.personId;

    if (!personId) {
      console.warn('[b.well] No person ID — cannot fetch $everything');
      return [];
    }

    console.log(`[b.well] Fetching $everything for person.${personId}...`);

    try {
      const resp = await fetch(
        `${this.apiUrl}/v1/Patient/person.${personId}/$everything`,
        {
          headers: {
            'Authorization': `Bearer ${this.session!.accessToken}`,
            'Accept': 'application/fhir+json',
          },
        },
      );

      if (!resp.ok) {
        const errText = await resp.text();
        console.error(`[b.well] $everything failed (${resp.status}): ${errText}`);
        return [];
      }

      const bundle = await resp.json() as {
        resourceType?: string;
        entry?: Array<{ resource: { resourceType: string; [key: string]: unknown } }>;
      };

      // Group by resource type
      const grouped: Record<string, unknown[]> = {};
      for (const entry of bundle.entry || []) {
        const rt = entry.resource?.resourceType || 'Unknown';
        if (!grouped[rt]) grouped[rt] = [];
        grouped[rt].push(entry.resource);
      }

      const results: BWellHealthData[] = Object.entries(grouped).map(([resourceType, data]) => ({
        resourceType,
        count: data.length,
        data,
      }));

      const total = results.reduce((sum, r) => sum + r.count, 0);
      console.log(`[b.well] Retrieved ${total} resources across ${results.length} types:`);
      for (const r of results) {
        console.log(`  ${r.resourceType}: ${r.count}`);
      }

      return results;
    } catch (err) {
      console.error('[b.well] $everything error:', err);
      return [];
    }
  }

  /**
   * Fetch a specific FHIR resource type for the patient.
   */
  async fetchResource(resourceType: string, params: Record<string, string> = {}): Promise<unknown[]> {
    this.ensureSession();
    const personId = this.session!.personId;

    const searchParams = new URLSearchParams({
      patient: `person.${personId}`,
      _count: '100',
      ...params,
    });

    const url = `${this.apiUrl}/v1/${resourceType}?${searchParams}`;
    console.log(`[b.well] Fetching ${resourceType}...`);

    try {
      const resp = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.session!.accessToken}`,
          'Accept': 'application/fhir+json',
        },
      });

      if (!resp.ok) {
        console.warn(`[b.well] ${resourceType}: HTTP ${resp.status}`);
        return [];
      }

      const bundle = await resp.json() as { entry?: Array<{ resource: unknown }> };
      const entries = bundle.entry?.map(e => e.resource) || [];
      console.log(`[b.well] ${resourceType}: ${entries.length} records`);
      return entries;
    } catch (err) {
      console.error(`[b.well] ${resourceType} error:`, err);
      return [];
    }
  }

  /**
   * Convenience: fetch health summary (all key resource types).
   */
  async fetchHealthSummary(): Promise<Record<string, unknown[]>> {
    this.ensureSession();

    const resourceTypes = [
      'Observation',           // Vitals, labs
      'Condition',             // Diagnoses
      'MedicationStatement',   // Medications
      'MedicationRequest',     // Prescriptions
      'AllergyIntolerance',    // Allergies
      'Immunization',          // Immunizations
      'Encounter',             // Visits
      'Procedure',             // Procedures
      'CarePlan',              // Care plans
      'DiagnosticReport',      // Lab reports
    ];

    const summary: Record<string, unknown[]> = {};

    for (const rt of resourceTypes) {
      try {
        summary[rt] = await this.fetchResource(rt);
      } catch {
        summary[rt] = [];
      }
    }

    const total = Object.values(summary).reduce((sum, arr) => sum + arr.length, 0);
    console.log(`[b.well] Health summary: ${total} total records`);
    return summary;
  }

  // ── Utilities ───────────────────────────────────────────────

  getSession(): BWellSession | null {
    return this.session;
  }

  isAuthenticated(): boolean {
    return this.session !== null && !!this.session.accessToken;
  }

  async checkHealth(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.apiUrl}/health`);
      return resp.ok;
    } catch {
      return false;
    }
  }

  private ensureSession(): void {
    if (!this.session || !this.session.accessToken) {
      throw new Error('[b.well] Not authenticated. Call login() first.');
    }
  }
}
