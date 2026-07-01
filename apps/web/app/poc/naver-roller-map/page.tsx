import { NaverRollerMapPoC } from "@/components/naver/NaverRollerMapPoC";

/**
 * Renders the isolated Naver Maps and Roller overlay proof of concept.
 */
export default function NaverRollerMapPage() {
  const naverMapsClientId =
    process.env.NEXT_PUBLIC_NAVER_MAPS_CLIENT_ID ??
    process.env.NEXT_PUBLIC_NCP_MAPS_CLIENT_ID ??
    "";

  return <NaverRollerMapPoC naverMapsClientId={naverMapsClientId} />;
}
