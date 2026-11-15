"use client";

import { useEffect } from "react";

const MAX_LAST_RESOLVED_VALUE_CACHE_ENTRIES = 100;
const lastResolvedValueCache = new Map<string, unknown>();

interface UseLastResolvedValueOptions<TValue> {
  cacheKey: string | null;
  fallbackCacheKey?: string | null;
  enabled: boolean;
  value: TValue | undefined;
}

function rememberValue(cacheKey: string, value: unknown) {
  if (
    !lastResolvedValueCache.has(cacheKey) &&
    lastResolvedValueCache.size >= MAX_LAST_RESOLVED_VALUE_CACHE_ENTRIES
  ) {
    const oldestKey = lastResolvedValueCache.keys().next().value;
    if (oldestKey) {
      lastResolvedValueCache.delete(oldestKey);
    }
  }

  lastResolvedValueCache.set(cacheKey, value);
}

export function clearLastResolvedValueCacheForTests() {
  lastResolvedValueCache.clear();
}

export function useLastResolvedValue<TValue>({
  cacheKey,
  fallbackCacheKey,
  enabled,
  value,
}: UseLastResolvedValueOptions<TValue>): TValue | undefined {
  useEffect(() => {
    if (!enabled || !cacheKey) {
      return;
    }

    if (value === null) {
      lastResolvedValueCache.delete(cacheKey);
      return;
    }

    if (value !== undefined) {
      rememberValue(cacheKey, value);
      if (fallbackCacheKey) {
        rememberValue(fallbackCacheKey, value);
      }
    }
  }, [cacheKey, enabled, fallbackCacheKey, value]);

  if (value !== undefined) {
    return value;
  }

  if (!enabled || !cacheKey) {
    return undefined;
  }

  const cachedValue = lastResolvedValueCache.get(cacheKey);
  if (cachedValue !== undefined) {
    return cachedValue as TValue;
  }

  if (fallbackCacheKey) {
    return lastResolvedValueCache.get(fallbackCacheKey) as TValue | undefined;
  }

  return undefined;
}
