import { OrganizationProjectDetailPage } from "@/components/blocks/organization/settings/organization-project-detail-page";

export default async function OrganizationProjectDetailRoute({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  return <OrganizationProjectDetailPage projectId={projectId} />;
}
