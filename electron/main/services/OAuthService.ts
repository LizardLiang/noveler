import { shell } from 'electron';
import crypto from 'node:crypto';
import type { OAuthTokens } from '../../shared/types.js';

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTH_BASE = 'https://auth.openai.com';
const DEVICE_USERCODE_URL = `${AUTH_BASE}/api/accounts/deviceauth/usercode`;
const DEVICE_TOKEN_URL = `${AUTH_BASE}/api/accounts/deviceauth/token`;
const TOKEN_URL = `${AUTH_BASE}/oauth/token`;
const DEVICE_REDIRECT_URI = `${AUTH_BASE}/deviceauth/callback`;
const DEVICE_AUTH_PAGE = `${AUTH_BASE}/codex/device`;
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 5000;

export interface DeviceCodeInfo {
  userCode: string;
  deviceAuthId: string;
  verificationUrl: string;
}

export interface OAuthStartResult {
  success: boolean;
  tokens?: OAuthTokens;
  email?: string;
  error?: string;
}

function parseJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length < 2) return {};
  const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
  return JSON.parse(payload);
}

function extractAccountId(idToken: string): string {
  const claims = parseJwtPayload(idToken);

  if (typeof claims.chatgpt_account_id === 'string') return claims.chatgpt_account_id;

  const authClaims = claims['https://api.openai.com/auth'] as Record<string, unknown> | undefined;
  if (authClaims && typeof authClaims.chatgpt_account_id === 'string') {
    return authClaims.chatgpt_account_id;
  }

  const orgs = claims.organizations as Array<{ id: string }> | undefined;
  if (orgs && orgs.length > 0 && typeof orgs[0].id === 'string') {
    return orgs[0].id;
  }

  return '';
}

function extractEmail(idToken: string): string {
  const claims = parseJwtPayload(idToken);
  return typeof claims.email === 'string' ? claims.email : '';
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class OAuthService {
  private abortController: AbortController | null = null;

  async requestDeviceCode(): Promise<DeviceCodeInfo> {
    const response = await fetch(DEVICE_USERCODE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: CLIENT_ID }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`取得裝置代碼失敗 (${response.status}): ${body}`);
    }

    const data = (await response.json()) as {
      device_auth_id: string;
      user_code: string;
      interval?: number;
    };

    return {
      userCode: data.user_code,
      deviceAuthId: data.device_auth_id,
      verificationUrl: DEVICE_AUTH_PAGE,
    };
  }

  async pollForAuthorization(deviceAuthId: string, userCode: string): Promise<OAuthStartResult> {
    this.abortController = new AbortController();
    const deadline = Date.now() + AUTH_TIMEOUT_MS;

    while (Date.now() < deadline) {
      if (this.abortController.signal.aborted) {
        return { success: false, error: '使用者已取消登入' };
      }

      await sleep(POLL_INTERVAL_MS);

      try {
        const pollResponse = await fetch(DEVICE_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            device_auth_id: deviceAuthId,
            user_code: userCode,
          }),
          signal: this.abortController.signal,
        });

        if (pollResponse.status === 200) {
          const pollData = (await pollResponse.json()) as {
            authorization_code: string;
            code_verifier: string;
          };

          return this.exchangeCodeForTokens(pollData.authorization_code, pollData.code_verifier);
        }

        // 202 = still waiting, any other status = keep polling until timeout
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return { success: false, error: '使用者已取消登入' };
        }
      }
    }

    return { success: false, error: '登入逾時，請重試' };
  }

  private async exchangeCodeForTokens(authorizationCode: string, codeVerifier: string): Promise<OAuthStartResult> {
    const tokenResponse = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: authorizationCode,
        redirect_uri: DEVICE_REDIRECT_URI,
        client_id: CLIENT_ID,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenResponse.ok) {
      const body = await tokenResponse.text();
      return { success: false, error: `Token 交換失敗 (${tokenResponse.status}): ${body}` };
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token: string;
      id_token?: string;
      expires_in: number;
    };

    const accountId = tokenData.id_token ? extractAccountId(tokenData.id_token) : '';
    const email = tokenData.id_token ? extractEmail(tokenData.id_token) : '';

    const tokens: OAuthTokens = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: Date.now() + tokenData.expires_in * 1000,
      account_id: accountId,
    };

    return { success: true, tokens, email };
  }

  async startAuthFlow(): Promise<OAuthStartResult> {
    try {
      const deviceCode = await this.requestDeviceCode();
      await shell.openExternal(deviceCode.verificationUrl);
      return this.pollForAuthorization(deviceCode.deviceAuthId, deviceCode.userCode);
    } catch (err) {
      const message = err instanceof Error ? err.message : '未知 OAuth 錯誤';
      return { success: false, error: message };
    }
  }

  cancelAuth(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  async refreshToken(refreshToken: string): Promise<OAuthTokens> {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Token 刷新失敗 (${response.status}): ${body}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      id_token?: string;
      expires_in: number;
    };

    const accountId = data.id_token ? extractAccountId(data.id_token) : '';

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
      account_id: accountId,
    };
  }

  isExpired(tokens: OAuthTokens): boolean {
    return Date.now() >= tokens.expires_at - 60_000;
  }
}

let instance: OAuthService | null = null;

export function getOAuthService(): OAuthService {
  if (!instance) {
    instance = new OAuthService();
  }
  return instance;
}

export { OAuthService };
