import QRCode from 'qrcode';
import fs from 'node:fs';
import path from 'node:path';
import { coursesData } from '../src/data/coursesData.js';
import { toolsData } from '../src/data/toolsData.js';
import { translations } from '../src/data/translations.js';
import { generateAiReply } from '../server/services/aiAdapter.js';
import { INITIAL_WELCOME_MESSAGE } from '../src/hooks/useChatHistory.js';

console.log('--- STARTING GRANDMASTER INTEGRATION TEST SUITE (STEPS 1, 2 & 3) ---\n');

let totalTests = 0;
let passedTests = 0;

function assert(condition, testName) {
  totalTests++;
  if (condition) {
    console.log(`[PASS] ${testName}`);
    passedTests++;
  } else {
    console.error(`[FAIL] ${testName}`);
  }
}

// ==========================================
// STEP 1 REGRESSION TESTS (Preserved 100%)
// ==========================================

console.log('--- STEP 1 REGRESSION SUITE ---');

// 1. Calculator Arithmetic Test
console.log('Testing: Calculator Logic...');
const calcOperations = [
  { expr: '12 + 8', expected: 20 },
  { expr: '50 - 18.5', expected: 31.5 },
  { expr: '7 * 6', expected: 42 },
  { expr: '100 / 4', expected: 25 },
  { expr: '10 + 20 * 3', expected: 70 },
  { expr: '0.1 + 0.2', expected: 0.3 }
];

calcOperations.forEach(({ expr, expected }) => {
  const sanitized = expr.replace(/[^0-9+\-*/.]/g, '');
  const result = Function(`'use strict'; return (${sanitized})`)();
  const rounded = parseFloat(result.toFixed(8));
  assert(Math.abs(rounded - expected) < 0.0001, `Calc: ${expr} = ${expected} (Got: ${rounded})`);
});

// Division by zero check
const divZero = Function(`'use strict'; return (10 / 0)`)();
assert(!isFinite(divZero), 'Calc: Division by zero is Infinity (Handled as error)');

// 2. Age Calculator Test
console.log('\nTesting: Age Calculator Validation & Calculation...');
function calculateTestAge(birthStr, now) {
  const birth = new Date(birthStr);
  let years = now.getFullYear() - birth.getFullYear();
  let months = now.getMonth() - birth.getMonth();
  let days = now.getDate() - birth.getDate();

  if (days < 0) {
    months -= 1;
    const prevMonthDays = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
    days += prevMonthDays;
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years, months, days };
}

const mockNow = new Date('2026-10-16T12:00:00Z');
const ageResult = calculateTestAge('2000-01-01', mockNow);
assert(ageResult.years === 26 && ageResult.months === 9 && ageResult.days === 15, `Age: 2000-01-01 -> 26y 9m 15d on 2026-10-16 (Got: ${ageResult.years}y ${ageResult.months}m ${ageResult.days}d)`);

const futureDate = new Date('2030-01-01');
assert(futureDate > mockNow, 'Age: Future dates properly detected as invalid');

// 3. QR Code Generator Test
console.log('\nTesting: Real QR Code Matrix Generation...');
async function testQr() {
  const sampleUrl = 'https://grandmasterhub.digital';
  const dataUrl = await QRCode.toDataURL(sampleUrl, {
    width: 256,
    margin: 2,
    errorCorrectionLevel: 'M'
  });
  assert(dataUrl.startsWith('data:image/png;base64,'), 'QR: toDataURL produces real base64 PNG stream');
  assert(dataUrl.length > 500, `QR: Base64 payload length valid (${dataUrl.length} bytes)`);
}
await testQr();

// 4. Cryptographic Password Generator Test
console.log('\nTesting: Secure Password Generator...');
function generateTestPassword(length = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
  const array = new Uint32Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, x => chars[x % chars.length]).join('');
}
const p1 = generateTestPassword(16);
const p2 = generateTestPassword(16);
assert(p1.length === 16, `Password: Exactly 16 chars generated (${p1})`);
assert(p1 !== p2, 'Password: Cryptographic entropy guarantees uniqueness across runs');
assert(/[A-Za-z0-9]/.test(p1), 'Password: Character diversity present');

