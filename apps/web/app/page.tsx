import { randomUUID } from "node:crypto";
import { PlanmeSearchHome } from "@/components/planme-search/PlanmeSearchHome";

type HomeProps = {
  searchParams: Promise<{ q?: string | string[] }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const query = Array.isArray(params.q) ? params.q[0] : params.q;

  return (
    <PlanmeSearchHome
      initialDestination={query?.trim().slice(0, 100) ?? ""}
      initialSubmissionId={randomUUID()}
    />
  );
}
