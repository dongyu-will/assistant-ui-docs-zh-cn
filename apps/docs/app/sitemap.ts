import type { MetadataRoute } from "next";
import { source } from "@/lib/docs-source";
import { BASE_URL } from "@/lib/constants";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return Promise.all(
    source.getPages().map(async (page) => ({
      url: `${BASE_URL}${page.url}`,
      lastModified: (await page.data.load()).lastModified,
      changeFrequency: "weekly" as const,
      priority: 0.9,
    })),
  );
}
