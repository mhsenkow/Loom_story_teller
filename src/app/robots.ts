import type { MetadataRoute } from "next";

export const dynamic = "force-static";
export const revalidate = false;

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/s/"],
    },
    sitemap: "https://loom.ibm.io/sitemap.xml",
  };
}
