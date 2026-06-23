/**
 * DirectorService unit tests
 *
 * Tests:
 *   TC-1: trigger threshold — planner fires when planned-ahead count < 2
 *   TC-2: trigger threshold — planner skips when planned-ahead count >= 2
 *   TC-3: horizon cap — new beats capped at HORIZON (3) minus kept
 *   TC-4: keep/discard/new reconcile — correct rows deleted, new rows inserted
 *   TC-5: author-event immutability invariant — author rows never deleted
 *   TC-6: malformed JSON no-op — parseReconcileResponse failure → no writes
 *   TC-7: token-guard stale skip — if isCurrentToken returns false, no writes
 *   TC-8: dual-provider routing — oauth routes to curlComplete
 *   TC-9: dual-provider routing — ollama routes to ollamaChatComplete
 *   TC-10: dual-provider routing — api_key routes to aiClient
 *   TC-11: buildDirective author-priority tiebreak
 *   TC-12: planAndDirect no-ops when recentStory is empty and plan=true
 *   TC-13: B-1 implicit-discard — beat index omitted by model is treated as discard
 *   TC-14: B-2 stale token at entry — neither deletes nor inserts occur (no partial write)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock external dependencies BEFORE importing DirectorService ─────────────

const mockCurlComplete = vi.fn().mockResolvedValue('');
const mockOllamaChatComplete = vi.fn().mockResolvedValue('');

vi.mock('../CurlStreamService.js', () => ({
  curlComplete: (...args: unknown[]) => mockCurlComplete(...args),
}));

vi.mock('../OllamaNativeService.js', () => ({
  ollamaChatComplete: (...args: unknown[]) => mockOllamaChatComplete(...args),
}));

// Mock WorldMemoryService singleton
const mockListEvents = vi.fn();
vi.mock('../WorldMemoryService.js', () => ({
  getWorldMemoryService: () => ({ listEvents: mockListEvents }),
}));

// ── Import service AFTER mocks ───────────────────────────────────────────────
import { DirectorService } from '../DirectorService.js';
import type { ActiveProvider, AiClient } from '../DirectorService.js';

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeDb(rows: Array<{ n?: number }> = [], runFn?: ReturnType<typeof vi.fn>) {
  const stmtRun = runFn ?? vi.fn();
  const stmtGet = vi.fn().mockReturnValue(rows[0] ?? { n: 0 });
  const stmtAll = vi.fn().mockReturnValue([]);
  const prepare = vi.fn().mockReturnValue({
    run: stmtRun,
    get: stmtGet,
    all: stmtAll,
  });
  const beginTransaction = vi.fn();
  const commitTransaction = vi.fn();
  const rollbackTransaction = vi.fn();
  return { prepare, beginTransaction, commitTransaction, rollbackTransaction, _stmtRun: stmtRun, _prepare: prepare };
}

/** Minimal transaction-capable DB mock for reconcileRoadmap tests. */
function makeTxDb(prepareMock: ReturnType<typeof vi.fn>) {
  const beginTransaction = vi.fn();
  const commitTransaction = vi.fn();
  const rollbackTransaction = vi.fn();
  return {
    prepare: prepareMock,
    beginTransaction,
    commitTransaction,
    rollbackTransaction,
    _beginTransaction: beginTransaction,
    _commitTransaction: commitTransaction,
    _rollbackTransaction: rollbackTransaction,
  };
}

function makeProvider(overrides: Partial<ActiveProvider> = {}): ActiveProvider {
  return {
    apiKey: 'test-key',
    baseUrl: 'https://api.example.com/v1',
    defaultModel: 'gpt-4',
    authMethod: 'api_key',
    ...overrides,
  };
}

function makeAiClient(response = 'ok'): AiClient {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: response } }],
        }),
      },
    },
  };
}

