/**
 * One server query, held as state, refetched when it changes.
 *
 * Everything about this hook is arranged so that what the table shows and what
 * the pager says come from the SAME response. They are two fields of one
 * object - `serials` and `pagination` - read from one `SerialListResponse`, and
 * there is no path where the rows are refreshed while a stale `total` sits in
 * the pager. A component that re-derived "total" from `serials.length` would be
 * the defect this hook exists to make unrepresentable.
 *
 * The fetch is keyed on the serialised query, not on a `useState` object
 * identity, so an unchanged filter set does not refire. Concurrent responses
 * are fenced by generation rather than by `AbortController`: `fetch` is not
 * mocked uniformly across this repo's tests, and a generation counter gives the
 * same "last write wins" guarantee without making the hook's correctness depend
 * on the transport implementation.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AdminHttpError, adminClient, buildSerialQuery, type SerialQueryState } from "../client";
import type { SerialListResponse } from "../types";

export interface SerialList {
  query: SerialQueryState;
  patch: (next: Partial<SerialQueryState>) => void;
  replace: (next: SerialQueryState) => void;
  response: SerialListResponse | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * @param initial Starting filters - typically what a chip or KPI clicked.
 */
export function useSerialList(initial: SerialQueryState): SerialList {
  const [query, setQuery] = useState<SerialQueryState>(initial);
  const [response, setResponse] = useState<SerialListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const generation = useRef(0);

  // A caller that changes its `initial` (navigating from a KPI card) must be
  // able to drive the table; but a caller that re-renders must not reset the
  // operator's page back to 1. So this tracks the *serialised* shape, which is
  // identical across re-renders that only rebuild the array literals.
  const initialKey = buildSerialQuery(initial);
  const appliedInitial = useRef(initialKey);

  useEffect(() => {
    if (appliedInitial.current === initialKey) return;
    appliedInitial.current = initialKey;
    setQuery(initial);
  }, [initialKey, initial]);

  const serialised = buildSerialQuery(query);

  useEffect(() => {
    const mine = ++generation.current;
    let cancelled = false;
    setLoading(true);
    setError(null);

    adminClient
      .listSerials(serialised)
      .then((next) => {
        if (cancelled || mine !== generation.current) return;
        setResponse(next);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (cancelled || mine !== generation.current) return;
        /*
         * The response is cleared, not kept.
         *
         * Keeping the previous page on a failure would render the old rows
         * under a pager that still shows the old totals - which is consistent,
         * and therefore believable, and therefore worse than an empty table
         * with a sentence saying the request failed. An operator paging forward
         * through a failure would believe they were seeing new licences.
         */
        setResponse(null);
        setError(cause instanceof Error ? cause.message : "Could not load licences.");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [serialised, nonce]);

  const patch = useCallback((next: Partial<SerialQueryState>) => {
    setQuery((current) => {
      const merged: SerialQueryState = { ...current, ...next };
      // Any change other than paging returns to page 1: keeping page 7 after
      // narrowing a filter to three rows asks the server for an empty offset,
      // and an empty table on page 7 reads as "these licences are gone".
      const paging =
        Object.keys(next).length === 1 && (next.page !== undefined || next.pageSize !== undefined);
      if (!paging) merged.page = 1;
      return merged;
    });
  }, []);

  const replace = useCallback((next: SerialQueryState) => setQuery(next), []);
  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return { query, patch, replace, response, loading, error, reload };
}

/** True for a refusal the operator can act on, versus a transport failure. */
export function isServerRefusal(cause: unknown): cause is AdminHttpError {
  return cause instanceof AdminHttpError && cause.status >= 400 && cause.status < 500;
}
