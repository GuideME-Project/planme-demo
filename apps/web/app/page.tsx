import { redirect } from "next/navigation";
import { defaultLocale } from "@/lib/i18n/routing";

export default function Home() {
  redirect(`/${defaultLocale}`);
}
