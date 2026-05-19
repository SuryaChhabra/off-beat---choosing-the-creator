import { ResultsView } from "@/components/ResultsView";

type RouteParams = Promise<{ handle: string }>;

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: RouteParams }) {
  const { handle } = await params;
  const decoded = safeDecode(handle);
  return {
    title: `${decoded} — Concept Lab Creator Profile`,
  };
}

export default async function ResultsPage({ params }: { params: RouteParams }) {
  const { handle } = await params;
  const decoded = safeDecode(handle);
  return <ResultsView handle={decoded} />;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
