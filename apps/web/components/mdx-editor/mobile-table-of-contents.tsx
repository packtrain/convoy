"use client";

import { createContext, useContext, useState, type ReactNode, type RefObject } from "react";

import { ListTree } from "lucide-react";

import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

import type { MdxTocHeading } from "./lib/extract-mdx-headings";
import { MdxTableOfContents } from "./table-of-contents";
import { Button } from "./ui/button";

export type MdxMobileTableOfContentsProps = {
  headings: MdxTocHeading[];
  editorRootRef: RefObject<HTMLElement | null>;
  scrollContainerRef?: RefObject<HTMLElement | null>;
  topOffset?: number;
  title?: string;
  updateHash?: boolean;
};

const MdxMobileTableOfContentsContext = createContext<MdxMobileTableOfContentsProps | null>(null);

export function MdxMobileTableOfContentsProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: MdxMobileTableOfContentsProps | null;
}) {
  return (
    <MdxMobileTableOfContentsContext.Provider value={value}>
      {children}
    </MdxMobileTableOfContentsContext.Provider>
  );
}

export function MdxMobileTableOfContentsToolbarAction() {
  const options = useContext(MdxMobileTableOfContentsContext);

  if (!options) {
    return null;
  }

  return <MdxMobileTableOfContents {...options} />;
}

export function MdxMobileTableOfContents({
  headings,
  editorRootRef,
  scrollContainerRef,
  topOffset,
  title = "Table of contents",
  updateHash,
}: MdxMobileTableOfContentsProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (headings.length === 0) {
    return null;
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Open table of contents"
        title="Open table of contents"
        className="size-7 cursor-pointer rounded-[8px] text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
        onClick={() => setIsOpen(true)}
      >
        <ListTree className="size-4" />
      </Button>

      <Drawer open={isOpen} onOpenChange={setIsOpen} direction="bottom" nested={true}>
        <DrawerContent
          data-testid="mdx-mobile-toc-drawer"
          className="max-h-[70dvh] overflow-hidden"
        >
          <DrawerHeader className="sr-only">
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerDescription>Navigate to a heading in this document.</DrawerDescription>
          </DrawerHeader>
          <div className="min-h-0 overflow-y-auto px-3 pb-5 pt-3">
            <MdxTableOfContents
              headings={headings}
              editorRootRef={editorRootRef}
              scrollContainerRef={scrollContainerRef}
              topOffset={topOffset}
              title={title}
              updateHash={updateHash}
              className="rounded-xl shadow-none lg:static"
              onHeadingSelect={() => setIsOpen(false)}
            />
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