const baseArgs = {
  projectId: 'proj-1',
  branchId: 'branch-1',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DirectorService', () => {
  let service: DirectorService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DirectorService();
  });

  // ── TC-1: countPlannedAhead < 2 triggers planner ──────────────────────────
  it('TC-1: fires planner when planned-ahead count < PLAN_TRIGGER_THRESHOLD (2)', async () => {
    // DB returns count=1 (< 2 → should plan)
    const db = makeDb([{ n: 1 }]);

    const reconcileRoadmap = vi.spyOn(service, 'reconcileRoadmap').mockResolvedValue(true);
    vi.spyOn(service, 'buildDirective').mockResolvedValue('directive');

    // listEvents not called by planAndDirect when reconcileRoadmap is mocked
    await service.planAndDirect({
      ...baseArgs,
      providerConfig: makeProvider(),
      model: 'gpt-4',
      db: db as unknown as import('../database.js').ProjectDatabase,
      recentStory: 'some recent story',
      generationToken: 1,
      isCurrentToken: () => true,
      plan: true,
    });

    expect(reconcileRoadmap).toHaveBeenCalledOnce();
  });

  // ── TC-2: countPlannedAhead >= 2 skips planner ────────────────────────────
  it('TC-2: skips planner when planned-ahead count >= PLAN_TRIGGER_THRESHOLD (2)', async () => {
    const db = makeDb([{ n: 2 }]);

    const reconcileRoadmap = vi.spyOn(service, 'reconcileRoadmap').mockResolvedValue(true);
    vi.spyOn(service, 'buildDirective').mockResolvedValue('directive');

    await service.planAndDirect({
      ...baseArgs,
      providerConfig: makeProvider(),
      model: 'gpt-4',
      db: db as unknown as import('../database.js').ProjectDatabase,
      recentStory: 'some recent story',
      generationToken: 1,
      isCurrentToken: () => true,
      plan: true,
    });

    expect(reconcileRoadmap).not.toHaveBeenCalled();
  });

  // ── TC-3: horizon cap ────────────────────────────────────────────────────────
  it('TC-3: caps new beats so keep + new <= HORIZON (3)', async () => {
    // 2 existing director beats, keep=[0,1], new=[3 items] → only 1 slot available
    const now = new Date().toISOString();
    const existingBeats = [
      { id: 'b1', status: 'planned', source: 'director', name: 'Beat 1', description: '', participatingCharacters: [], storyTimestamp: '', created_at: now, updated_at: now },
      { id: 'b2', status: 'planned', source: 'director', name: 'Beat 2', description: '', participatingCharacters: [], storyTimestamp: '', created_at: now, updated_at: now },
    ];
    mockListEvents.mockReturnValue(existingBeats.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      status: r.status as 'planned',
      source: r.source as 'director',
      participatingCharacters: r.participatingCharacters,
      storyTimestamp: r.storyTimestamp,
      projectId: 'proj-1',
      branchId: 'branch-1',
      impact: '',
      paragraphId: null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })));

    const insertedNames: string[] = [];
    const stmtRunMock = vi.fn().mockImplementation((...args: unknown[]) => {
      // capture name from insert calls
      insertedNames.push(args[3] as string);
    });

    const prepareResults: Record<string, unknown> = {};
    const prepareMock = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('INSERT')) {
        return { run: stmtRunMock };
      }
      if (sql.includes('DELETE')) {
        return { run: vi.fn() };
      }
      return { run: vi.fn(), get: vi.fn().mockReturnValue({ n: 0 }), all: vi.fn().mockReturnValue([]) };
    });

    const db = makeTxDb(prepareMock) as unknown as import('../database.js').ProjectDatabase;

    // Model returns keep=[0,1], discard=[], new=[3 new beats]
    const reconcileResponse = JSON.stringify({
      keep: [0, 1],
      discard: [],
      new: [
        { name: 'New A', description: 'desc A', storyTimestamp: '', participatingCharacters: [] },
        { name: 'New B', description: 'desc B', storyTimestamp: '', participatingCharacters: [] },
        { name: 'New C', description: 'desc C', storyTimestamp: '', participatingCharacters: [] },
      ],
    });

    const aiClient = makeAiClient(reconcileResponse);

    await service.reconcileRoadmap(
      db, 'proj-1', 'branch-1', 'recent story',
      1, () => true,
      makeProvider(), 'gpt-4', '', '', aiClient,
    );

    // keep=2 + new=3 would exceed HORIZON=3, so only 1 new beat should be inserted
    expect(stmtRunMock).toHaveBeenCalledTimes(1);
  });

  // ── TC-4: keep/discard/new reconcile ────────────────────────────────────────
  it('TC-4: deletes discarded director beats and inserts new ones', async () => {
    const now = new Date().toISOString();
    const existingBeats = [
      { id: 'b1', name: 'Beat 1', description: '', status: 'planned' as const, source: 'director' as const, participatingCharacters: [], storyTimestamp: '', projectId: 'proj-1', branchId: 'branch-1', impact: '', paragraphId: null, createdAt: now, updatedAt: now },
      { id: 'b2', name: 'Beat 2', description: '', status: 'planned' as const, source: 'director' as const, participatingCharacters: [], storyTimestamp: '', projectId: 'proj-1', branchId: 'branch-1', impact: '', paragraphId: null, createdAt: now, updatedAt: now },
    ];
    mockListEvents.mockReturnValue(existingBeats);

    const deletedIds: string[] = [];
    const insertedCount = { n: 0 };

    const prepareMock = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('DELETE')) {
        return {
          run: vi.fn().mockImplementation((...args: unknown[]) => {
            deletedIds.push(args[0] as string);
          }),
        };
      }
      if (sql.includes('INSERT')) {
        return { run: vi.fn().mockImplementation(() => { insertedCount.n++; }) };
      }
      return { run: vi.fn(), get: vi.fn().mockReturnValue({ n: 0 }), all: vi.fn().mockReturnValue([]) };
    });

    const db = makeTxDb(prepareMock) as unknown as import('../database.js').ProjectDatabase;

    const reconcileResponse = JSON.stringify({
      keep: [0],
      discard: [1],
      new: [
        { name: 'New Beat', description: 'something new', storyTimestamp: '', participatingCharacters: ['Hero'] },
      ],
    });

    const aiClient = makeAiClient(reconcileResponse);

    await service.reconcileRoadmap(
      db, 'proj-1', 'branch-1', 'recent story',
      1, () => true,
      makeProvider(), 'gpt-4', '', '', aiClient,
    );

    // b2 should have been deleted
    expect(deletedIds).toContain('b2');
    // 1 new beat inserted (keep=1 + new=1 = 2 <= HORIZON=3)
    expect(insertedCount.n).toBe(1);
  });

  // ── TC-5: author-event immutability invariant ─────────────────────────────
  it('TC-5: never deletes author-sourced events even if response includes their index', async () => {
    const now = new Date().toISOString();
    const events = [
      { id: 'a1', name: 'Author Beat', description: '', status: 'planned' as const, source: 'author' as const, participatingCharacters: [], storyTimestamp: '', projectId: 'proj-1', branchId: 'branch-1', impact: '', paragraphId: null, createdAt: now, updatedAt: now },
      { id: 'd1', name: 'Director Beat', description: '', status: 'planned' as const, source: 'director' as const, participatingCharacters: [], storyTimestamp: '', projectId: 'proj-1', branchId: 'branch-1', impact: '', paragraphId: null, createdAt: now, updatedAt: now },
    ];
    mockListEvents.mockReturnValue(events);

    const deletedIds: string[] = [];
    const prepareMock = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('DELETE')) {
        return {
          run: vi.fn().mockImplementation((...args: unknown[]) => {
            deletedIds.push(args[0] as string);
          }),
        };
      }
      return { run: vi.fn(), get: vi.fn().mockReturnValue({ n: 0 }), all: vi.fn().mockReturnValue([]) };
    });
    const db = makeTxDb(prepareMock) as unknown as import('../database.js').ProjectDatabase;

    // directorBeats array only has index 0 = d1 (author beats are excluded).
    // discard: [0] tries to discard the first director beat (d1), not a1.
    const reconcileResponse = JSON.stringify({
      keep: [],
      discard: [0],
      new: [],
    });

    await service.reconcileRoadmap(
      db, 'proj-1', 'branch-1', 'recent story',
      1, () => true,
      makeProvider(), 'gpt-4', '', '', makeAiClient(reconcileResponse),
    );

    // d1 can be deleted (it's source='director')
    expect(deletedIds).toContain('d1');
    // a1 should never be deleted
    expect(deletedIds).not.toContain('a1');
  });

  // ── TC-6: malformed JSON no-op ───────────────────────────────────────────────
  it('TC-6: does nothing on malformed JSON response', async () => {
    const now = new Date().toISOString();
    mockListEvents.mockReturnValue([
      { id: 'd1', name: 'D Beat', description: '', status: 'planned' as const, source: 'director' as const, participatingCharacters: [], storyTimestamp: '', projectId: 'proj-1', branchId: 'branch-1', impact: '', paragraphId: null, createdAt: now, updatedAt: now },
    ]);

    const stmtRun = vi.fn();
    const db = makeTxDb(
      vi.fn().mockReturnValue({ run: stmtRun, get: vi.fn().mockReturnValue({ n: 0 }), all: vi.fn().mockReturnValue([]) }),
    ) as unknown as import('../database.js').ProjectDatabase;

    const aiClient = makeAiClient('this is not valid json at all!!!');

    const result = await service.reconcileRoadmap(
      db, 'proj-1', 'branch-1', 'recent story',
      1, () => true,
      makeProvider(), 'gpt-4', '', '', aiClient,
    );

    // Should return false (no-op)
    expect(result).toBe(false);
    // No DB writes
    expect(stmtRun).not.toHaveBeenCalled();
  });

  // ── TC-7: token-guard stale skip ─────────────────────────────────────────────
  it('TC-7: skips all DB writes when isCurrentToken returns false', async () => {
    const now = new Date().toISOString();
    mockListEvents.mockReturnValue([
      { id: 'd1', name: 'D Beat', description: '', status: 'planned' as const, source: 'director' as const, participatingCharacters: [], storyTimestamp: '', projectId: 'proj-1', branchId: 'branch-1', impact: '', paragraphId: null, createdAt: now, updatedAt: now },
    ]);

    const stmtRun = vi.fn();
    const db = makeTxDb(
      vi.fn().mockReturnValue({ run: stmtRun, get: vi.fn().mockReturnValue({ n: 0 }), all: vi.fn().mockReturnValue([]) }),
    ) as unknown as import('../database.js').ProjectDatabase;

    const response = JSON.stringify({
      keep: [],
      discard: [0],
      new: [{ name: 'New', description: 'desc', storyTimestamp: '', participatingCharacters: [] }],
    });

    // Token is stale: isCurrentToken always returns false
    const result = await service.reconcileRoadmap(
      db, 'proj-1', 'branch-1', 'story text',
      1, () => false,
      makeProvider(), 'gpt-4', '', '', makeAiClient(response),
    );

    expect(result).toBe(false);
    // No DB writes
    expect(stmtRun).not.toHaveBeenCalled();
  });

  // ── TC-8: dual-provider routing — oauth/curl ─────────────────────────────
  it('TC-8: routes through curlComplete for oauth provider', async () => {
    mockCurlComplete.mockResolvedValueOnce('directive text');
    const now = new Date().toISOString();
    // Need at least 1 planned event so buildDirective actually calls the LLM
    mockListEvents.mockReturnValue([
      { id: 'e1', name: 'Event 1', description: 'desc', status: 'planned' as const, source: 'author' as const, participatingCharacters: [], storyTimestamp: '', projectId: 'proj-1', branchId: 'branch-1', impact: '', paragraphId: null, createdAt: now, updatedAt: now },
    ]);

    const db = makeTxDb(
      vi.fn().mockReturnValue({ run: vi.fn(), get: vi.fn().mockReturnValue({ n: 0 }), all: vi.fn().mockReturnValue([]) }),
    ) as unknown as import('../database.js').ProjectDatabase;

    const oauthProvider = makeProvider({
      authMethod: 'oauth',
      accountId: 'acc-123',
      apiKey: 'oauth-token',
    });

    await service.buildDirective(db, 'proj-1', 'branch-1', 'recent story', '', '', oauthProvider, 'gpt-4');

    expect(mockCurlComplete).toHaveBeenCalledOnce();
    expect(mockOllamaChatComplete).not.toHaveBeenCalled();
  });

  // ── TC-9: dual-provider routing — ollama ─────────────────────────────────
  it('TC-9: routes through ollamaChatComplete for ollama provider', async () => {
    mockOllamaChatComplete.mockResolvedValueOnce('ollama directive');
    const now = new Date().toISOString();
    mockListEvents.mockReturnValue([
      { id: 'e1', name: 'Event 1', description: 'desc', status: 'planned' as const, source: 'author' as const, participatingCharacters: [], storyTimestamp: '', projectId: 'proj-1', branchId: 'branch-1', impact: '', paragraphId: null, createdAt: now, updatedAt: now },
    ]);

    const db = makeTxDb(
      vi.fn().mockReturnValue({ run: vi.fn(), get: vi.fn().mockReturnValue({ n: 0 }), all: vi.fn().mockReturnValue([]) }),
    ) as unknown as import('../database.js').ProjectDatabase;

    const ollamaProvider = makeProvider({
      isOllama: true,
      baseUrl: 'http://localhost:11434',
    });

    await service.buildDirective(db, 'proj-1', 'branch-1', 'recent story', '', '', ollamaProvider, 'llama3');

    expect(mockOllamaChatComplete).toHaveBeenCalledOnce();
    expect(mockCurlComplete).not.toHaveBeenCalled();
  });

  // ── TC-10: dual-provider routing — api_key/aiClient ──────────────────────
  it('TC-10: routes through aiClient for api_key provider', async () => {
    const aiClient = makeAiClient('api key directive');
    const now = new Date().toISOString();
    mockListEvents.mockReturnValue([
      { id: 'e1', name: 'Event 1', description: 'desc', status: 'planned' as const, source: 'author' as const, participatingCharacters: [], storyTimestamp: '', projectId: 'proj-1', branchId: 'branch-1', impact: '', paragraphId: null, createdAt: now, updatedAt: now },
    ]);

    const db = makeTxDb(
      vi.fn().mockReturnValue({ run: vi.fn(), get: vi.fn().mockReturnValue({ n: 0 }), all: vi.fn().mockReturnValue([]) }),
    ) as unknown as import('../database.js').ProjectDatabase;

    await service.buildDirective(db, 'proj-1', 'branch-1', 'recent story', '', '', makeProvider(), 'gpt-4', aiClient);

    expect(aiClient.chat.completions.create).toHaveBeenCalledOnce();
    expect(mockCurlComplete).not.toHaveBeenCalled();
    expect(mockOllamaChatComplete).not.toHaveBeenCalled();
  });

  // ── TC-11: buildDirective author-priority tiebreak ───────────────────────
  it('TC-11: author beats ordered before director beats in directive', async () => {
    const now = new Date().toISOString();
    const events = [
      { id: 'a1', name: 'Author Event', description: 'author desc', status: 'planned' as const, source: 'author' as const, participatingCharacters: [], storyTimestamp: '', projectId: 'proj-1', branchId: 'branch-1', impact: '', paragraphId: null, createdAt: now, updatedAt: now },
      { id: 'd1', name: 'Director Event', description: 'director desc', status: 'planned' as const, source: 'director' as const, participatingCharacters: [], storyTimestamp: '', projectId: 'proj-1', branchId: 'branch-1', impact: '', paragraphId: null, createdAt: now, updatedAt: now },
    ];
    mockListEvents.mockReturnValue(events);

    let capturedUserContent = '';
    const aiClient: AiClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(async (params: { messages: Array<{ role: string; content: string }> }) => {
            const userMsg = params.messages.find(m => m.role === 'user');
            if (userMsg) capturedUserContent = String(userMsg.content);
            return { choices: [{ message: { content: 'directive' } }] };
          }),
        },
      },
    };

    const db = makeTxDb(
      vi.fn().mockReturnValue({ run: vi.fn(), get: vi.fn().mockReturnValue({ n: 0 }), all: vi.fn().mockReturnValue([]) }),
    ) as unknown as import('../database.js').ProjectDatabase;

    await service.buildDirective(db, 'proj-1', 'branch-1', 'some story', '', '', makeProvider(), 'gpt-4', aiClient);

    // Author Event should appear before Director Event in the roadmap text
    const authorIdx = capturedUserContent.indexOf('Author Event');
    const directorIdx = capturedUserContent.indexOf('Director Event');
    expect(authorIdx).toBeGreaterThanOrEqual(0);
    expect(directorIdx).toBeGreaterThanOrEqual(0);
    expect(authorIdx).toBeLessThan(directorIdx);
  });

  // ── TC-12: planAndDirect no-ops when recentStory is empty ────────────────
  it('TC-12: planner no-ops when recentStory is empty (v1 spec)', async () => {
    const reconcileRoadmap = vi.spyOn(service, 'reconcileRoadmap').mockResolvedValue(true);
    vi.spyOn(service, 'buildDirective').mockResolvedValue('some directive');

    const db = makeTxDb(
      vi.fn().mockReturnValue({ run: vi.fn(), get: vi.fn().mockReturnValue({ n: 0 }), all: vi.fn().mockReturnValue([]) }),
    ) as unknown as import('../database.js').ProjectDatabase;

    await service.planAndDirect({
      ...baseArgs,
      providerConfig: makeProvider(),
      model: 'gpt-4',
      db,
      recentStory: '',  // empty — should skip planning
      generationToken: 1,
      isCurrentToken: () => true,
      plan: true,
    });

    // countPlannedAhead never called — reconcile skipped entirely
    expect(reconcileRoadmap).not.toHaveBeenCalled();
  });

  // ── TC-13: B-1 implicit-discard — unmentioned beat treated as discard ────────
  it('TC-13: beat index omitted by model (not in keep or discard) is treated as implicit discard', async () => {
    const now = new Date().toISOString();
    // 3 director beats — model only mentions index 1 in keep; 0 and 2 are omitted
    const existingBeats = [
      { id: 'b0', name: 'Beat 0', description: '', status: 'planned' as const, source: 'director' as const, participatingCharacters: [], storyTimestamp: '', projectId: 'proj-1', branchId: 'branch-1', impact: '', paragraphId: null, createdAt: now, updatedAt: now },
      { id: 'b1', name: 'Beat 1', description: '', status: 'planned' as const, source: 'director' as const, participatingCharacters: [], storyTimestamp: '', projectId: 'proj-1', branchId: 'branch-1', impact: '', paragraphId: null, createdAt: now, updatedAt: now },
      { id: 'b2', name: 'Beat 2', description: '', status: 'planned' as const, source: 'director' as const, participatingCharacters: [], storyTimestamp: '', projectId: 'proj-1', branchId: 'branch-1', impact: '', paragraphId: null, createdAt: now, updatedAt: now },
    ];
    mockListEvents.mockReturnValue(existingBeats);

    const deletedIds: string[] = [];
    const prepareMock = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('DELETE')) {
        return {
          run: vi.fn().mockImplementation((...args: unknown[]) => {
            deletedIds.push(args[0] as string);
          }),
        };
      }
      return { run: vi.fn(), get: vi.fn().mockReturnValue({ n: 0 }), all: vi.fn().mockReturnValue([]) };
    });

    const db = makeTxDb(prepareMock) as unknown as import('../database.js').ProjectDatabase;

    // Model only mentions index 1 in keep; indices 0 and 2 are omitted entirely
    // (not in keep, not in discard) → both must be implicitly discarded (B-1 fix)
    const reconcileResponse = JSON.stringify({
      keep: [1],
      discard: [],
      new: [],
    });

    const result = await service.reconcileRoadmap(
      db, 'proj-1', 'branch-1', 'recent story',
      1, () => true,
      makeProvider(), 'gpt-4', '', '', makeAiClient(reconcileResponse),
    );

    expect(result).toBe(true);
    // b0 and b2 omitted by model → implicitly discarded → deleted
    expect(deletedIds).toContain('b0');
    expect(deletedIds).toContain('b2');
    // b1 was in keep → NOT deleted
    expect(deletedIds).not.toContain('b1');
    // Total retained = 1 (kept) + 0 (new) = 1 ≤ HORIZON (3)
    expect(deletedIds.length).toBe(2);
  });

  // ── TC-14: B-2 stale token at entry — neither deletes nor inserts occur ──────
  it('TC-14: stale token at entry prevents both deletes and inserts (no partial write)', async () => {
    const now = new Date().toISOString();
    mockListEvents.mockReturnValue([
      { id: 'd1', name: 'Director Beat', description: '', status: 'planned' as const, source: 'director' as const, participatingCharacters: [], storyTimestamp: '', projectId: 'proj-1', branchId: 'branch-1', impact: '', paragraphId: null, createdAt: now, updatedAt: now },
    ]);

    const stmtRun = vi.fn();
    const prepareMock = vi.fn().mockReturnValue({
      run: stmtRun,
      get: vi.fn().mockReturnValue({ n: 0 }),
      all: vi.fn().mockReturnValue([]),
    });
    const txDb = makeTxDb(prepareMock);
    const db = txDb as unknown as import('../database.js').ProjectDatabase;

    // Model response requests: discard d1, insert a new beat
    const reconcileResponse = JSON.stringify({
      keep: [],
      discard: [0],
      new: [{ name: 'New Beat', description: 'new', storyTimestamp: '', participatingCharacters: [] }],
    });

    // isCurrentToken returns false → token is stale at the single entry check
    const result = await service.reconcileRoadmap(
      db, 'proj-1', 'branch-1', 'story text',
      1, () => false,
      makeProvider(), 'gpt-4', '', '', makeAiClient(reconcileResponse),
    );

    expect(result).toBe(false);
    // No DELETE or INSERT statements executed — no partial write
    expect(stmtRun).not.toHaveBeenCalled();
    // beginTransaction was called, then rollbackTransaction (not commitTransaction)
    expect(txDb._beginTransaction).toHaveBeenCalledOnce();
    expect(txDb._rollbackTransaction).toHaveBeenCalledOnce();
    expect(txDb._commitTransaction).not.toHaveBeenCalled();
  });

  // ── TC-15: force=true reconciles even when planned-ahead count >= threshold ──
  it('TC-15: force=true fires reconcile even when planned-ahead count >= threshold', async () => {
    const db = makeDb([{ n: 5 }]); // well above PLAN_TRIGGER_THRESHOLD

    const reconcileRoadmap = vi.spyOn(service, 'reconcileRoadmap').mockResolvedValue(true);
    vi.spyOn(service, 'buildDirective').mockResolvedValue('directive');

    await service.planAndDirect({
      ...baseArgs,
      providerConfig: makeProvider(),
      model: 'gpt-4',
      db: db as unknown as import('../database.js').ProjectDatabase,
      recentStory: 'some recent story',
      generationToken: 1,
      isCurrentToken: () => true,
      plan: true,
      force: true,
      directorBrief: '走向情感拉扯與情慾',
    });

    expect(reconcileRoadmap).toHaveBeenCalledOnce();
  });

  // ── TC-16: directorBrief injected into reconcile prompt; technique persisted ──
  it('TC-16: reconcile injects the brief into the system prompt and persists technique', async () => {
    const now = new Date().toISOString();
    mockListEvents.mockReturnValue([]); // no existing director beats

    const insertedArgs: unknown[][] = [];
    const prepareMock = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('INSERT')) {
        return { run: vi.fn().mockImplementation((...args: unknown[]) => { insertedArgs.push(args); }) };
      }
      return { run: vi.fn(), get: vi.fn().mockReturnValue({ n: 0 }), all: vi.fn().mockReturnValue([]) };
    });
    const db = makeTxDb(prepareMock) as unknown as import('../database.js').ProjectDatabase;

    let capturedSystem = '';
    const aiClient: AiClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(async (params: { messages: Array<{ role: string; content: string }> }) => {
            capturedSystem = String(params.messages.find(m => m.role === 'system')?.content ?? '');
            return {
              choices: [{ message: { content: JSON.stringify({
                keep: [], discard: [],
                new: [{ name: '越界的觸碰', description: '兩人獨處時的試探', storyTimestamp: '', participatingCharacters: ['主角'], technique: '特寫推近' }],
              }) } }],
            };
          }),
        },
      },
    };

    const result = await service.reconcileRoadmap(
      db, 'proj-1', 'branch-1', 'recent story',
      1, () => true,
      makeProvider(), 'gpt-4', '', '走向情感拉扯與情慾', aiClient,
    );

    expect(result).toBe(true);
    // Brief surfaced in the system prompt
    expect(capturedSystem).toContain('走向情感拉扯與情慾');
    // horizon persisted at index 8, technique at index 9 (column order:
    // …participating_characters, status, horizon, source, technique, …)
    expect(insertedArgs.length).toBe(1);
    expect(insertedArgs[0][8]).toBe('mid'); // model omitted horizon → normalized default
    expect(insertedArgs[0][9]).toBe('特寫推近');
    // void unused now
    void now;
  });

  // ── TC-17: buildDirective injects the brief and surfaces beat technique ──────
  it('TC-17: buildDirective injects the brief and includes the beat technique', async () => {
    const now = new Date().toISOString();
    mockListEvents.mockReturnValue([
      { id: 'd1', name: '曖昧的對視', description: '欲言又止', status: 'planned' as const, source: 'director' as const, participatingCharacters: [], storyTimestamp: '', technique: '空鏡', projectId: 'proj-1', branchId: 'branch-1', impact: '', paragraphId: null, createdAt: now, updatedAt: now },
    ]);

    let capturedSystem = '';
    let capturedUser = '';
    const aiClient: AiClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(async (params: { messages: Array<{ role: string; content: string }> }) => {
            capturedSystem = String(params.messages.find(m => m.role === 'system')?.content ?? '');
            capturedUser = String(params.messages.find(m => m.role === 'user')?.content ?? '');
            return { choices: [{ message: { content: 'directive' } }] };
          }),
        },
      },
    };

    const db = makeTxDb(
      vi.fn().mockReturnValue({ run: vi.fn(), get: vi.fn().mockReturnValue({ n: 0 }), all: vi.fn().mockReturnValue([]) }),
    ) as unknown as import('../database.js').ProjectDatabase;

    await service.buildDirective(db, 'proj-1', 'branch-1', 'some story', '', '走向情感拉扯與情慾', makeProvider(), 'gpt-4', aiClient);

    expect(capturedSystem).toContain('走向情感拉扯與情慾');
    // technique surfaced alongside the beat in the roadmap text
    expect(capturedUser).toContain('空鏡');
  });

  // ── TC-18: reconcile re-tiers a kept beat (mid→short) without deleting it ─────
  it('TC-18: applies retier as an UPDATE on the kept director beat, no delete', async () => {
    const now = new Date().toISOString();
    mockListEvents.mockReturnValue([
      { id: 'd1', name: 'Beat 1', description: '', status: 'planned' as const, source: 'director' as const, horizon: 'mid' as const, participatingCharacters: [], storyTimestamp: '', projectId: 'proj-1', branchId: 'branch-1', impact: '', technique: '', orderInHorizon: 0, paragraphId: null, createdAt: now, updatedAt: now },
    ]);

    const updates: unknown[][] = [];
    const deletedIds: string[] = [];
    const prepareMock = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('UPDATE')) {
        return { run: vi.fn().mockImplementation((...args: unknown[]) => { updates.push(args); }) };
      }
      if (sql.includes('DELETE')) {
        return { run: vi.fn().mockImplementation((...args: unknown[]) => { deletedIds.push(args[0] as string); }) };
      }
      return { run: vi.fn(), get: vi.fn().mockReturnValue({ n: 0 }), all: vi.fn().mockReturnValue([]) };
    });
    const db = makeTxDb(prepareMock) as unknown as import('../database.js').ProjectDatabase;

    const reconcileResponse = JSON.stringify({
      keep: [0], discard: [], retier: [{ index: 0, horizon: 'short' }], new: [],
    });

    const result = await service.reconcileRoadmap(
      db, 'proj-1', 'branch-1', 'recent story',
      1, () => true,
      makeProvider(), 'gpt-4', '', '', makeAiClient(reconcileResponse),
    );

    expect(result).toBe(true);
    // UPDATE called with new horizon='short' (arg 0) targeting d1 (arg 2)
    expect(updates.length).toBe(1);
    expect(updates[0][0]).toBe('short');
    expect(updates[0][2]).toBe('d1');
    // Kept + re-tiered beat must NOT be implicitly discarded
    expect(deletedIds).not.toContain('d1');
  });

  // ── TC-19: new beat persists the model-assigned horizon ──────────────────────
  it('TC-19: new beat horizon is persisted at INSERT index 8', async () => {
    mockListEvents.mockReturnValue([]);
    const insertedArgs: unknown[][] = [];
    const prepareMock = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('INSERT')) {
        return { run: vi.fn().mockImplementation((...args: unknown[]) => { insertedArgs.push(args); }) };
      }
      return { run: vi.fn(), get: vi.fn().mockReturnValue({ n: 0 }), all: vi.fn().mockReturnValue([]) };
    });
    const db = makeTxDb(prepareMock) as unknown as import('../database.js').ProjectDatabase;

    const reconcileResponse = JSON.stringify({
      keep: [], discard: [], retier: [],
      new: [{ name: '即將開戰', description: '', storyTimestamp: '', participatingCharacters: [], technique: '', horizon: 'short' }],
    });

    await service.reconcileRoadmap(
      db, 'proj-1', 'branch-1', 'recent story',
      1, () => true,
      makeProvider(), 'gpt-4', '', '', makeAiClient(reconcileResponse),
    );

    expect(insertedArgs.length).toBe(1);
    expect(insertedArgs[0][8]).toBe('short');
  });
});