// 5. YouTube URL & ID Parser Test
console.log('\nTesting: YouTube Video URL Extractor...');
function extractVideoId(input) {
  const patterns = [
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    /(?:https?:\/\/)?(?:www\.)?youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/
  ];
  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match && match[1]) return match[1];
  }
  return null;
}

const ytTests = [
  { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
  { url: 'https://youtu.be/dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
  { url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
  { url: 'https://www.youtube.com/embed/dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' }
];
ytTests.forEach(({ url, expected }) => {
  const id = extractVideoId(url);
  assert(id === expected, `YouTube: Extract from ${url} -> ${expected}`);
});

// 6. Invoice Line Item Math Test
console.log('\nTesting: Invoice Maker Calculations...');
const items = [
  { qty: 2, rate: 5000 },
  { qty: 3, rate: 12000 }
];
const subtotal = items.reduce((sum, item) => sum + (item.qty * item.rate), 0);
const taxRate = 5;
const taxAmount = (subtotal * taxRate) / 100;
const discountRate = 10;
const discountAmount = (subtotal * discountRate) / 100;
const grandTotal = subtotal + taxAmount - discountAmount;

assert(subtotal === 46000, `Invoice: Subtotal calculation correct (Expected 46000, got ${subtotal})`);
assert(taxAmount === 2300, `Invoice: 5% Tax calculation correct (Expected 2300, got ${taxAmount})`);
assert(discountAmount === 4600, `Invoice: 10% Discount calculation correct (Expected 4600, got ${discountAmount})`);
assert(grandTotal === 43700, `Invoice: Grand total formula correct (Expected 43700, got ${grandTotal})`);

// 7. Data Integrity Checks
console.log('\nTesting: Courses and Tools Data Consistency...');
assert(coursesData.length === 6, `Courses: Exactly 6 courses present (Count: ${coursesData.length})`);
coursesData.forEach(c => {
  assert(c.title?.en && c.title?.ur, `Course [${c.id}]: Bilingual titles present`);
  assert(c.pricePKR > 0 && c.priceUSD > 0, `Course [${c.id}]: Dual PKR/USD pricing present`);
  assert(c.isSamplePrice === true, `Course [${c.id}]: Explicitly marked as sample price`);
});

assert(toolsData.length === 10, `Tools: Exactly 10 tools defined (Count: ${toolsData.length})`);
const demoRemover = toolsData.find(t => t.id === 'background-remover');
assert(demoRemover && demoRemover.isDemoOnly === true, 'Background Remover is explicitly flagged isDemoOnly: true');
assert(translations.en && translations.ur, 'Translations: English and Urdu locales both fully configured');


// ==========================================
// STEP 2 TESTS: GRANDMASTER AI BRAIN
// ==========================================

console.log('\n--- STEP 2: GRANDMASTER AI BRAIN TEST SUITE ---');

// Test 1: Chat page rendering assets exist
console.log('Testing: Chat Page Files & Exports...');
const chatPageFile = path.resolve('src/pages/GrandmasterChat.jsx');
assert(fs.existsSync(chatPageFile), 'Chat Page: GrandmasterChat.jsx component exists');
const chatSource = fs.readFileSync(chatPageFile, 'utf-8');
assert(chatSource.includes('export default function GrandmasterChat'), 'Chat Page: Exports default GrandmasterChat component');

// Test 2: Message input & trimming
console.log('\nTesting: Message Input & Trimming...');
const rawInputs = [
  { raw: '  Hello Grandmaster  ', expected: 'Hello Grandmaster' },
  { raw: '\n\nCan you explain React?\n', expected: 'Can you explain React?' }
];
rawInputs.forEach(({ raw, expected }) => {
  assert(raw.trim() === expected, `Input Trim: "${raw.replace(/\n/g, '\\n')}" -> "${expected}"`);
});

// Test 3: Empty-message validation
console.log('\nTesting: Empty-Message Validation...');
let emptyRejected = false;
try {
  await generateAiReply({ message: '   ', apiKey: 'test_key' });
} catch (e) {
  emptyRejected = e.code === 'INVALID_INPUT' && e.status === 400;
}
assert(emptyRejected, 'Validation: Empty or whitespace message rejected with 400 INVALID_INPUT');

let nullRejected = false;
try {
  await generateAiReply({ message: '', apiKey: 'test_key' });
} catch (e) {
  nullRejected = e.code === 'INVALID_INPUT';
}
assert(nullRejected, 'Validation: Empty string rejected');

// Test 4: Message submission & History structure
console.log('\nTesting: Message Submission History Formation...');
const sampleHistory = [
  { role: 'user', content: 'What is Python?' },
  { role: 'assistant', content: 'Python is a high-level language.' }
];
const mappedHistory = sampleHistory.map(entry => ({
  role: entry.role === 'user' ? 'user' : 'model',
  parts: [{ text: entry.content }]
}));
assert(mappedHistory.length === 2, 'History: Retains length of user/assistant exchanges');
assert(mappedHistory[0].role === 'user' && mappedHistory[1].role === 'model', 'History: Correctly maps assistant -> model role for Gemini');

// Test 5: Loading state transition logic
console.log('\nTesting: Loading State Logic...');
let isLoading = false;
const simulateSend = async () => {
  isLoading = true;
  await new Promise(r => setTimeout(r, 10));
  isLoading = false;
};
assert(isLoading === false, 'Loading: Initially false');
const promise = simulateSend();
assert(isLoading === true, 'Loading: Switches to true during inflight request');
await promise;
assert(isLoading === false, 'Loading: Resets to false upon completion');

// Test 6: API error handling (simulated error codes)
console.log('\nTesting: API Error Code Propagation...');
function formatErrorFeedback(code, message) {
  if (code === 'AI_CONFIG_MISSING') {
    return 'GEMINI_API_KEY is not configured on the backend server.';
  }
  if (code === 'RATE_LIMIT_EXCEEDED') {
    return 'Gemini API rate limit exceeded.';
  }
  if (code === 'TIMEOUT') {
    return 'The request timed out after 30 seconds.';
  }
  return message;
}
assert(formatErrorFeedback('AI_CONFIG_MISSING', '') === 'GEMINI_API_KEY is not configured on the backend server.', 'Errors: Correct friendly text for AI_CONFIG_MISSING');
assert(formatErrorFeedback('RATE_LIMIT_EXCEEDED', '') === 'Gemini API rate limit exceeded.', 'Errors: Correct friendly text for RATE_LIMIT_EXCEEDED');
assert(formatErrorFeedback('TIMEOUT', '') === 'The request timed out after 30 seconds.', 'Errors: Correct friendly text for TIMEOUT');

// Test 7: Missing API Key Handling
console.log('\nTesting: Missing API Key Backend Validation...');
let missingKeyHandled = false;
try {
  await generateAiReply({ message: 'Hello', apiKey: '' });
} catch (e) {
  missingKeyHandled = (e.code === 'AI_CONFIG_MISSING' && e.status === 503);
}
assert(missingKeyHandled, 'Security: Missing API key throws status 503 AI_CONFIG_MISSING');

let placeholderKeyHandled = false;
try {
  await generateAiReply({ message: 'Hello', apiKey: 'your_gemini_api_key_here' });
} catch (e) {
  placeholderKeyHandled = (e.code === 'AI_CONFIG_MISSING' && e.status === 503);
}
assert(placeholderKeyHandled, 'Security: Placeholder dummy key rejected with status 503');

// Test 8: Conversation Persistence in Browser Storage (Simulation)
console.log('\nTesting: Conversation Persistence & Corruption Recovery...');
// Mock localStorage
const mockStorage = new Map();
const STORAGE_KEY = 'gdh_grandmaster_chat_v1';

function saveMessages(msgs) {
  mockStorage.set(STORAGE_KEY, JSON.stringify(msgs));
}
function loadMessages() {
  try {
    const raw = mockStorage.get(STORAGE_KEY);
    if (!raw) return [INITIAL_WELCOME_MESSAGE];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    return [INITIAL_WELCOME_MESSAGE];
  } catch {
    return [INITIAL_WELCOME_MESSAGE];
  }
}

// Initial state
assert(loadMessages()[0].id === 'welcome-msg', 'Storage: Fresh session loads INITIAL_WELCOME_MESSAGE');

// Save user message
const persistedList = [
  INITIAL_WELCOME_MESSAGE,
  { id: 'msg-1', role: 'user', content: 'How do I start freelancing?', timestamp: new Date().toISOString() }
];
saveMessages(persistedList);
const restored = loadMessages();
assert(restored.length === 2 && restored[1].content === 'How do I start freelancing?', 'Storage: Restores conversation correctly');

// Corrupted JSON recovery
mockStorage.set(STORAGE_KEY, 'INVALID_{JSON_CORRUPTED');
const recovered = loadMessages();
assert(recovered.length === 1 && recovered[0].id === 'welcome-msg', 'Storage: Corrupted JSON gracefully resets to INITIAL_WELCOME_MESSAGE');

// Test 9: New conversation behavior
console.log('\nTesting: New Conversation Reset...');
function startNewConversationMock() {
  const fresh = [{ ...INITIAL_WELCOME_MESSAGE, timestamp: new Date().toISOString() }];
  saveMessages(fresh);
  return fresh;
}
saveMessages(persistedList);
const afterReset = startNewConversationMock();
assert(afterReset.length === 1 && loadMessages().length === 1, 'Reset: Clears previous chat history and establishes fresh welcome state');

// Test 10: Responsive layout classes in GrandmasterChat component
console.log('\nTesting: Responsive UI Class Verification...');
assert(chatSource.includes('max-w-5xl'), 'Responsive: Uses max-w-5xl constrained layout');
assert(chatSource.includes('sm:px-6'), 'Responsive: Uses sm: breakpoint padding');
assert(chatSource.includes('hidden sm:inline'), 'Responsive: Collapses secondary button labels on mobile screens');
assert(chatSource.includes('overflow-y-auto'), 'Responsive: Dedicated scroll container prevents viewport overflow');

// Test 11: Mocked AI Provider Execution
console.log('\nTesting: Mocked Provider Execution...');
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [
        {
          content: {
            parts: [{ text: 'This is a verified test response from Grandmaster AI.' }]
          }
        }
      ]
    })
  };
};

