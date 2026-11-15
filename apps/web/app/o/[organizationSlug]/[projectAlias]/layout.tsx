import type { Metadata } from "next";
import type { ReactNode } from "react";

interface ProjectLayoutProps {
  children: ReactNode;
  params: Promise<{
    organizationSlug: string;
    projectAlias: string;
  }>;
}

export async function generateMetadata(
  props: Omit<ProjectLayoutProps, "children">
): Promise<Metadata> {
  const { projectAlias } = await props.params;

  return {
    title: `${projectAlias} · Convoy`,
  };
}

export default function ProjectLayout({ children }: ProjectLayoutProps) {
  return children;
}
