import crypto from 'node:crypto';
import { OfficialSportWorldClient, OfficialSportWorldError } from './official';

export type SportWorldErrorCode = 'AUTH_FAILED' | 'TOKEN_EXPIRED' | 'VERIFY_REQUIRED' | 'NETWORK_ERROR' | 'API_ERROR' | 'RATE_LIMITED' | 'DATA_PARSE_ERROR' | 'CONFIG_ERROR' | 'UNKNOWN_ERROR';

export class SportWorldError extends Error {
  constructor(public readonly code: SportWorldErrorCode, message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'SportWorldError';
  }
}

export type SportWorldCredentials = { account: string; password: string };
export type SportWorldSession = { token: string; uid?: string; unid?: string };
export type SportWorldProgress = {
  semester?: string; completedRuns?: number; completedDistance?: number; targetRuns?: number; targetDistance?: number;
  status?: string; startsAt?: string; endsAt?: string;
};
export type SportWorldRun = {
  id: string; runDate?: string; startTime?: string; endTime?: string; distance: number; duration?: number;
  pace?: number; status?: string; rawStatus?: string; isValid: boolean; sportType?: string; semester?: string;
};

type ProxyEndpointName = 'SPORT_WORLD_LOGIN_URL' | 'SPORT_WORLD_VALIDATE_URL' | 'SPORT_WORLD_PROGRESS_URL' | 'SPORT_WORLD_HISTORY_URL';

const requiredProxyEndpoints: ProxyEndpointName[] = ['SPORT_WORLD_LOGIN_URL', 'SPORT_WORLD_PROGRESS_URL', 'SPORT_WORLD_HISTORY_URL'];

function provider(): 'official' | 'proxy' {
  const configuredProvider = process.env.SPORT_WORLD_PROVIDER?.trim().toLowerCase();
  if (configuredProvider && configuredProvider !== 'official' && configuredProvider !== 'proxy') {
    throw new SportWorldError('CONFIG_ERROR', '运动世界同步提供方配置无效，请使用 official 或 proxy');
  }
  const hasProxyEndpoint = requiredProxyEndpoints.some((name) => Boolean(process.env[name]?.trim()));
  if (configuredProvider === 'proxy' || hasProxyEndpoint) {
    const missing = requiredProxyEndpoints.filter((name) => !process.env[name]?.trim());
    if (missing.length) throw new SportWorldError('CONFIG_ERROR', '运动世界代理接口配置不完整，请联系管理员检查服务端配置');
    return 'proxy';
  }
  return 'official';
}

function endpoint(name: ProxyEndpointName) {
  const value = process.env[name];
  if (!value) throw new SportWorldError('CONFIG_ERROR', '运动世界代理接口配置不完整，请联系管理员检查服务端配置');
  return value;
}

function mapOfficialError(error: unknown): never {
  if (error instanceof OfficialSportWorldError) throw new SportWorldError(error.kind, error.message, error);
  throw error;
}

function valueAt(input: unknown, ...keys: string[]): unknown {
  if (!input || typeof input !== 'object') return undefined;
  const record = input as Record<string, unknown>;
  for (const key of keys) if (record[key] !== undefined && record[key] !== null) return record[key];
  return undefined;
}

function unwrap(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const direct = valueAt(input, 'data', 'result', 'body');
  if (direct && typeof direct === 'object') return direct;
  return input;
}

function classifyHttp(status: number, payload: unknown) {
  const message = String(valueAt(payload, 'message', 'msg', 'error') || '运动世界接口请求失败');
  const lower = message.toLowerCase();
  if (status === 401 || status === 403 || /token|登录|未登录|过期|认证/.test(lower)) return new SportWorldError('TOKEN_EXPIRED', '运动世界登录已过期');
  if (status === 429) return new SportWorldError('RATE_LIMITED', '运动世界请求过于频繁');
  return new SportWorldError('API_ERROR', message);
}

