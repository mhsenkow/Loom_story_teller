import type { MetadataRoute } from "next";

export const dynamic = "force-static";
export const revalidate = false;

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://loom.ibm.io";
  return [
    { url: `${base}/`, lastModified: new Date(), changeFrequency: "weekly", priority: 1 },
    { url: `${base}/privacy.html`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
  ];
}
