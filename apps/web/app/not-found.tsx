import { NotFoundState } from "@/components/blocks/not-found-state";
import { Button } from "@/components/ui/button";
import { AppLink, appRoute } from "@/lib/navigation";

/** App-wide 404, shown for unknown URLs and every `notFound()` call. */
export default function NotFoundPage() {
  return (
    <main className="flex min-h-svh flex-col bg-background text-foreground">
      <NotFoundState
        description="The page you are looking for does not exist, or you may not have access to it."
        action={
          <Button variant="secondary" asChild>
            <AppLink href={appRoute.home()}>Go home</AppLink>
          </Button>
        }
      />
    </main>
  );
}
