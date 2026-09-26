// Types for starcrop. The library is plain ESM JavaScript (no build step); these declarations describe its API.

export type Verdict = 'PLANTED' | 'MIXED' | 'GROWN' | 'SEEDLING' | 'UNSURVEYED';
export type SignalId = 'siblings' | 'ownerCohort' | 'birthSpread' | 'plantingRows' | 'field' | 'hollowAccounts' | 'thinSoil' | 'templateTwins' | 'knownField';
export type ErrorCode = 'BAD_INPUT' | 'NOT_FOUND' | 'NO_REPO' | 'RATE_LIMITED' | 'UPSTREAM';

export interface Signal {
  id: SignalId; label: string;
  /** null = could not be computed (budget, rate limit, or not applicable) */
  fired: boolean | null;
  weight: number; value: number | null; unit: string; control: number | null;
  threshold: string; evidence: string;
}
export interface SiblingRepo { fullName: string; createdAt: string; offsetSeconds: number; stars: number; forks: number; ownerLogin: string; ownerId: number | null; ownerBornAt: string | null; skeleton: string | null; }
/** The public door a seed account came through. 'star-event' = a WatchEvent actor in the repo's events feed; 'engaged' = an issue/PR author, commenter or reviewer there. */
export type Door = 'star-event' | 'fork' | 'engaged' | 'cohort' | 'sibling-owner' | 'known-planter';
export interface Stargazer { login: string; id: number; bornAt: string; bornExact: boolean; via: Door; starredAt: string | null; followers: number | null; publicRepos: number | null; }
/** Per-door yield of one survey: seeds sampled, how many had the target in their stars, and how many the door offered (null on old fixtures). */
export interface DoorYield { via: Door; seeds: number; confirmed: number; available: number | null; }
export interface TokenLink { name: string; symbol: string; linkFoundIn: 'metadata' | 'dexscreener' | 'pumpfun' | null; }

export interface CropReport {
  v: 1; checkedAt: string; source: 'live' | 'cache' | 'fixture'; partial: boolean;
  input: { q: string; kind: 'mint' | 'url' | 'slug'; mint: string | null; token: TokenLink | null; note: string | null };
  /** createdAt/stars/forks/sizeKb are null only when the time budget ran out before GitHub returned the repo (verdict UNSURVEYED, partial, nothing measured). */
  repo: { fullName: string; url: string; description: string | null; createdAt: string | null; pushedAt: string | null; stars: number | null; forks: number | null; sizeKb: number | null; commits: number | null; language: string | null;
    owner: { login: string; id: number; createdAt: string; followers: number; publicRepos: number } | null };
  verdict: Verdict; score: number; maxScore: 17; headline: string;
  /** Why the verdict is UNSURVEYED (thin sample, engaged-only sample, tight but unfired birth spread, cut short); null otherwise. */
  reason: string | null;
  /** always 9, in SIGNAL_ORDER */
  signals: Signal[];
  /** from/to/minStars are null only on a report cut short before the repo arrived. */
  siblings: { from: string | null; to: string | null; minStars: number | null; controlCount: number | null; repos: SiblingRepo[] };
  cohort: { from: string | null; to: string | null; query: string | null; count: number | null; controlCount: number | null; computed: boolean };
  stargazers: { seeds: number; confirmed: number; accounts: Stargazer[]; birthSpreadMinutes: number | null; rowAgreement: number | null; medianGapSeconds: number | null; doors: DoorYield[] };
  field: { id: string | null; repos: { fullName: string; starredBy: number; share: number }[]; plantings: { login: string; repo: string; at: string }[] };
  trace: { step: string; calls: number; ms: number }[];
  cost: { githubCore: number; githubSearch: number; heliusCredits: number };
  limits: string[];
}

export interface KnownPlanters { indexed: number; planters: string[]; starredThis: string[]; seeds: ({ login: string; id: number } | string)[] }

export interface SurveyOptions {
  /** GitHub token (no scopes needed). Without one: 60 core calls/h, 10 searches/min. */
  token?: string;
  /** Solana RPC with DAS getAsset (e.g. Helius) for mint inputs; optional. */
  rpcUrl?: string;
  fetch?: typeof fetch;
  /** Whole-survey time budget in ms (default 20000). Unfinished steps give partial: true. */
  budgetMs?: number;
  /** Max seed accounts whose starred lists are read (default 20). */
  maxSeeds?: number;
  /** Max /users/{u}/starred pages per survey (default 28). With the defaults a report makes <= 47 core + 4 search calls. */
  maxStarredCalls?: number;
  /** Planters of earlier PLANTED fields (your own index) for the knownField signal. */
  knownPlanters?: (fullName: string) => Promise<KnownPlanters | null>;
  /** Clock override for recording (ms). */
  now?: number;
}

