import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { PlanmeSearchHome } from "@/components/planme-search/PlanmeSearchHome";
import { PlanmeHome } from "@/components/home/PlanmeHome";

export const metadata: Metadata = {
  title: "나만의 여행을 시작하세요",
  description: "PlanME에서 나만의 여행 일정을 만들고, 항공·숙소·투어를 살펴보세요.",
  openGraph: {
    title: "PlanME · 나만의 여행을 시작하세요",
    description: "여행 계획부터 현지에서의 새로운 만남까지, GuideME와 함께하세요.",
    images: ["/og"],
    type: "website",
  },
};

type HomeProps = {
  searchParams: Promise<{ q?: string | string[] }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const query = Array.isArray(params.q) ? params.q[0] : params.q;

  return (
    <PlanmeHome>
      <PlanmeSearchHome
        initialDestination={query?.trim().slice(0, 100) ?? ""}
        initialSubmissionId={randomUUID()}
      />
    </PlanmeHome>
  );
}