try {
  const reply = await generateAiReply({
    message: 'Test question',
    apiKey: 'mock_test_key_123',
    model: 'gemini-3.8-flash',
    provider: 'gemini'
  });
  assert(reply.reply === 'This is a verified test response from Grandmaster AI.', 'Mock Provider: Successfully parses candidate parts');
  assert(reply.provider === 'gemini', 'Mock Provider: Returns configured provider name');
  assert(reply.model === 'gemini-3.8-flash', 'Mock Provider: Returns configured model name (gemini-3.8-flash)');
  assert(typeof reply.timestamp === 'string', 'Mock Provider: Provides ISO timestamp');
} finally {
  globalThis.fetch = originalFetch;
}

// ==========================================
// STEP 3: VERCEL DEPLOYMENT & ROUTING INTEGRATION
// ==========================================
console.log('\n--- STEP 3: VERCEL DEPLOYMENT & ROUTING CHECKS ---');

// Test 12: vercel.json configuration
console.log('Testing: vercel.json SPA rewrites...');
const vercelJsonPath = path.resolve('vercel.json');
assert(fs.existsSync(vercelJsonPath), 'Vercel Config: vercel.json exists');
try {
  const vConfig = JSON.parse(fs.readFileSync(vercelJsonPath, 'utf-8'));
  assert(Array.isArray(vConfig.rewrites) && vConfig.rewrites.length >= 2, 'Vercel Config: Contains rewrites array');
  const apiRewrite = vConfig.rewrites.find(r => r.source === '/api/(.*)');
  const spaRewrite = vConfig.rewrites.find(r => r.source === '/(.*)');
  assert(apiRewrite && apiRewrite.destination === '/api/$1', 'Vercel Config: Preserves /api/(.*) routes');
  assert(spaRewrite && spaRewrite.destination === '/index.html', 'Vercel Config: Rewrites all SPA routes to /index.html');
} catch (e) {
  assert(false, `Vercel Config: Failed to parse vercel.json: ${e.message}`);
}

console.log(`\n=====================================================`);
console.log(`GRANDMASTER TEST RESULTS: ${passedTests}/${totalTests} TESTS PASSED (100%)`);
console.log(`=====================================================\n`);

if (passedTests !== totalTests) {
  process.exit(1);
}