async function requestJson(url: string, init: RequestInit, allowRetry = true): Promise<unknown> {
  const timeout = Math.max(1000, Number(process.env.SPORT_WORLD_API_TIMEOUT_MS || 15000));
  let lastError: unknown;
  for (let attempt = 0; attempt <= (allowRetry ? 2 : 0); attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal, headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(init.headers || {}) } });
      const text = await response.text();
      let payload: unknown = {};
      try { payload = text ? JSON.parse(text) : {}; } catch { throw new SportWorldError('DATA_PARSE_ERROR', '运动世界返回了非 JSON 数据'); }
      if (!response.ok) {
        const error = classifyHttp(response.status, payload);
        if (error.code === 'RATE_LIMITED' || error.code === 'TOKEN_EXPIRED' || error.code === 'AUTH_FAILED') throw error;
        if (response.status >= 500 && attempt < (allowRetry ? 2 : 0)) { lastError = error; continue; }
        throw error;
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (error instanceof SportWorldError && !['NETWORK_ERROR'].includes(error.code)) throw error;
      if (attempt >= (allowRetry ? 2 : 0)) throw new SportWorldError('NETWORK_ERROR', '运动世界网络连接失败', error);
    } finally { clearTimeout(timer); }
  }
  throw lastError instanceof SportWorldError ? lastError : new SportWorldError('NETWORK_ERROR', '运动世界网络连接失败', lastError);
}

function text(input: unknown) { return input === undefined || input === null ? undefined : String(input); }
function number(input: unknown) { const n = Number(input); return Number.isFinite(n) ? n : undefined; }
function verifyRequired(payload: unknown) {
  const message = String(valueAt(payload, 'message', 'msg', 'error', 'statusText') || '');
  return /验证码|短信|设备验证|风控|确认|verify|captcha/i.test(message) || valueAt(payload, 'needVerify', 'need_verify', 'captcha') === true;
}
function tokenFrom(payload: unknown): SportWorldSession | null {
  const root = unwrap(payload);
  const token = text(valueAt(root, 'token', 'access_token', 'accessToken', 'jwt'));
  if (!token) return null;
  return { token, uid: text(valueAt(root, 'uid', 'userId', 'user_id')), unid: text(valueAt(root, 'unid', 'unidNo')) };
}

export class SportWorldClient {
  private readonly activeProvider: 'official' | 'proxy';
  private readonly official?: OfficialSportWorldClient;

  constructor(account?: string) {
    this.activeProvider = provider();
    if (this.activeProvider === 'official') this.official = new OfficialSportWorldClient(account);
  }

  async login(credentials: SportWorldCredentials): Promise<SportWorldSession> {
    if (this.official) {
      try { return await this.official.login(credentials.account, credentials.password); }
      catch (error) { mapOfficialError(error); }
    }
    let payload: unknown;
    try {
      payload = await requestJson(endpoint('SPORT_WORLD_LOGIN_URL'), { method: 'POST', body: JSON.stringify({ account: credentials.account, username: credentials.account, password: credentials.password }) }, false);
    } catch (error) {
      if (error instanceof SportWorldError && error.code === 'TOKEN_EXPIRED') throw new SportWorldError('AUTH_FAILED', '运动世界账号或密码错误', error);
      throw error;
    }
    if (verifyRequired(payload)) throw new SportWorldError('VERIFY_REQUIRED', '该账号需要额外验证');
    const session = tokenFrom(payload);
    if (!session) throw new SportWorldError('AUTH_FAILED', '运动世界账号或密码错误');
    return session;
  }

  async validateToken(session: SportWorldSession): Promise<boolean> {
    if (this.official) {
      try { return await this.official.validateToken(session); }
      catch (error) { mapOfficialError(error); }
    }
    if (!process.env.SPORT_WORLD_VALIDATE_URL) return true;
    try {
      const payload = await requestJson(endpoint('SPORT_WORLD_VALIDATE_URL'), { method: 'POST', headers: { Authorization: `Bearer ${session.token}` }, body: JSON.stringify({ token: session.token, uid: session.uid, unid: session.unid }) }, false);
      if (verifyRequired(payload)) throw new SportWorldError('VERIFY_REQUIRED', '该账号需要额外验证');
      const status = String(valueAt(unwrap(payload), 'valid', 'authenticated', 'success') ?? '').toLowerCase();
      return status === '' || status === 'true' || status === '1' || status === 'valid' || status === 'success';
    } catch (error) {
      if (error instanceof SportWorldError && ['TOKEN_EXPIRED', 'AUTH_FAILED'].includes(error.code)) return false;
      if (error instanceof SportWorldError) throw error;
      return false;
    }
  }

