// ============================================================
// XSpan Auth Gate — Authentication & Subscription Guard
// ============================================================
// Gates all MyHealthSpan Agent functionality behind an xspan.ai
// account + $5.99/mo subscription (or 3-day trial).
//
// Persistence: ~/.xspan/session.json
// Bypass: XSPAN_API_KEY env var for auth, XSPAN_SUBSCRIPTION_BYPASS for sub check
// ============================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { createInterface } from 'readline';

// ── Types ────────────────────────────────────────────────────

export type SubscriptionTier = 'trial' | 'paid' | 'expired';

export interface AuthSession {
  userId: string;
  email: string;
  name: string;
  apiKey: string;
  token: string;
  tier: SubscriptionTier;
  expiresAt: string; // ISO datetime
}

export interface SubscriptionStatus {
  active: boolean;
  tier: SubscriptionTier;
  trialEndsAt?: string;  // ISO datetime
  renewsAt?: string;     // ISO datetime
}

// ── Constants ────────────────────────────────────────────────

const XSPAN_API_BASE = 'https://api.xspan.ai';
const SESSION_DIR = join(homedir(), '.xspan');
const SESSION_FILE = join(SESSION_DIR, 'session.json');
const MONTHLY_PRICE = '$5.99/mo';

// ── AuthGate Class ───────────────────────────────────────────

export class AuthGate {
  private session: AuthSession | null = null;
  private subscriptionStatus: SubscriptionStatus | null = null;

  constructor() {
    this.loadSessionFromDisk();
  }

  // ── Login ────────────────────────────────────────────────

