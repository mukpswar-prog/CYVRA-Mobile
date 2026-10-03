/**
 * W5 PHASE 2 - SERVER-SIDE SEARCH, FILTERS AND PAGINATION (design plan 22)
 * ========================================================================
 *
 * THE DEFECT THIS FILE EXISTS TO FIX
 * ----------------------------------
 * `GET /admin/serials` used to answer with `limit` defaulted to 25 and
 * `Math.min(raw, 100)` clamping anything larger. Ask for 1000 rows and you were
 * handed 100 with a 200; ask for `limit=abc` and you were handed 25. Nothing in
 * the response said "this is not everything" in a way a client could not scroll
 * past, and the ops table simply looked complete.
 *
 * The brief's phrasing is the design constraint: *the API contract must make
 * truncation impossible to ignore*. That is three separate guarantees, and this
 * module is where all three live:
 *
 *   1. THE SERVER NEVER SILENTLY CLAMPS. `pageSize` must be exactly 25, 50 or
 *      100. `pageSize=1000` is a 400 naming the allowed values, not 100 rows
 *      and a shrug.
 *   2. THE SERVER NEVER SILENTLY DROPS A FILTER. A `status=ACTIVE,TYPO` is a
 *      400 naming the offending token. A filter that quietly matched nothing
 *      would look identical to "there are no results", which is the same class
 *      of defect as truncation wearing a different hat.
 *   3. THE ANSWER ALWAYS CARRIES THE COUNT. `total`, `returned`, `totalPages`,
 *      `hasMore` and `nextPage` are present on every response - not optional,
 *      not omitted when they would be zero.
 *
 * WHY IT IS A PURE MODULE
 * -----------------------
 * Parsing, predicate construction and page arithmetic take values in and hand
 * values out: no `Context`, no database, no clock. That is what lets
 * `search.test.ts` assert the generated SQL (rendered through
 * `PgDialect.sqlToQuery`) instead of asserting that a fake answered a query -
 * the difference between testing the predicate and testing the double.
 *
 * ---------------------------------------------------------------------------
 * THE FIVE SEARCH FIELDS (plan 22)
 * ---------------------------------------------------------------------------
 * Customer email, customer name, company, licence ID, serial number. They are
 * OR-ed into one predicate. "Licence ID" is `mobile_serials.id` - the UUID the
 * detail drawer and every route parameter use - searched both as text (so a
 * prefix works) and as an exact UUID (so a pasted full id can hit the primary
 * key).
 *
 * LIKE INPUT IS ESCAPED. Postgres treats `\`, `%` and `_` as special in a
 * pattern, so a customer literally named `100% Retail` would otherwise match
 * every row in the register. `escapeLike` neutralises all three; it is a
 * correctness fix, not hardening theatre.
 */

