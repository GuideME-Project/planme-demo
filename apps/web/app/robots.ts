import type { MetadataRoute } from "next";

/** Blocks well-behaved crawlers from APIs and unlisted itinerary links. This is advisory, not access control. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/itinerary/", "/ko/itinerary/", "/en/itinerary/"],
    },
  };
}