  async login(email: string, password: string): Promise<AuthSession> {
    // Dev bypass: if XSPAN_API_KEY is set, create a synthetic session
    const envApiKey = process.env.XSPAN_API_KEY;
    if (envApiKey && envApiKey.length > 0) {
      const session: AuthSession = {
        userId: process.env.XSPAN_USER_ID || 'dev-user',
        email,
        name: email.split('@')[0],
        apiKey: envApiKey,
        token: `dev-token-${Date.now()}`,
        tier: 'paid',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      };
      this.session = session;
      this.persistSession();
      return session;
    }

    // Production: call xspan.ai auth API
    try {
      const response = await fetch(`${XSPAN_API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        if (response.status === 401) {
          throw new AuthError('Invalid credentials. Sign up at xspan.ai/signup');
        }
        throw new AuthError(`Authentication failed (${response.status}): ${errorBody}`);
      }

      const data = (await response.json()) as AuthSession;
      this.session = data;
      this.persistSession();
      return data;
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError(
        `Could not reach xspan.ai — check your internet connection.\n  ${(error as Error).message}`
      );
    }
  }

  // ── Verify Subscription ──────────────────────────────────

  async verifySubscription(session: AuthSession): Promise<SubscriptionStatus> {
    // Dev bypass
    if (process.env.XSPAN_SUBSCRIPTION_BYPASS === 'true') {
      const status: SubscriptionStatus = {
        active: true,
        tier: 'paid',
        renewsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      };
      this.subscriptionStatus = status;
      return status;
    }

    // If API key bypass is active, derive status from session tier
    if (process.env.XSPAN_API_KEY && process.env.XSPAN_API_KEY.length > 0) {
      const status: SubscriptionStatus = {
        active: session.tier !== 'expired',
        tier: session.tier,
        renewsAt: session.tier === 'paid'
          ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
          : undefined,
        trialEndsAt: session.tier === 'trial'
          ? new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
          : undefined,
      };
      this.subscriptionStatus = status;
      return status;
    }

    // Production: call xspan.ai subscription API
    try {
      const response = await fetch(`${XSPAN_API_BASE}/auth/verify`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${session.token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        // Token expired or invalid
        if (response.status === 401) {
          this.session = null;
          this.clearPersistedSession();
          throw new AuthError('Session expired. Please log in again.');
        }
        throw new AuthError(`Subscription check failed (${response.status})`);
      }

      const data = (await response.json()) as SubscriptionStatus;
      this.subscriptionStatus = data;

      // Update session tier to match subscription
      if (this.session) {
        this.session.tier = data.tier;
        this.persistSession();
      }

      return data;
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError(
        `Could not verify subscription — check your internet connection.\n  ${(error as Error).message}`
      );
    }
  }

  // ── Authorization Check ──────────────────────────────────

  isAuthorized(): boolean {
    if (!this.session) return false;

    // Check token expiry
    const expiresAt = new Date(this.session.expiresAt).getTime();
    if (Date.now() > expiresAt) {
      return false;
    }

    // Must be paid or trial (not expired)
    return this.session.tier === 'paid' || this.session.tier === 'trial';
  }

  // ── Get API Key ──────────────────────────────────────────

  getApiKey(): string | null {
    if (!this.session) return null;
    if (!this.isAuthorized()) return null;
    return this.session.apiKey;
  }

  // ── Get Session ──────────────────────────────────────────

  getSession(): AuthSession | null {
    return this.session;
  }

  // ── Get Subscription Status ──────────────────────────────

  getSubscriptionStatus(): SubscriptionStatus | null {
    return this.subscriptionStatus;
  }

  // ── Logout ───────────────────────────────────────────────

  logout(): void {
    this.session = null;
    this.subscriptionStatus = null;
    this.clearPersistedSession();
  }

  // ── CLI Login Prompt ─────────────────────────────────────

  async promptLogin(): Promise<AuthSession> {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const ask = (question: string): Promise<string> =>
      new Promise((resolve) => rl.question(question, resolve));

    const askHidden = (question: string): Promise<string> =>
      new Promise((resolve) => {
        process.stdout.write(question);
        const stdin = process.stdin;
        const wasRaw = stdin.isRaw;

        if (stdin.isTTY) {
          stdin.setRawMode(true);
        }

        let password = '';
        const onData = (char: Buffer) => {
          const c = char.toString('utf8');

          if (c === '\n' || c === '\r' || c === '\u0004') {
            // Enter or Ctrl+D
            if (stdin.isTTY) {
              stdin.setRawMode(wasRaw ?? false);
            }
            stdin.removeListener('data', onData);
            process.stdout.write('\n');
            resolve(password);
          } else if (c === '\u0003') {
            // Ctrl+C
            if (stdin.isTTY) {
              stdin.setRawMode(wasRaw ?? false);
            }
            stdin.removeListener('data', onData);
            rl.close();
            process.exit(1);
          } else if (c === '\u007F' || c === '\b') {
            // Backspace
            if (password.length > 0) {
              password = password.slice(0, -1);
              process.stdout.write('\b \b');
            }
          } else {
            password += c;
            process.stdout.write('*');
          }
        };

        stdin.resume();
        stdin.on('data', onData);
      });

    console.log('');
    console.log('  ┌─────────────────────────────────────────────┐');
    console.log('  │   Sign in to MyHealthSpan                   │');
    console.log('  │   (xspan.ai account required)               │');
    console.log('  └─────────────────────────────────────────────┘');
    console.log('');

    try {
      const email = await ask('  Email: ');
      const password = await askHidden('  Password: ');

      console.log('');
      console.log('  Authenticating...');

      const session = await this.login(email.trim(), password);
      const subStatus = await this.verifySubscription(session);

      // Format success message
      const tierLabel = session.tier === 'paid' ? 'Pro' : 'Trial';
      let renewInfo = '';
      if (subStatus.renewsAt) {
        const renewDate = new Date(subStatus.renewsAt);
        const monthNames = [
          'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
          'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
        ];
        renewInfo = ` - renews ${monthNames[renewDate.getMonth()]} ${renewDate.getDate()}`;
      } else if (subStatus.trialEndsAt) {
        const trialEnd = new Date(subStatus.trialEndsAt);
        const daysLeft = Math.max(0, Math.ceil((trialEnd.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
        renewInfo = ` - ${daysLeft} day${daysLeft !== 1 ? 's' : ''} left`;
      }

      console.log('');
      console.log(`  Signed in as ${session.email} (${tierLabel}${renewInfo})`);
      console.log('');

      rl.close();
      return session;
    } catch (error) {
      console.log('');
      if (error instanceof AuthError) {
        console.log(`  ${error.message}`);
      } else {
        console.log(`  Authentication failed. Try again or sign up at xspan.ai/signup`);
      }
      console.log('');
      rl.close();
      throw error;
    }
  }

  // ── Require Auth (Gate Helper) ───────────────────────────
  // Call this at the top of any gated operation.
  // Returns the session if authorized, throws if not.

  async requireAuth(): Promise<AuthSession> {
    // Try loading from disk if no in-memory session
    if (!this.session) {
      this.loadSessionFromDisk();
    }

    // If still no session, prompt login
    if (!this.session) {
      return this.promptLogin();
    }

    // Check expiry
    if (!this.isAuthorized()) {
      console.log('  Session expired. Please log in again.');
      this.logout();
      return this.promptLogin();
    }

    // Verify subscription is still active
    const subStatus = await this.verifySubscription(this.session);
    if (!subStatus.active) {
      console.log('');
      console.log(`  Your subscription has expired.`);
      console.log(`  Resubscribe at xspan.ai/pricing (${MONTHLY_PRICE})`);
      console.log('');
      throw new AuthError('Subscription expired. Resubscribe at xspan.ai/pricing');
    }

    return this.session;
  }

  // ── Disk Persistence ─────────────────────────────────────

  private persistSession(): void {
    try {
      if (!existsSync(SESSION_DIR)) {
        mkdirSync(SESSION_DIR, { recursive: true, mode: 0o700 });
      }
      writeFileSync(SESSION_FILE, JSON.stringify(this.session, null, 2), {
        encoding: 'utf-8',
        mode: 0o600, // Owner read/write only
      });
    } catch {
      // Non-fatal: session just won't persist across restarts
      console.warn('[AuthGate] Could not persist session to disk');
    }
  }

  private loadSessionFromDisk(): void {
    try {
      if (!existsSync(SESSION_FILE)) return;

      const raw = readFileSync(SESSION_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as AuthSession;

      // Validate required fields
      if (!parsed.userId || !parsed.email || !parsed.token || !parsed.apiKey) {
        this.clearPersistedSession();
        return;
      }

      // Check if expired
      const expiresAt = new Date(parsed.expiresAt).getTime();
      if (Date.now() > expiresAt) {
        this.clearPersistedSession();
        return;
      }

      this.session = parsed;
    } catch {
      // Corrupt session file — remove it
      this.clearPersistedSession();
    }
  }

  private clearPersistedSession(): void {
    try {
      if (existsSync(SESSION_FILE)) {
        unlinkSync(SESSION_FILE);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ── Auth Error ───────────────────────────────────────────────

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

// ── Singleton Export ─────────────────────────────────────────

export const authGate = new AuthGate();
