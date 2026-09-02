'use strict';

const crypto = require('crypto');

/*
 * Central configuration.
 *
 * Everything here can be overridden with environment variables, but every
 * value has a safe default so the server runs with a plain `node server.js`
 * and no setup at all. Learners can change token lifetimes on the fly to
 * force 401 responses on demand (great for practising the refresh flow).
 */

function intFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

const config = {
  // Network
  host: process.env.HOST || '127.0.0.1',
  port: intFromEnv('PORT', 3000),

  // Secret used to sign JSON Web Tokens. In real life this would be a long
  // random value kept out of source control. If no value is configured, use a
  // fresh per-process secret so a published practice-project default cannot be
  // used to forge administrator tokens. Restarting invalidates old tokens.
  jwtSecret: process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex'),

  // Token lifetimes, in seconds.
  // Access tokens are deliberately short so learners frequently see the
  // 401 -> refresh -> retry cycle that real clients must handle.
  accessTokenTtl: intFromEnv('ACCESS_TOKEN_TTL', 15 * 60), // 15 minutes
  refreshTokenTtl: intFromEnv('REFRESH_TOKEN_TTL', 7 * 24 * 60 * 60), // 7 days

  // Static credentials for the two standalone auth-practice endpoints.
  apiKey: process.env.API_KEY || 'tbs_live_9c8b7a6d5e4f3210',
  basicAuthUser: process.env.BASIC_USER || 'basic_user',
  basicAuthPass: process.env.BASIC_PASS || 'basic_pass_123',

  // Rate limiting for the dedicated /api/limited endpoint.
  rateLimitMax: intFromEnv('RATE_LIMIT_MAX', 5), // requests
  rateLimitWindowMs: intFromEnv('RATE_LIMIT_WINDOW_MS', 10 * 1000), // per window
  loginRateLimitMax: intFromEnv('LOGIN_RATE_LIMIT_MAX', 20),
  loginIpRateLimitMax: intFromEnv('LOGIN_IP_RATE_LIMIT_MAX', 60),
  loginRateLimitWindowMs: intFromEnv('LOGIN_RATE_LIMIT_WINDOW_MS', 60 * 1000),

  // The seeded users, visible practice credentials, and reset endpoint are
  // intentionally local-only. Public binding requires an explicit opt-in.
  allowInsecurePublicDemo: process.env.ALLOW_INSECURE_PUBLIC_DEMO === 'true',

  // Default and maximum page size for list endpoints.
  defaultPageSize: intFromEnv('DEFAULT_PAGE_SIZE', 10),
  maxPageSize: intFromEnv('MAX_PAGE_SIZE', 100),

  // When true, request/response lines are printed to the console.
  logRequests: process.env.LOG_REQUESTS !== 'false',

  // Local AI assistant (Ollama). This integration never needs an API key.
  // Gemma 3 4B is lightweight and commonly already present on practice Macs.
  chatbotEnabled: process.env.CHATBOT_ENABLED !== 'false',
  ollamaUrl: (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, ''),
  chatbotModel: process.env.CHATBOT_MODEL || 'gemma3:4b',
  chatbotToolMode: process.env.CHATBOT_TOOL_MODE || 'auto',
  chatbotThink: process.env.CHATBOT_THINK === 'true',
  chatbotContextTokens: intFromEnv('CHATBOT_CONTEXT_TOKENS', 16384),
  chatbotTimeoutMs: intFromEnv('CHATBOT_TIMEOUT_MS', 120000),
  chatbotMaxToolRounds: intFromEnv('CHATBOT_MAX_TOOL_ROUNDS', 6),
  chatbotRateLimitMax: intFromEnv('CHATBOT_RATE_LIMIT_MAX', 20),
  chatbotRateLimitWindowMs: intFromEnv('CHATBOT_RATE_LIMIT_WINDOW_MS', 60 * 1000),
};

module.exports = config;
