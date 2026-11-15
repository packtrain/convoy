"use client";

import { useParams } from "next/navigation";

export function useRouteParams<
  T extends Record<string, string | string[] | undefined> = Record<
    string,
    string | string[] | undefined
  >,
>() {
  return useParams<T>();
}
