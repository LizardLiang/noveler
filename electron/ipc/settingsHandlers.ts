import { ipcMain } from 'electron';
import { IPC_CHANNELS } from './channels.js';
import { getConfigService } from '../main/services/ConfigService.js';
import { getCryptoService } from '../main/services/CryptoService.js';
import { getGlobalDatabase } from '../main/services/database.js';
import { getOAuthService } from '../main/services/OAuthService.js';
import { v4 as uuidv4 } from 'uuid';
import type { IpcResult, SaveProviderRequest, ProviderInfo, GlobalConfig, AuthMethod, OAuthTokens } from '../shared/types.js';

export function registerSettingsHandlers(): void {
  const configService = getConfigService();
  const cryptoService = getCryptoService();

  // Get global settings
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, (): IpcResult<GlobalConfig> => {
    try {
      return { success: true, data: configService.getAll() };
    } catch (err) {
      return {
        success: false,
        error: { code: 'SETTINGS_READ_ERROR', message: '讀取設定失敗', details: err },
      };
    }
  });

  // Set a specific setting key
  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_SET,
    (_event, key: keyof GlobalConfig, value: GlobalConfig[keyof GlobalConfig]): IpcResult<void> => {
      try {
        configService.set(key, value);
        return { success: true, data: undefined };
      } catch (err) {
        return {
          success: false,
          error: { code: 'SETTINGS_WRITE_ERROR', message: '儲存設定失敗', details: err },
        };
      }
    },
  );

  // Get all AI providers (without decrypted keys)
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_PROVIDERS, (): IpcResult<ProviderInfo[]> => {
    try {
      const db = getGlobalDatabase();
      const rows = db
        .prepare('SELECT id, provider_type, auth_method, base_url, default_model, is_active, api_key_encrypted FROM ai_providers ORDER BY created_at ASC')
        .all() as {
        id: string;
        provider_type: string;
        auth_method: string;
        base_url: string;
        default_model: string;
        is_active: number;
        api_key_encrypted: string;
      }[];

      const providers: ProviderInfo[] = rows.map(row => {
        const authMethod = (String(row.auth_method) || 'api_key') as AuthMethod;
        let oauthEmail: string | undefined;
        if (authMethod === 'oauth') {
          try {
            const encrypted = Buffer.from(String(row.api_key_encrypted), 'base64');
            const decrypted = cryptoService.decrypt(encrypted);
            const tokens = JSON.parse(decrypted) as OAuthTokens & { email?: string };
            oauthEmail = tokens.email;
          } catch { /* ignore */ }
        }
        return {
          id: String(row.id),
          providerType: String(row.provider_type) as ProviderInfo['providerType'],
          authMethod,
          baseUrl: String(row.base_url),
          defaultModel: String(row.default_model),
          isActive: row.is_active === 1,
          hasApiKey: true,
          oauthEmail,
        };
      });

      return { success: true, data: providers };
    } catch (err) {
      return {
        success: false,
        error: { code: 'PROVIDER_READ_ERROR', message: '讀取供應商設定失敗', details: err },
      };
    }
  });

  // Save (create or update) an AI provider
  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_SAVE_PROVIDER,
    (_event, req: SaveProviderRequest): IpcResult<ProviderInfo> => {
      try {
        const db = getGlobalDatabase();
        const id = req.id ?? uuidv4();
        const authMethod = req.authMethod ?? 'api_key';
        const hasNewKey = req.apiKey && req.apiKey !== '__KEEP_EXISTING__';

        if (req.id) {
          if (hasNewKey) {
            const encryptedKey = cryptoService.encrypt(req.apiKey).toString('base64');
            db.prepare(
              `UPDATE ai_providers SET provider_type=?, auth_method=?, api_key_encrypted=?, base_url=?, default_model=?,
               updated_at=datetime('now') WHERE id=?`,
            ).run(req.providerType, authMethod, encryptedKey, req.baseUrl, req.defaultModel, req.id);
          } else {
            db.prepare(
              `UPDATE ai_providers SET provider_type=?, auth_method=?, base_url=?, default_model=?,
               updated_at=datetime('now') WHERE id=?`,
            ).run(req.providerType, authMethod, req.baseUrl, req.defaultModel, req.id);
          }
        } else {
          const encryptedKey = cryptoService.encrypt(req.apiKey).toString('base64');
          db.prepare(
            `INSERT INTO ai_providers (id, provider_type, auth_method, api_key_encrypted, base_url, default_model, is_active)
             VALUES (?, ?, ?, ?, ?, ?, 0)`,
          ).run(id, req.providerType, authMethod, encryptedKey, req.baseUrl, req.defaultModel);
        }

        return {
          success: true,
          data: {
            id,
            providerType: req.providerType,
            authMethod,
            baseUrl: req.baseUrl,
            defaultModel: req.defaultModel,
            isActive: false,
            hasApiKey: true,
          },
        };
      } catch (err) {
        return {
          success: false,
          error: { code: 'PROVIDER_SAVE_ERROR', message: '儲存供應商設定失敗', details: err },
        };
      }
    },
  );

  // Delete an AI provider
  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_DELETE_PROVIDER,
    (_event, id: string): IpcResult<void> => {
      try {
        const db = getGlobalDatabase();
        db.prepare('DELETE FROM ai_providers WHERE id=?').run(id);
        return { success: true, data: undefined };
      } catch (err) {
        return {
          success: false,
          error: { code: 'PROVIDER_DELETE_ERROR', message: '刪除供應商失敗', details: err },
        };
      }
    },
  );

  // Set active provider
  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_SET_ACTIVE_PROVIDER,
    (_event, id: string): IpcResult<void> => {
      try {
        const db = getGlobalDatabase();
        // Deactivate all
        db.prepare('UPDATE ai_providers SET is_active=0').run();
        // Activate target
        db.prepare('UPDATE ai_providers SET is_active=1 WHERE id=?').run(id);
        // Update config
        configService.set('activeProviderId', id);
        return { success: true, data: undefined };
      } catch (err) {
        return {
          success: false,
          error: { code: 'PROVIDER_ACTIVATE_ERROR', message: '設定供應商失敗', details: err },
        };
      }
    },
  );

  // OAuth: request device code (step 1)
  ipcMain.handle(
    IPC_CHANNELS.OAUTH_REQUEST_CODE,
    async (): Promise<IpcResult<{ userCode: string; deviceAuthId: string; verificationUrl: string }>> => {
      try {
        const oauthService = getOAuthService();
        const codeInfo = await oauthService.requestDeviceCode();
        return { success: true, data: codeInfo };
      } catch (err) {
        const message = err instanceof Error ? err.message : '未知錯誤';
        return {
          success: false,
          error: { code: 'OAUTH_CODE_ERROR', message: `取得裝置代碼失敗：${message}`, details: err },
        };
      }
    },
  );

  // OAuth: poll for authorization (step 2 — long-running, blocks until auth or timeout)
  ipcMain.handle(
    IPC_CHANNELS.OAUTH_POLL,
    async (_event, deviceAuthId: string, userCode: string): Promise<IpcResult<{ providerId: string; email?: string }>> => {
      try {
        const oauthService = getOAuthService();
        const result = await oauthService.pollForAuthorization(deviceAuthId, userCode);

        if (!result.success || !result.tokens) {
          return {
            success: false,
            error: { code: 'OAUTH_FAILED', message: result.error ?? 'OAuth 登入失敗' },
          };
        }

        const db = getGlobalDatabase();
        const id = uuidv4();
        const tokenBlob = JSON.stringify({ ...result.tokens, email: result.email });
        const encrypted = cryptoService.encrypt(tokenBlob).toString('base64');

        db.prepare(
          `INSERT INTO ai_providers (id, provider_type, auth_method, api_key_encrypted, base_url, default_model, is_active)
           VALUES (?, 'openai', 'oauth', ?, 'https://api.openai.com/v1', 'gpt-4o', 0)`,
        ).run(id, encrypted);

        return { success: true, data: { providerId: id, email: result.email } };
      } catch (err) {
        const message = err instanceof Error ? err.message : '未知錯誤';
        return {
          success: false,
          error: { code: 'OAUTH_ERROR', message: `OAuth 錯誤：${message}`, details: err },
        };
      }
    },
  );

  // OAuth: cancel polling
  ipcMain.handle(
    IPC_CHANNELS.OAUTH_CANCEL,
    (): IpcResult<void> => {
      const oauthService = getOAuthService();
      oauthService.cancelAuth();
      return { success: true, data: undefined };
    },
  );

  // OAuth: check token status
  ipcMain.handle(
    IPC_CHANNELS.OAUTH_STATUS,
    (_event, providerId: string): IpcResult<{ valid: boolean; email?: string; expiresAt?: number }> => {
      try {
        const db = getGlobalDatabase();
        const row = db.prepare(
          'SELECT api_key_encrypted, auth_method FROM ai_providers WHERE id=?',
        ).get(providerId) as { api_key_encrypted: string; auth_method: string } | undefined;

        if (!row || String(row.auth_method) !== 'oauth') {
          return { success: false, error: { code: 'NOT_OAUTH', message: '此供應商不是 OAuth 類型' } };
        }

        const encrypted = Buffer.from(String(row.api_key_encrypted), 'base64');
        const decrypted = cryptoService.decrypt(encrypted);
        const tokens = JSON.parse(decrypted) as OAuthTokens & { email?: string };

        const oauthService = getOAuthService();
        const valid = !oauthService.isExpired(tokens);

        return {
          success: true,
          data: { valid, email: tokens.email, expiresAt: tokens.expires_at },
        };
      } catch (err) {
        return {
          success: false,
          error: { code: 'OAUTH_STATUS_ERROR', message: '檢查 OAuth 狀態失敗', details: err },
        };
      }
    },
  );

  // OAuth: revoke (clear tokens, delete provider)
  ipcMain.handle(
    IPC_CHANNELS.OAUTH_REVOKE,
    (_event, providerId: string): IpcResult<void> => {
      try {
        const db = getGlobalDatabase();
        db.prepare('DELETE FROM ai_providers WHERE id=? AND auth_method=?').run(providerId, 'oauth');
        return { success: true, data: undefined };
      } catch (err) {
        return {
          success: false,
          error: { code: 'OAUTH_REVOKE_ERROR', message: '撤銷 OAuth 失敗', details: err },
        };
      }
    },
  );
}

// Helper: get decrypted API key for active provider (internal use by main process)
export function getActiveProviderApiKey(): string | null {
  try {
    const db = getGlobalDatabase();
    const row = db
      .prepare('SELECT api_key_encrypted FROM ai_providers WHERE is_active=1 LIMIT 1')
      .get() as { api_key_encrypted: string } | undefined;
    if (!row) return null;
    const encrypted = Buffer.from(String(row.api_key_encrypted), 'base64');
    return getCryptoService().decrypt(encrypted);
  } catch {
    return null;
  }
}