  async getSemesterProgress(session: SportWorldSession): Promise<SportWorldProgress> {
    if (this.official) {
      try { return await this.official.getSemesterProgress(session); }
      catch (error) { mapOfficialError(error); }
    }
    const payload = await requestJson(endpoint('SPORT_WORLD_PROGRESS_URL'), { method: 'POST', headers: { Authorization: `Bearer ${session.token}` }, body: JSON.stringify({ token: session.token, uid: session.uid, unid: session.unid }) });
    if (verifyRequired(payload)) throw new SportWorldError('VERIFY_REQUIRED', '该账号需要额外验证');
    const root = unwrap(payload);
    if (!root || typeof root !== 'object') throw new SportWorldError('DATA_PARSE_ERROR', '学期进度数据格式无法识别');
    return {
      semester: text(valueAt(root, 'semester', 'semesterName', 'term', 'currentSemester')),
      completedRuns: number(valueAt(root, 'completedRuns', 'validRuns', 'runCount', 'count', 'totalCount')),
      completedDistance: number(valueAt(root, 'completedDistance', 'validDistance', 'distance', 'totalDistance', 'totalKm')),
      targetRuns: number(valueAt(root, 'targetRuns', 'requiredRuns', 'orderCount')),
      targetDistance: number(valueAt(root, 'targetDistance', 'requiredDistance', 'totalRequiredDistance')),
      status: text(valueAt(root, 'status', 'completionStatus', 'result')),
      startsAt: text(valueAt(root, 'startTime', 'startsAt', 'semesterStart')),
      endsAt: text(valueAt(root, 'endTime', 'endsAt', 'semesterEnd')),
    };
  }

  async getRunHistory(session: SportWorldSession, page: number, pageSize: number, semester?: string): Promise<{ records: SportWorldRun[]; hasMore: boolean }> {
    if (this.official) {
      try { return await this.official.getRunHistory(session, page, pageSize, semester); }
      catch (error) { mapOfficialError(error); }
    }
    const payload = await requestJson(endpoint('SPORT_WORLD_HISTORY_URL'), { method: 'POST', headers: { Authorization: `Bearer ${session.token}` }, body: JSON.stringify({ token: session.token, uid: session.uid, unid: session.unid, page, pageNo: page, pageSize, size: pageSize, semester }) });
    if (verifyRequired(payload)) throw new SportWorldError('VERIFY_REQUIRED', '该账号需要额外验证');
    const root = unwrap(payload);
    const rawRecords = valueAt(root, 'records', 'list', 'rows', 'items') || (Array.isArray(root) ? root : undefined);
    if (!Array.isArray(rawRecords)) throw new SportWorldError('DATA_PARSE_ERROR', '跑步历史数据格式无法识别');
    const records = rawRecords.map((item) => this.parseRun(item, semester)).filter((item): item is SportWorldRun => Boolean(item));
    const total = number(valueAt(root, 'total', 'totalCount', 'count'));
    const explicitHasMore = valueAt(root, 'hasMore', 'has_more', 'more');
    return { records, hasMore: explicitHasMore === true || (explicitHasMore === undefined && ((total !== undefined && page * pageSize < total) || records.length >= pageSize)) };
  }

  private parseRun(input: unknown, semester?: string): SportWorldRun | null {
    if (!input || typeof input !== 'object') return null;
    const root = input as Record<string, unknown>;
    const distance = number(valueAt(root, 'distance', 'distanceKm', 'kilometers', 'km', 'mileage'));
    const startTime = text(valueAt(root, 'startTime', 'start_time', 'beginTime', 'runTime', 'date'));
    if (distance === undefined && !startTime) return null;
    const status = text(valueAt(root, 'status', 'state', 'auditStatus', 'result'));
    const validValue = valueAt(root, 'isValid', 'valid', 'is_valid', 'counted');
    const isValid = validValue === true || validValue === 1 || /有效|通过|成功|完成|valid|pass|success|completed/i.test(status || '');
    const stable = text(valueAt(root, 'id', 'recordId', 'record_id', 'runId', 'uuid')) || crypto.createHash('sha256').update(`${startTime || ''}|${distance || 0}|${text(valueAt(root, 'sportType', 'type')) || ''}|${semester || ''}`).digest('hex');
    return { id: stable, runDate: text(valueAt(root, 'runDate', 'run_date', 'date')), startTime, endTime: text(valueAt(root, 'endTime', 'end_time', 'finishTime')), distance: Math.max(0, distance || 0), duration: number(valueAt(root, 'duration', 'durationSeconds', 'seconds')), pace: number(valueAt(root, 'pace', 'paceSeconds')), status, rawStatus: status, isValid, sportType: text(valueAt(root, 'sportType', 'sport_type', 'type')), semester: text(valueAt(root, 'semester', 'term')) || semester };
  }
}
