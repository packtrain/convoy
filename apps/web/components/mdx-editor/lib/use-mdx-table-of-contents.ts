"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { MdxTocHeading } from "./extract-mdx-headings";

type ScrollTarget = HTMLElement | Window;

export type UseMdxTableOfContentsOptions = {
  headings: MdxTocHeading[];
  editorRootRef: React.RefObject<HTMLElement | null>;
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
  topOffset: number;
  updateHash: boolean;
};

const editorHeadingSelector =
  ".mdx-editor-kit__content h1, .mdx-editor-kit__content h2, .mdx-editor-kit__content h3, .mdx-editor-kit__content h4, .mdx-editor-kit__content h5, .mdx-editor-kit__content h6";
const clickedHeadingLockMs = 1200;

export function useMdxTableOfContents({
  headings,
  editorRootRef,
  scrollContainerRef,
  topOffset,
  updateHash,
}: UseMdxTableOfContentsOptions) {
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(
    headings[0]?.id ?? null
  );
  const hasAppliedInitialHashRef = useRef(false);
  const clickedHeadingIdRef = useRef<string | null>(null);
  const clickedHeadingReleaseTimerRef = useRef<number | null>(null);
  const visibleActiveHeadingId = headings.some((heading) => heading.id === activeHeadingId)
    ? activeHeadingId
    : (headings[0]?.id ?? null);

  const lockActiveHeading = useCallback((headingId: string | null) => {
    if (clickedHeadingReleaseTimerRef.current !== null) {
      window.clearTimeout(clickedHeadingReleaseTimerRef.current);
    }

    clickedHeadingIdRef.current = headingId;
    setActiveHeadingId(headingId);
    clickedHeadingReleaseTimerRef.current = window.setTimeout(() => {
      clickedHeadingIdRef.current = null;
      clickedHeadingReleaseTimerRef.current = null;
    }, clickedHeadingLockMs);
  }, []);

  const scrollHeadingIntoView = useCallback(
    (headingElement: HTMLElement, behavior: ScrollBehavior) => {
      const scrollTarget = getScrollTarget(scrollContainerRef);

      if (isWindowScrollTarget(scrollTarget)) {
        window.scrollTo({
          top: window.scrollY + headingElement.getBoundingClientRect().top - topOffset,
          behavior,
        });
        return;
      }

      const containerRect = scrollTarget.getBoundingClientRect();
      const headingRect = headingElement.getBoundingClientRect();

      scrollTarget.scrollTo({
        top: scrollTarget.scrollTop + headingRect.top - containerRect.top - topOffset,
        behavior,
      });
    },
    [scrollContainerRef, topOffset]
  );

  useEffect(() => {
    const editorRoot = editorRootRef.current;

    if (!editorRoot || headings.length === 0) {
      return;
    }

    let frameId: number | null = null;

    const syncHeadingIds = () => {
      frameId = null;
      const headingElements = getEditorHeadingElements(editorRoot).slice(0, headings.length);

      headingElements.forEach((element, index) => {
        const heading = headings[index];

        if (!heading) {
          return;
        }

        element.id = heading.id;
        element.style.scrollMarginTop = `${topOffset}px`;
      });

      const hashHeadingId = getCurrentHashHeadingId();

      if (hasAppliedInitialHashRef.current || !hashHeadingId) {
        hasAppliedInitialHashRef.current = true;
        return;
      }

      const hashHeadingIndex = headings.findIndex((heading) => heading.id === hashHeadingId);
      const hashHeadingElement = headingElements[hashHeadingIndex];

      if (!hashHeadingElement) {
        return;
      }

      hasAppliedInitialHashRef.current = true;
      lockActiveHeading(hashHeadingId);
      scrollHeadingIntoView(hashHeadingElement, "auto");
    };

    const scheduleSync = () => {
      if (frameId !== null) {
        return;
      }

      frameId = window.requestAnimationFrame(syncHeadingIds);
    };

    const observer = new MutationObserver(scheduleSync);
    observer.observe(editorRoot, {
      childList: true,
      subtree: true,
    });
    scheduleSync();

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      observer.disconnect();
    };
  }, [editorRootRef, headings, lockActiveHeading, scrollHeadingIntoView, topOffset]);

  useEffect(() => {
    const editorRoot = editorRootRef.current;

    if (!editorRoot || headings.length === 0) {
      return;
    }

    const scrollTarget = getScrollTarget(scrollContainerRef);
    let frameId: number | null = null;

    const updateActiveHeading = () => {
      frameId = null;

      if (clickedHeadingIdRef.current !== null) {
        return;
      }

      const headingElements = getEditorHeadingElements(editorRoot).slice(0, headings.length);

      if (headingElements.length === 0) {
        return;
      }

      let activeIndex = 0;

      for (let index = 0; index < headingElements.length; index += 1) {
        const top = getHeadingTopWithinScrollTarget(headingElements[index], scrollTarget);

        if (top > topOffset) {
          break;
        }

        activeIndex = index;
      }

      setActiveHeadingId(headings[activeIndex]?.id ?? null);
    };

    const scheduleUpdate = () => {
      if (frameId !== null) {
        return;
      }

      frameId = window.requestAnimationFrame(updateActiveHeading);
    };

    scheduleUpdate();
    scrollTarget.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      if (clickedHeadingReleaseTimerRef.current !== null) {
        window.clearTimeout(clickedHeadingReleaseTimerRef.current);
        clickedHeadingReleaseTimerRef.current = null;
        // The pin outlives its release timer otherwise, and a pinned heading
        // makes every later scroll update a no-op.
        clickedHeadingIdRef.current = null;
      }

      scrollTarget.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [editorRootRef, headings, scrollContainerRef, topOffset]);

  const scrollToHeading = useCallback(
    (index: number, behavior: ScrollBehavior = "smooth") => {
      const editorRoot = editorRootRef.current;

      if (!editorRoot) {
        return;
      }

      const headingElement = getEditorHeadingElements(editorRoot)[index];

      if (!headingElement) {
        return;
      }

      const headingId = headings[index]?.id ?? null;

      if (!headingId) {
        return;
      }

      headingElement.id = headingId;
      lockActiveHeading(headingId);

      if (updateHash) {
        window.history.pushState(null, "", `#${encodeURIComponent(headingId)}`);
      }

      scrollHeadingIntoView(headingElement, behavior);
    },
    [editorRootRef, headings, lockActiveHeading, scrollHeadingIntoView, updateHash]
  );

  useEffect(() => {
    if (!updateHash) {
      return;
    }

    const scrollToCurrentHash = () => {
      const hashHeadingId = getCurrentHashHeadingId();

      if (!hashHeadingId) {
        return;
      }

      const headingIndex = headings.findIndex((heading) => heading.id === hashHeadingId);
      const editorRoot = editorRootRef.current;

      if (!editorRoot || headingIndex < 0) {
        return;
      }

      const headingElement = getEditorHeadingElements(editorRoot)[headingIndex];

      if (!headingElement) {
        return;
      }

      lockActiveHeading(hashHeadingId);
      scrollHeadingIntoView(headingElement, "smooth");
    };

    window.addEventListener("hashchange", scrollToCurrentHash);

    return () => {
      window.removeEventListener("hashchange", scrollToCurrentHash);
    };
  }, [editorRootRef, headings, lockActiveHeading, scrollHeadingIntoView, updateHash]);

  return {
    scrollToHeading,
    visibleActiveHeadingId,
  };
}

function getEditorHeadingElements(editorRoot: HTMLElement) {
  return Array.from(
    editorRoot.querySelectorAll<HTMLHeadingElement>(editorHeadingSelector)
  );
}

function getScrollTarget(scrollContainerRef?: React.RefObject<HTMLElement | null>): ScrollTarget {
  return scrollContainerRef?.current ?? window;
}

function getHeadingTopWithinScrollTarget(
  headingElement: HTMLElement | undefined,
  scrollTarget: ScrollTarget
) {
  if (!headingElement) {
    return Number.POSITIVE_INFINITY;
  }

  const headingTop = headingElement.getBoundingClientRect().top;

  if (isWindowScrollTarget(scrollTarget)) {
    return headingTop;
  }

  return headingTop - scrollTarget.getBoundingClientRect().top;
}

function isWindowScrollTarget(scrollTarget: ScrollTarget): scrollTarget is Window {
  return scrollTarget === window;
}

function getCurrentHashHeadingId() {
  if (!window.location.hash) {
    return null;
  }

  try {
    return decodeURIComponent(window.location.hash.slice(1));
  } catch {
    return window.location.hash.slice(1);
  }
}
