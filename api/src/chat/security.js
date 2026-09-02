'use strict';

const config = require('../config');

const SAFE_REDIRECT = 'I can help with verified books, authors, categories, prices, availability, your cart, and your own orders.';

function normalized(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

const ATTACK_PATTERNS = [
  /\bignore\b.{0,80}\b(?:previous|prior|system|developer|hidden)\b.{0,40}\b(?:instruction|message|prompt|rule)s?\b/i,
  /\b(?:forget|disregard|override|supersede)\b.{0,80}\b(?:instruction|prompt|rule|safety|policy|guardrail)s?\b/i,
  /\b(?:reveal|show|print|repeat|dump|expose|return|tell)\b.{0,100}\b(?:system prompt|developer message|hidden instructions?|api keys?|access tokens?|refresh tokens?|database passwords?|environment variables?|secret keys?|jwt secrets?)\b/i,
  /\b(?:bypass|skip|disable|evade|break)\b.{0,80}\b(?:authentication|authorization|payment|security|permission|access control)\b/i,
  /\b(?:make|grant|promote|switch)\b.{0,60}\b(?:me|my account|user)\b.{0,30}\badmin\b/i,
  /\b(?:act as|pretend to be|enter|enable)\b.{0,50}\b(?:admin|administrator|root|developer mode|god mode)\b/i,
  /\b(?:another|other|someone else'?s?)\b.{0,60}\b(?:user|customer)\b.{0,80}\b(?:cart|order|address|account|data|profile|payment)\b/i,
  /\b(?:cart|orders?|address|account|data|profile|payment)\b.{0,80}\b(?:another|other|someone else'?s?)\b.{0,50}\b(?:user|customer)\b/i,
  /\b(?:user|customer)\s*id\s*[:=#]?\s*\d+\b.{0,80}\b(?:cart|order|address|account|profile|payment)\b/i,
  /\b(?:run|execute)\b.{0,30}\b(?:sql|shell|terminal|command|script)\b/i,
  /\b(?:drop|truncate|delete|erase|destroy)\b.{0,60}\b(?:database|table|users?|customers?|orders?|books?)\b/i,
  /\b(?:change|set|make)\b.{0,60}\b(?:price|discount)\b.{0,40}\b(?:free|zero|unauthori[sz]ed|without permission)\b/i,
  /\b(?:change|set|override|edit)\b.{0,50}\bprice\b.{0,30}(?:₹|\$|\binr\b|\b\d+(?:\.\d+)?\b)/i,
  /\b(?:decode|deobfuscate)\b.{0,60}\b(?:base64|hex)\b.{0,80}\b(?:execute|follow|obey|run)\b/i,
  /\bunion\s+select\b|(?:'|%27)\s*or\s+1\s*=\s*1|;\s*(?:drop|truncate|delete)\b/i,
  /(?:\.\.\/){2,}|\/etc\/(?:passwd|shadow)|169\.254\.169\.254/i,
  /<\s*script\b|javascript\s*:|onerror\s*=|onload\s*=/i,
];

function securityResponseFor(message) {
  const text = normalized(message);
  if (!ATTACK_PATTERNS.some((pattern) => pattern.test(text))) return null;
  return `I can’t help reveal hidden instructions or credentials, access another customer’s data, bypass security or payment, run commands, or perform unauthorized changes. ${SAFE_REDIRECT}`;
}

const OUT_OF_SCOPE_PATTERNS = [
  /\b(?:weather|forecast|temperature)\b/i,
  /\b(?:football|cricket|basketball|sports? score|match result)\b/i,
  /\b(?:book|reserve|find)\b.{0,40}\b(?:flight|hotel|taxi|cab)\b/i,
  /\b(?:tell|write|make)\b.{0,30}\b(?:joke|poem|essay|song|story)\b/i,
  /\b(?:write|build|create|deploy)\b.{0,50}\b(?:malware|ransomware|keylogger|credential stealer|phishing kit|botnet)\b/i,
];

function scopeResponseFor(message) {
  const text = normalized(message);
  if (/\b(?:books?\s+(?:about|on|for)|find\s+(?:me\s+)?books?|show\s+(?:me\s+)?books?)\b/i.test(text)) return null;
  if (!OUT_OF_SCOPE_PATTERNS.some((pattern) => pattern.test(text))) return null;
  return `I’m here to help with the Tech Bookstore. ${SAFE_REDIRECT}`;
}

function protectAssistantOutput(content) {
  const text = String(content || '').normalize('NFKC').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  const comparable = normalized(text);
  const secrets = [
    config.jwtSecret,
    config.apiKey,
    config.basicAuthPass,
    'techbookstore-practice-secret-do-not-use-in-production',
  ].filter((value) => typeof value === 'string' && value.length >= 8);
  const leakedSecret = secrets.some((secret) => comparable.includes(secret));
  const leakedPrompt = /You are the Tech Book Store assistant, a conversational interface over this application/i.test(comparable)
    || /STRUCTURED APPLICATION ORCHESTRATION[\s\S]*AVAILABLE TOOLS/i.test(comparable);
  if (leakedSecret || leakedPrompt) {
    return `I can’t provide hidden instructions, credentials, or internal configuration. ${SAFE_REDIRECT}`;
  }
  return text;
}

module.exports = { protectAssistantOutput, scopeResponseFor, securityResponseFor };