import { and, eq, gte, ilike, inArray, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import {
  hostBindingStatusEnum,
  licenceStatusEnum,
  mobileSerials,
  paymentStatusEnum,
  planCodeEnum,
  type LicenceStatus,
} from "@cyvra/database/schema";
import { isUuid } from "@cyvra/evidence";
import type { PaymentStatus } from "./state-machine";

/** The pgEnums, as value lists, for validation. Derived - never re-typed. */
const LICENCE_STATUSES = licenceStatusEnum.enumValues;
const PAYMENT_STATUSES = paymentStatusEnum.enumValues;
const PLAN_CODES = planCodeEnum.enumValues;
const HOST_BINDING_STATUSES = hostBindingStatusEnum.enumValues;

/**
 * `mobile_serials.customer_kind` is a `text` column, so it needs an explicit
 * domain. `POST /serials` validates the same two values through
 * `licenceDraftError`; this must not invent a third one the create route would
 * refuse.
 */
const CUSTOMER_KINDS = ["SINGLE", "BULK"] as const;

/**
 * Delivery state, derived from two columns on the row itself.
 *
 * `SENT` means a message went out and came back clean: `emailed_at` is set and
 * `email_error` is not. `FAILED` means the attempt was made and the provider
 * rejected it, which is exactly what `email_error` records.
 *
 * These two are mutually exclusive by construction, so the predicate built
 * from them must be an OR and never an AND - see `serialQueryConditions`.
 */
export const DELIVERY_STATUSES = ["SENT", "FAILED"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export type PlanCode = (typeof planCodeEnum.enumValues)[number];
export type HostBindingStatus = (typeof hostBindingStatusEnum.enumValues)[number];

/**
 * Page sizes the registry will serve.
 *
 * Not a range and not a maximum: three named sizes, so the client's page-size
 * control is a choice between real options rather than an invitation to type a
 * number the server will quietly reinterpret.
 */
export const PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

const DEFAULT_PAGE_SIZE: PageSize = 25;
const DEFAULT_PAGE = 1;
/** Long enough to search on, short enough that one request cannot pin a scan. */
const MAX_QUERY_LENGTH = 200;

/** A parsed, validated `GET /serials` query. Nothing here is unvalidated. */
export interface SerialQuerySpec {
  readonly q: string | null;
  readonly status: readonly LicenceStatus[];
  readonly paymentStatus: readonly PaymentStatus[];
  readonly planCode: readonly PlanCode[];
  readonly customerKind: readonly string[];
  readonly hostBinding: readonly HostBindingStatus[];
  readonly delivery: readonly DeliveryStatus[];
  /**
   * Days ahead to look, NOT a resolved window.
   *
   * The module's header promises no clock, and that promise is load-bearing:
   * `search.test.ts` asserts the generated SQL against fixed inputs. Parsing an
   * integer here and letting the route inject `now` keeps both true - the
   * arithmetic happens once, in the one place that owns "when is now", and the
   * predicate is still a pure function of `(spec, now)`.
   */
  readonly validityEndsWithinDays: number | null;
  readonly page: number;
  readonly pageSize: PageSize;
}

export type SerialQueryResult =
  | { readonly ok: true; readonly spec: SerialQuerySpec }
  | { readonly ok: false; readonly error: string };

/**
 * 1-based page offset in rows. Derived rather than stored, so it cannot drift.
 *
 * The parameter is structural rather than `SerialQuerySpec`: this reads only
 * `page` and `pageSize`, and `./admin/audit` builds its own spec shape over the
 * same `PAGE_SIZES`/`Pagination` contract. Widening a parameter type changes no
 * caller and no behaviour - every existing call still typechecks and still
 * produces byte-identical output.
 */
export function offsetOf(spec: { readonly page: number; readonly pageSize: PageSize }): number {
  return (spec.page - 1) * spec.pageSize;
}

/**
 * Neutralise the three characters Postgres reads as pattern syntax.
 *
 * The backslash is replaced first, or its own replacement would then be
 * escaped a second time and `\%` would come out as `\\%`.
 */
export function escapeLike(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Read a comma-, or repeated-, or both-delimited list of allowed tokens.
 *
 * Case-insensitive for convenience, strictly validated for correctness: an
 * unknown token is an error naming it, never a token quietly dropped. Empty
 * segments (from `a,,b` or a trailing comma) are skipped so that the natural
 * thing a UI emits still parses.
 */
function readTokenList(
  params: URLSearchParams,
  key: string,
  allowed: readonly string[],
): { ok: true; values: string[] } | { ok: false; error: string } {
  const raw = params.getAll(key);
  if (raw.length === 0) return { ok: true, values: [] };

  const upper = new Set(allowed.map((value) => value.toUpperCase()));
  const values: string[] = [];
  const unknown: string[] = [];

  for (const entry of raw) {
    for (const part of entry.split(",")) {
      const token = part.trim().toUpperCase();
      if (!token) continue;
      if (!upper.has(token)) {
        unknown.push(part.trim());
        continue;
      }
      const canonical = allowed.find((value) => value.toUpperCase() === token);
      if (canonical !== undefined && !values.includes(canonical)) {
        values.push(canonical);
      }
    }
  }

  if (unknown.length > 0) {
    return {
      ok: false,
      error:
        `Unknown value for "${key}": ${unknown.join(", ")}. ` +
        `Allowed: ${allowed.join(", ")}.`,
    };
  }
  return { ok: true, values };
}

/**
 * `validityEndsWithinDays`, as an integer - or refused.
 *
 * §65's "Expiring Soon" KPI is one filtered list call whose `pagination.total`
 * is the whole answer, so this number has to be validated at the edge rather
 * than interpreted downstream: `?validityEndsWithinDays=abc` must be a 400 that
 * says so, never 25 rows of everything.
 *
 * Deliberately not a date. A relative window keeps the clock out of this
 * module - the route resolves it against one `now` shared by the row query and
 * the count query, so a licence crossing the horizon mid-request cannot make
 * `total` disagree with the rows beside it.
 */
function readExpiryWindow(
  params: URLSearchParams,
): { ok: true; days: number | null } | { ok: false; error: string } {
  const raw = (params.get("validityEndsWithinDays") ?? "").trim();
  if (raw === "") return { ok: true, days: null };
  if (!/^\d+$/.test(raw)) {
    return {
      ok: false,
      error: '"validityEndsWithinDays" must be a whole number of days.',
    };
  }
  const days = Number(raw);
  if (days < 1 || days > 3650) {
    return {
      ok: false,
      error: `"validityEndsWithinDays" must be between 1 and 3650; got "${raw}".`,
    };
  }
  return { ok: true, days };
}

function readPage(
  params: URLSearchParams,
): { ok: true; page: number; pageSize: PageSize } | { ok: false; error: string } {
  /*
   * The retired parameter names are refused rather than ignored.
   *
   * `limit` and `offset` used to be accepted here, and `limit=1000` used to be
   * answered with 100 rows. Ignoring them now would leave a client that still
   * sends them receiving the default page while believing it asked for
   * something else - the silent truncation again, one rename later.
   */
  if (params.has("limit") || params.has("offset")) {
    return {
      ok: false,
      error: 'Use "page" and "pageSize" (25, 50 or 100); "limit" and "offset" are no longer accepted.',
    };
  }

  const pageRaw = (params.get("page") ?? "").trim();
  let page = DEFAULT_PAGE;
  if (pageRaw !== "") {
    if (!/^\d+$/.test(pageRaw)) {
      return { ok: false, error: '"page" must be a positive whole number.' };
    }
    page = Number(pageRaw);
    if (page < 1) {
      return { ok: false, error: '"page" starts at 1.' };
    }
  }

  const sizeRaw = (params.get("pageSize") ?? "").trim();
  let pageSize: PageSize = DEFAULT_PAGE_SIZE;
  if (sizeRaw !== "") {
    const parsed = Number(sizeRaw);
    if (!PAGE_SIZES.includes(parsed as PageSize)) {
      return {
        ok: false,
        error: `"pageSize" must be one of ${PAGE_SIZES.join(", ")}; got "${sizeRaw}".`,
      };
    }
    pageSize = parsed as PageSize;
  }

  return { ok: true, page, pageSize };
}

/**
 * Parse `GET /serials`' query string, or refuse it with a sentence an operator
 * can act on.
 *
 * Everything that could be misread is rejected here rather than downstream:
 * the route turns `{ok:false}` straight into a 400 and never has to decide
 * what to do with a half-understood filter.
 */
export function parseSerialQuery(params: URLSearchParams): SerialQueryResult {
  const qRaw = (params.get("q") ?? "").trim();
  if (qRaw.length > MAX_QUERY_LENGTH) {
    return {
      ok: false,
      error: `"q" must be at most ${MAX_QUERY_LENGTH} characters.`,
    };
  }

  const status = readTokenList(params, "status", LICENCE_STATUSES);
  if (!status.ok) return { ok: false, error: status.error };

  const paymentStatus = readTokenList(params, "paymentStatus", PAYMENT_STATUSES);
  if (!paymentStatus.ok) return { ok: false, error: paymentStatus.error };

  const planCode = readTokenList(params, "planCode", PLAN_CODES);
  if (!planCode.ok) return { ok: false, error: planCode.error };

  const customerKind = readTokenList(params, "customerKind", CUSTOMER_KINDS);
  if (!customerKind.ok) return { ok: false, error: customerKind.error };

  const hostBinding = readTokenList(params, "hostBinding", HOST_BINDING_STATUSES);
  if (!hostBinding.ok) return { ok: false, error: hostBinding.error };

  const delivery = readTokenList(params, "delivery", DELIVERY_STATUSES);
  if (!delivery.ok) return { ok: false, error: delivery.error };

  const expiry = readExpiryWindow(params);
  if (!expiry.ok) return { ok: false, error: expiry.error };

  const page = readPage(params);
  if (!page.ok) return { ok: false, error: page.error };

  return {
    ok: true,
    spec: {
      q: qRaw === "" ? null : qRaw,
      status: status.values as readonly LicenceStatus[],
      paymentStatus: paymentStatus.values as readonly PaymentStatus[],
      planCode: planCode.values as readonly PlanCode[],
      customerKind: customerKind.values,
      hostBinding: hostBinding.values as readonly HostBindingStatus[],
      delivery: delivery.values as readonly DeliveryStatus[],
      validityEndsWithinDays: expiry.days,
      page: page.page,
      pageSize: page.pageSize,
    },
  };
}

/**
 * The five search fields, OR-ed, against one escaped pattern.
 *
 * `mobile_serials.id` is a `uuid`, and Postgres has no `uuid ILIKE text`
 * operator - the cast is required, not decorative. The exact-UUID branch is
 * separate because `id::text ilike '%<full uuid>%'` cannot use the primary key
 * whereas `id = $1` can; typing a whole licence ID is the one case where the
 * index is worth having.
 */
function searchPredicate(spec: SerialQuerySpec): SQL | undefined {
  if (spec.q === null) return undefined;
  const pattern = `%${escapeLike(spec.q)}%`;

  const asText = sql`${mobileSerials.id}::text ilike ${pattern}`;
  const licenceId = isUuid(spec.q)
    ? (or(eq(mobileSerials.id, spec.q), asText) ?? asText)
    : asText;

  return (
    or(
      ilike(mobileSerials.customerEmail, pattern),
      ilike(mobileSerials.customerFullName, pattern),
      ilike(mobileSerials.companyName, pattern),
      licenceId,
      ilike(mobileSerials.publicNumber, pattern),
    ) ?? undefined
  );
}

/**
 * Payment status lives on another table, so it is a correlated `EXISTS`.
 *
 * Chosen over a join deliberately. `payments.licence_id` carries an FK and a
 * btree index but no UNIQUE constraint (migration 0007), so a join could
 * multiply rows and a `count()` over it would report a register larger than
 * the one it served - the exact opposite of "truncation impossible to ignore".
 * `EXISTS` is one row in or out regardless of how many payment rows ever
 * exist, and it keeps `count(*)` counting licences.
 */
function paymentPredicate(statuses: readonly PaymentStatus[]): SQL | undefined {
  if (statuses.length === 0) return undefined;
  return sql`exists (
    select 1 from payments
     where payments.licence_id = ${mobileSerials.id}
       and payments.status in (${sql.join(
         statuses.map((value) => sql`${value}`),
         sql`, `,
       )})
  )`;
}

/**
 * Every predicate this query implies, as separate conditions.
 *
 * Returned as an array rather than one pre-joined `and(...)` so that the
 * caller can pass the *same* list to both the row query and the count query.
 * Building it twice by hand is how a filtered list and its total come to
 * disagree, which would make `hasMore` a lie.
 *
 * `now` is OPTIONAL in signature and REQUIRED in effect: it is dereferenced
 * only inside the expiry-window branch, so the 22 existing one-argument calls
 * in `search.test.ts` keep working untouched, while a window supplied without
 * a clock throws rather than quietly matching nothing. Silence would be the
 * worst answer here - an empty "Expiring Soon" card and an empty card that
 * means "nothing expires soon" are indistinguishable, and an operator would
 * reasonably believe the first one.
 */
export function serialQueryConditions(spec: SerialQuerySpec, now?: Date): SQL[] {
  const conditions: SQL[] = [];

  const search = searchPredicate(spec);
  if (search) conditions.push(search);
  if (spec.status.length > 0) {
    conditions.push(inArray(mobileSerials.status, spec.status));
  }
  if (spec.planCode.length > 0) {
    conditions.push(inArray(mobileSerials.planCode, spec.planCode));
  }
  if (spec.customerKind.length > 0) {
    conditions.push(inArray(mobileSerials.customerKind, spec.customerKind));
  }
  if (spec.hostBinding.length > 0) {
    conditions.push(inArray(mobileSerials.hostBindingStatus, spec.hostBinding));
  }
  const payment = paymentPredicate(spec.paymentStatus);
  if (payment) conditions.push(payment);

  if (spec.validityEndsWithinDays !== null) {
    if (!now) {
      throw new Error(
        'serialQueryConditions: "now" is required when validityEndsWithinDays is set.',
      );
    }
    const horizon = new Date(
      now.getTime() + spec.validityEndsWithinDays * 86_400_000,
    );
    /*
     * BOTH bounds, and the lower one matters as much as the upper.
     *
     * `lte` alone would also match a licence that expired last year, putting a
     * long-dead record into an "Expiring Soon" card and quietly inflating the
     * number until it means nothing.
     *
     * NULL never satisfies either comparison, so a pre-W5 row with no stored
     * window is excluded automatically - which is correct (a licence with no
     * expiry date cannot be expiring) and is exactly the predicate the partial
     * index `idx_mobile_serials_validity_ends_at` is built on, so the query
     * stays on the index rather than falling back to a scan.
     */
    conditions.push(
      gte(mobileSerials.validityEndsAt, now),
      lte(mobileSerials.validityEndsAt, horizon),
    );
  }

  /*
   * Delivery is an OR, never an AND.
   *
   * `delivery=SENT,FAILED` is a natural thing for a UI to emit - "show me
   * every licence whose delivery I should look at" - and AND-ing two mutually
   * exclusive predicates would produce `email_error IS NULL AND email_error IS
   * NOT NULL`, which matches no rows at all. That would render as "no delivery
   * problems", i.e. the exact opposite of the truth, with a 200 and a zero
   * count. Refusing to build the predicate instead of building a contradictory
   * one is the same discipline `readTokenList` applies to unknown tokens.
   */
  if (spec.delivery.includes("FAILED")) {
    conditions.push(isNotNull(mobileSerials.emailError));
  } else if (spec.delivery.includes("SENT")) {
    const sent = and(
      isNotNull(mobileSerials.emailedAt),
      isNull(mobileSerials.emailError),
    );
    if (sent) conditions.push(sent);
  }

  return conditions;
}

/** `and(...)` over the conditions, or `undefined` when there are none. */
export function serialQueryWhere(spec: SerialQuerySpec, now?: Date): SQL | undefined {
  const conditions = serialQueryConditions(spec, now);
  return conditions.length === 0 ? undefined : (and(...conditions) ?? undefined);
}

/**
 * The pagination block returned with every `GET /serials` response.
 *
 * Every field is always present. `hasMore` and `total` are the two the client
 * cannot be allowed to miss, and both are computed here from one place so the
 * row query and the count query cannot be folded into a shape where one of
 * them is absent.
 */
export interface Pagination {
  /** 1-based. `page` is what the caller asked for; `offset` is what was sent. */
  readonly page: number;
  readonly pageSize: PageSize;
  readonly offset: number;
  /** Rows in this response. */
  readonly returned: number;
  /** Rows matching the query, across every page. */
  readonly total: number;
  readonly totalPages: number;
  /** True when matching rows exist beyond this response. */
  readonly hasMore: boolean;
  /** `page + 1` when there is one, else `null` - enough to build paging UI. */
  readonly nextPage: number | null;
}

export function paginationFor(
  spec: { readonly page: number; readonly pageSize: PageSize },
  returned: number,
  total: number,
): Pagination {
  const offset = offsetOf(spec);
  const hasMore = offset + returned < total;
  return {
    page: spec.page,
    pageSize: spec.pageSize,
    offset,
    returned,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / spec.pageSize),
    hasMore,
    nextPage: hasMore ? spec.page + 1 : null,
  };
}

/**
 * The parsed query, as a plain object, for echoing back to the client and for
 * the `filters` field of an export's audit row.
 *
 * Empty filters are omitted rather than sent as `[]`: an audit row recording
 * `{status: []}` says the exporter filtered on status and matched everything,
 * when the truth is that status was never part of the question.
 */
export function filtersFor(spec: SerialQuerySpec): Record<string, unknown> {
  const filters: Record<string, unknown> = {};
  if (spec.q !== null) filters.q = spec.q;
  if (spec.status.length > 0) filters.status = [...spec.status];
  if (spec.paymentStatus.length > 0) filters.paymentStatus = [...spec.paymentStatus];
  if (spec.planCode.length > 0) filters.planCode = [...spec.planCode];
  if (spec.customerKind.length > 0) filters.customerKind = [...spec.customerKind];
  if (spec.hostBinding.length > 0) filters.hostBinding = [...spec.hostBinding];
  if (spec.delivery.length > 0) filters.delivery = [...spec.delivery];
  // Omitted entirely when absent, never `null` and never `0`: an audit row
  // reading `{validityEndsWithinDays: null}` says somebody asked about expiry
  // and got no answer, when the truth is that expiry was never part of the
  // question. Same reasoning the existing five filters use.
  if (spec.validityEndsWithinDays !== null) {
    filters.validityEndsWithinDays = spec.validityEndsWithinDays;
  }
  return filters;
}
