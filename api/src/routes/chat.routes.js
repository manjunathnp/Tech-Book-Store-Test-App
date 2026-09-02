'use strict';

const crypto = require('crypto');
const config = require('../config');
const { ApiError, ValidationError } = require('../lib/errors');
const { optionalAuth } = require('../middleware/authenticate');
const { buildSystemPrompt } = require('../chat/system-prompt');
const { getOllamaStatus, runConfiguredAgent } = require('../chat/ollama');
const { TOOL_DEFINITIONS, createToolExecutor, runDeterministicCommand } = require('../chat/tools');
const { protectAssistantOutput, scopeResponseFor, securityResponseFor } = require('../chat/security');

const sessions = new Map();
const rateBuckets = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000;
const CONFIGURED_STATUS_GRACE_MS = 60 * 1000;
const MAX_HISTORY_MESSAGES = 14;
const SESSION_ID_RE = /^[a-zA-Z0-9_-]{16,80}$/;
let lastConfiguredAt = 0;

function resetChatState() {
  sessions.clear();
  rateBuckets.clear();
  lastConfiguredAt = 0;
}

async function configuredStatusForMessage() {
  const status = await getOllamaStatus();
  if (status.online && status.modelInstalled) {
    lastConfiguredAt = Date.now();
    return status;
  }
  if (lastConfiguredAt && Date.now() - lastConfiguredAt <= CONFIGURED_STATUS_GRACE_MS) {
    return Object.assign({}, status, { online: true, modelInstalled: true, transientGrace: true });
  }
  return status;
}

function cleanExpiredSessions() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [key, session] of sessions.entries()) {
    if (session.updatedAt < cutoff) sessions.delete(key);
  }
}

function clientKey(ctx) {
  return String(ctx.req.socket && ctx.req.socket.remoteAddress || 'local');
}

function checkRateLimit(ctx) {
  const key = clientKey(ctx);
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= config.chatbotRateLimitWindowMs) {
    bucket = { startedAt: now, count: 0 };
    rateBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > config.chatbotRateLimitMax) {
    const retry = Math.max(1, Math.ceil((config.chatbotRateLimitWindowMs - (now - bucket.startedAt)) / 1000));
    const error = new ApiError(429, 'CHAT_RATE_LIMITED', 'Too many chatbot messages. Please wait a moment and try again.');
    error.headers['Retry-After'] = String(retry);
    throw error;
  }
}

function validateChatBody(body) {
  const details = [];
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) details.push({ field: 'message', message: 'A message is required.', code: 'required' });
  if (message.length > 2000) details.push({ field: 'message', message: 'Message must be 2,000 characters or fewer.', code: 'max' });
  if (body.sessionId !== undefined && !SESSION_ID_RE.test(String(body.sessionId))) {
    details.push({ field: 'sessionId', message: 'sessionId is invalid.', code: 'format' });
  }
  if (details.length) throw new ValidationError(details);
  return message;
}

function sessionKey(ctx, sessionId) {
  const owner = ctx.user ? `user:${ctx.user.id}` : `anon:${clientKey(ctx)}`;
  return `${owner}:${sessionId}`;
}

function configurationResponse(ctx, sessionId) {
  ctx.json(200, {
    sessionId,
    message: 'Just configure to use.',
    configured: false,
    local: true,
  });
}

function registerChatRoutes(router) {
  router.get('/api/chat/status', async (ctx) => {
    if (!config.chatbotEnabled) {
      ctx.json(200, {
        provider: 'ollama-local', requiresApiKey: false, model: null,
        online: false, modelInstalled: false, configured: false,
      });
      return;
    }
    const status = await configuredStatusForMessage();
    ctx.json(200, {
      provider: 'ollama-local',
      requiresApiKey: false,
      model: status.model,
      online: status.online,
      modelInstalled: status.modelInstalled,
      configured: status.online && status.modelInstalled,
    });
  });

  router.post('/api/chat', optionalAuth, async (ctx) => {
    const message = validateChatBody(ctx.body || {});
    const sessionId = ctx.body.sessionId || crypto.randomBytes(18).toString('base64url');
    if (!config.chatbotEnabled) {
      configurationResponse(ctx, sessionId);
      return;
    }
    const status = await configuredStatusForMessage();
    if (!status.online || !status.modelInstalled) {
      configurationResponse(ctx, sessionId);
      return;
    }
    checkRateLimit(ctx);
    const securityResponse = securityResponseFor(message);
    if (securityResponse) {
      ctx.json(200, {
        sessionId,
        message: securityResponse,
        model: config.chatbotModel,
        configured: true,
        local: true,
      });
      return;
    }
    const scopeResponse = scopeResponseFor(message);
    if (scopeResponse) {
      ctx.json(200, {
        sessionId,
        message: scopeResponse,
        model: config.chatbotModel,
        configured: true,
        local: true,
      });
      return;
    }
    cleanExpiredSessions();
    const key = sessionKey(ctx, sessionId);
    const session = sessions.get(key) || { history: [], bookContext: [], updatedAt: Date.now() };
    if (!Array.isArray(session.bookContext)) session.bookContext = [];
    const modelMessages = [
      { role: 'system', content: buildSystemPrompt(ctx.user) },
      ...session.history,
      { role: 'user', content: message },
    ];
    const executeTool = createToolExecutor(router, ctx, {
      userMessage: message,
      bookContext: session.bookContext,
    });
    let result;
    try {
      result = await runDeterministicCommand(message, executeTool, session.bookContext);
      if (!result) {
        result = await runConfiguredAgent(modelMessages, TOOL_DEFINITIONS, executeTool, undefined, {
          verifiedBookIds: session.bookContext.map((book) => book.id),
        });
      }
    } catch (error) {
      if (error instanceof ApiError && [
        'OLLAMA_UNAVAILABLE', 'CHAT_MODEL_NOT_INSTALLED', 'OLLAMA_ERROR', 'CHAT_TIMEOUT',
      ].includes(error.code)) {
        configurationResponse(ctx, sessionId);
        return;
      }
      throw error;
    }
    const protectedContent = protectAssistantOutput(result.content);
    session.history.push({ role: 'user', content: message });
    session.history.push({ role: 'assistant', content: protectedContent });
    if (session.history.length > MAX_HISTORY_MESSAGES) {
      session.history = session.history.slice(-MAX_HISTORY_MESSAGES);
    }
    session.updatedAt = Date.now();
    sessions.set(key, session);
    const response = {
      sessionId,
      message: protectedContent,
      model: config.chatbotModel,
      configured: true,
      local: true,
    };
    if (result.clientAction) response.clientAction = result.clientAction;
    ctx.json(200, response);
  });

  router.delete('/api/chat/session/:sessionId', optionalAuth, (ctx) => {
    if (!SESSION_ID_RE.test(String(ctx.params.sessionId))) {
      throw new ValidationError([{ field: 'sessionId', message: 'sessionId is invalid.', code: 'format' }]);
    }
    sessions.delete(sessionKey(ctx, ctx.params.sessionId));
    ctx.noContent();
  });
}

module.exports = { registerChatRoutes, resetChatState };