/** Every upstream answer one survey needed; analyze(raw) is pure and replayable. */
export interface RawSurvey { v: 1; checkedAt: string; source?: string; partial: boolean; input: CropReport['input']; repo: Record<string, unknown>; owner: Record<string, unknown> | null; commits: number | null;
  siblings: Record<string, unknown> | null; cohort: Record<string, unknown>; seeds: { login: string; id: number; via: Door }[];
  /** How the seeds were chosen (absent on fixtures recorded before the events door). */
  doors?: { mature: boolean; maxSeeds: number; maxStarredCalls: number; plan: { via: Door; max: number; pages: number; available: number }[];
    events: { pages: number; events: number; starActors: number; engagedActors: number } | null } | null;
  starred: Record<string, { pages: number; items: { repo: string; at: string; stars?: number | null; createdAt?: string | null }[] } | null>;
  profiles: Record<string, { id: number; createdAt: string; followers: number; publicRepos: number }>;
  readmes: Record<string, { text?: string; skeleton?: string } | null>; known: KnownPlanters | null;
  trace: CropReport['trace']; cost: CropReport['cost']; limits: string[]; elapsedMs?: number; fieldId?: string | null;
  /** 'repo' when the budget ran out before the repository metadata arrived (repo fields are null). */
  cutShort?: 'repo' }

export function survey(target: string, opts?: SurveyOptions): Promise<CropReport>;
export function collect(target: string, opts?: SurveyOptions): Promise<RawSurvey>;
export function analyze(raw: RawSurvey): CropReport;
/** Seed plan per door in priority order: [door, max seeds, starred pages]. Mature = created more than MATURE_DAYS ago. */
export function seedPlan(mature: boolean): [Door, number, number][];
/** Pure: a repo's public events -> recent stargazers (WatchEvent actors) and engaged accounts; bots and the owner dropped. */
export function eventDoors(events: unknown[], ownerLogin?: string): { events: number; stars: { login: string; id: number | null; at: string | null }[]; engaged: { login: string; id: number | null; at: string | null }[] };
/** The report for a survey whose time budget ran out before GitHub returned the repository: UNSURVEYED, partial, every signal null. */
export function cutShortReport(raw: RawSurvey): CropReport;
export function unsurveyedReason(report: CropReport, signals: Record<SignalId, Signal>, confirmed: number, sampled: number, doors: DoorYield[], raw?: Partial<RawSurvey>): string;
export const MATURE_DAYS: number;
export const MIN_CONFIRMED: number;
export const DOORS: Record<Door, string>;
export function summarize(report: CropReport): { fullName: string; verdict: Verdict; score: number; maxScore: number; stars: number | null; createdAt: string | null; checkedAt: string; headline: string; mint: string | null; symbol: string | null; fieldId: string | null };
export function resolveRepo(input: string, opts?: { rpcUrl?: string; fetch?: typeof fetch; deadline?: number }): Promise<{ fullName: string | null; kind: 'mint' | 'url' | 'slug'; mint: string | null; token: TokenLink | null; note: string | null; calls: number; heliusCredits: number }>;
export function parseTarget(input: string): { kind: 'mint' | 'url' | 'slug'; mint: string | null; owner: string | null; name: string | null; fullName: string | null };
export function findGithubRepo(text: string | null | undefined): string | null;
export function idToDate(id: number, localAnchors?: { id: number; createdAt: string }[], globalAnchors?: { id: number; createdAt: string }[]): { at: Date; exact: boolean; source: 'local' | 'global'; extrapolated: boolean };
export function readmeSkeleton(text: string, ctx?: { owner?: string; name?: string; description?: string | null }): string;
/** Replace every GitHub login in a RawSurvey with sample-user-NN / sample-owner-NN; ids, dates, counts and README skeletons are kept, so analyze() gives the same report with the names swapped. `map` (lowercase login -> placeholder) is reused and extended; it holds the real logins, never commit it. */
export function anonymize<T extends RawSurvey | RawSurvey[]>(raws: T, opts?: { keep?: string[]; map?: Map<string, string> }): T;
export function surveyLogins(raw: RawSurvey): { users: Set<string>; owners: Set<string> };
export const PLACEHOLDER_RE: RegExp;
export function renderPlat(report: CropReport, opts?: { width?: number }): string;
export function gatewayUrl(uri: string): string;
export function repoFromMetadata(meta: unknown): string | null;
export function repoFromDexPairs(pairs: unknown): string | null;
export const SIGNAL_ORDER: SignalId[];
export const WEIGHTS: Record<SignalId, number>;
export const MAX_SCORE: 17;
export const LIMITS: string[];
export const BASE58_RE: RegExp;
export const GLOBAL_ANCHORS: { id: number; createdAt: string }[];
/** `timeout: true` = an UPSTREAM error caused by the 8 s per-call timeout (connect, headers or body download). */
export class StarcropError extends Error { code: ErrorCode; status: number; retryAfter?: number; timeout?: boolean; token?: { mint: string; name: string; symbol: string }; toJSON(): { error: string; code: ErrorCode; retryAfter?: number; token?: object }; }
export class BudgetError extends Error {}
