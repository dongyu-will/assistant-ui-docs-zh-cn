import type { InferPageType } from "fumadocs-core/source";
import { loader } from "fumadocs-core/source";
import { lucideIconsPlugin } from "fumadocs-core/source/lucide-icons";
import { toFumadocsSource } from "fumadocs-mdx/runtime/server";
import {
  tapDocs as tapDocsCollection,
  examples as examplePages,
  design as designPages,
  elements as elementsMdx,
  blog as blogPosts,
  careers as careersCollection,
} from "fumadocs-mdx:collections/server";
export { source } from "./docs-source";

export const tapDocs = loader({
  baseUrl: "/tap/docs",
  source: tapDocsCollection.toFumadocsSource(),
  plugins: [lucideIconsPlugin()],
});

const TAP_DOCS_INDEX_SLUG = ["overview", "introduction"];

export function getTapDocsPage(slugs: string[] | undefined) {
  return tapDocs.getPage(
    slugs && slugs.length > 0 ? slugs : TAP_DOCS_INDEX_SLUG,
  );
}

/**
 * The tap docs root is a redirect stub, so it carries no content to index and
 * throws NEXT_REDIRECT when rendered.
 */
export function getTapDocsPages() {
  return tapDocs.getPages().filter((page) => page.slugs.length > 0);
}

export const examples = loader({
  baseUrl: "/examples",
  source: toFumadocsSource(examplePages, []),
});

export type ExamplePage = InferPageType<typeof examples>;

export const elementsDocs = loader({
  baseUrl: "/elements",
  source: toFumadocsSource(elementsMdx, []),
});

export type ElementsDocsPage = InferPageType<typeof elementsDocs>;

export const design = loader({
  baseUrl: "/design",
  source: toFumadocsSource(designPages, []),
});

export type DesignPage = InferPageType<typeof design>;

export const blog = loader({
  baseUrl: "/blog",
  source: toFumadocsSource(blogPosts, []),
});

type BaseBlogPage = InferPageType<typeof blog>;
export type BlogPage = Omit<BaseBlogPage, "data"> & {
  data: BaseBlogPage["data"] & {
    date: Date | undefined;
    author: string;
    externalUrl: string | undefined;
  };
};

export const careers = loader({
  baseUrl: "/careers",
  source: toFumadocsSource(careersCollection, []),
});

type BaseCareerPage = InferPageType<typeof careers>;
export type CareerPage = Omit<BaseCareerPage, "data"> & {
  data: BaseCareerPage["data"] & {
    location: string;
    type: string;
    salary: string;
    summary: string;
    order?: number | undefined;
  };
};
