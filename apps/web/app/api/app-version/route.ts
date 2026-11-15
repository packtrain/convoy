import { getFrontendAppVersion } from "@/lib/app-version";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET() {
  return Response.json(
    { frontend: getFrontendAppVersion() },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}
