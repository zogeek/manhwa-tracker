import { Skeleton } from "@/components/ui/skeleton";
import { ManhwaGridSkeleton } from "@/components/manhwa/manhwa-grid";

// Affiché instantanément quand on arrive sur le catalogue depuis une autre page.
export default function Loading() {
  return (
    <>
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-10 w-full" />
      <ManhwaGridSkeleton />
    </>
  );
}
