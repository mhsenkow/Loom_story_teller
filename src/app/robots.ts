import type { MetadataRoute } from "next";

export const dynamic = "force-static";
export const revalidate = false;

export default function robots(): MetadataRoute.Robots {
  // Story links are unguessable and expire. They must stay crawlable:
  // Threads and Facebook skip the chart image when robots.txt disallows the path.
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/"],
    },
    sitemap: "https://loom.ibm.io/sitemap.xml",
  };
}
