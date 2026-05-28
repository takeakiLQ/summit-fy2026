/**
 * Salesforce OAuth 2.0 トークン取得
 *
 * 2種類の認証フローをサポート（SF_AUTH_TYPE で切替）:
 *   - username_password : Username/Password Flow（simple_salesforce相当）
 *   - client_credentials: Client Credentials Flow（server-to-server、My Domain必須）
 */
import { env, debug } from './config.js';

export interface SalesforceToken {
  accessToken: string;
  instanceUrl: string;
  tokenType: string;
  issuedAt: string;
}

interface RawTokenResponse {
  access_token: string;
  instance_url: string;
  id?: string;
  token_type: string;
  issued_at: string;
}

interface RawErrorResponse {
  error?: string;
  error_description?: string;
}

async function postToken(tokenUrl: string, body: URLSearchParams): Promise<SalesforceToken> {
  debug('POST', tokenUrl);
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });
  const text = await res.text();
  let json: RawTokenResponse | RawErrorResponse;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Salesforce 認証エンドポイントがJSONを返しませんでした。HTTP ${res.status}\n${text.slice(0, 500)}`);
  }
  if (!res.ok) {
    const err = json as RawErrorResponse;
    throw new Error(`Salesforce 認証失敗 (HTTP ${res.status}): ${err.error ?? 'unknown'} - ${err.error_description ?? text}`);
  }
  const ok = json as RawTokenResponse;
  return {
    accessToken: ok.access_token,
    instanceUrl: env.SF_INSTANCE_URL || ok.instance_url,
    tokenType: ok.token_type,
    issuedAt: new Date(Number(ok.issued_at)).toISOString(),
  };
}

async function getTokenUsernamePassword(): Promise<SalesforceToken> {
  const tokenUrl = env.SF_LOGIN_URL.replace(/\/+$/, '') + '/services/oauth2/token';
  const passwordWithToken = env.SF_PASSWORD + env.SF_SECURITY_TOKEN;
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: env.SF_CLIENT_ID,
    client_secret: env.SF_CLIENT_SECRET,
    username: env.SF_USERNAME,
    password: passwordWithToken,
  });
  return postToken(tokenUrl, body);
}

async function getTokenClientCredentials(): Promise<SalesforceToken> {
  const tokenUrl = env.SF_LOGIN_URL.replace(/\/+$/, '') + '/services/oauth2/token';
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: env.SF_CLIENT_ID,
    client_secret: env.SF_CLIENT_SECRET,
  });
  return postToken(tokenUrl, body);
}

export async function getAccessToken(): Promise<SalesforceToken> {
  const authType = env.SF_AUTH_TYPE;
  debug('SF_AUTH_TYPE:', authType);
  if (authType === 'username_password') return getTokenUsernamePassword();
  if (authType === 'client_credentials') return getTokenClientCredentials();
  throw new Error('SF_AUTH_TYPE が不正です: "' + authType + '". username_password または client_credentials を指定してください。');
}
