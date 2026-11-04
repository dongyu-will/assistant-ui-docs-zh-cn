import { remark } from "remark";
import remarkMdx from "remark-mdx";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";
import { isDeepStrictEqual } from "node:util";

const parser = remark().use(remarkMdx).use(remarkGfm);

function isDisplayString(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    return typeof JSON.parse(value) === "string";
  } catch {
    return false;
  }
}

function parameterExpression(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(parameterExpression);
  if (value === null || typeof value !== "object") return value;
  const node = value as Record<string, unknown>;
  const key = node.key as Record<string, unknown> | undefined;
  const propertyValue = node.value as Record<string, unknown> | undefined;
  const displayDescription =
    node.type === "Property" &&
    !node.computed &&
    (key?.name === "description" || key?.value === "description") &&
    propertyValue?.type === "Literal" &&
    typeof propertyValue.value === "string";
  return Object.fromEntries(
    Object.entries(node)
      .filter(
        ([name]) => !["loc", "range", "start", "end", "raw"].includes(name),
      )
      .map(([name, child]) => [
        name,
        displayDescription && name === "value"
          ? { type: "Literal", value: "<display string>" }
          : parameterExpression(child),
      ]),
  );
}

export function protectedReferenceMdx(source: string): unknown[] {
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---\n/);
  if (!frontmatter) throw new Error("Missing API reference frontmatter");
  const fields = frontmatter[1]!.split("\n").map((line) => {
    const field = line.match(/^([\w-]+):(.*)$/);
    if (!field) throw new Error("Expected single-line API reference fields");
    return [
      field[1],
      field[1] === "title" || field[1] === "description"
        ? "<display string>"
        : field[2],
    ];
  });
  const result: unknown[] = [["frontmatter", fields]];
  const inlineCode: string[] = [];
  const links: string[] = [];
  const parents = new WeakMap<object, object>();
  const jsxIds = new WeakMap<object, number>();
  let nextJsxId = 0;
  let inReference = false;
  let manualDepth = 0;
  const tree = parser.parse(source.slice(frontmatter[0].length));
  visit(tree, (node, _index, parent) => {
    if (parent) parents.set(node, parent);
    let ancestor: object | undefined = parent;
    while (ancestor && !jsxIds.has(ancestor)) ancestor = parents.get(ancestor);
    const parentJsxId = ancestor ? jsxIds.get(ancestor) : null;
    switch (node.type) {
      case "heading":
        if (inReference && manualDepth === 0 && node.depth === 3) {
          result.push([
            "api-heading",
            node.children.map((child) =>
              "value" in child ? child.value : child.type,
            ),
          ]);
        }
        break;
      case "code":
        result.push(["code", parentJsxId, node.lang, node.meta, node.value]);
        break;
      case "inlineCode":
        inlineCode.push(node.value);
        break;
      case "link":
      case "definition":
      case "image":
        links.push(JSON.stringify([node.type, node.url, node.title]));
        break;
      case "mdxjsEsm":
        result.push(["esm", node.value]);
        break;
      case "mdxJsxFlowElement":
      case "mdxJsxTextElement":
        jsxIds.set(node, nextJsxId++);
        result.push([
          "jsx",
          parentJsxId,
          node.name,
          node.attributes.map((attribute) => {
            if (attribute.type === "mdxJsxExpressionAttribute") {
              return [attribute.type, attribute.value];
            }
            const value =
              typeof attribute.value === "object" && attribute.value !== null
                ? attribute.value.value
                : attribute.value;
            if (
              node.name === "ParametersTable" &&
              attribute.name === "parameters" &&
              typeof attribute.value === "object" &&
              attribute.value?.data?.estree
            ) {
              return [
                attribute.type,
                attribute.name,
                parameterExpression(attribute.value.data.estree),
              ];
            }
            return [
              attribute.type,
              attribute.name,
              node.name === "Card" &&
              attribute.name === "title" &&
              (typeof attribute.value === "string" || isDisplayString(value))
                ? "<display string>"
                : value,
            ];
          }),
        ]);
        break;
      case "mdxFlowExpression":
      case "mdxTextExpression":
        if (node.value === "/* api-reference:start */") inReference = true;
        if (node.value === "/* api-reference:end */") inReference = false;
        if (
          /^\/\* api-(?:manual|example)(?::.*)?:start \*\/$/.test(node.value)
        ) {
          manualDepth++;
        }
        if (/^\/\* api-(?:manual|example)(?::.*)?:end \*\/$/.test(node.value)) {
          manualDepth--;
        }
        if (
          !(
            parent &&
            "name" in parent &&
            parent.name === "Card" &&
            isDisplayString(node.value)
          )
        ) {
          result.push(["expression", parentJsxId, node.value]);
        }
        break;
    }
  });
  result.push(["inlineCode", inlineCode.sort()], ["links", links.sort()]);
  return result;
}

export function protectedReferenceMeta(source: string): unknown {
  const meta = JSON.parse(source);
  return Object.fromEntries(
    Object.entries(meta).map(([key, value]) => [
      key,
      key === "title" || key === "description" ? "<display string>" : value,
    ]),
  );
}

export function findReferenceDrift(
  baseline: ReadonlyMap<string, string>,
  generated: ReadonlyMap<string, string>,
  translated: ReadonlyMap<string, string>,
): string[] {
  const files = new Set([
    ...baseline.keys(),
    ...generated.keys(),
    ...translated.keys(),
  ]);
  const errors: string[] = [];
  for (const file of [...files].sort()) {
    const source = baseline.get(file);
    if (generated.get(file) !== source) {
      errors.push(`${file}: generated English source changed`);
    }
    const chinese = translated.get(file);
    if (source === undefined || chinese === undefined) {
      errors.push(`${file}: localized and source file lists differ`);
      continue;
    }
    try {
      if (file.endsWith(".mdx") && !/\p{Script=Han}/u.test(chinese)) {
        errors.push(`${file}: Chinese translation is missing`);
      }
      if (!file.endsWith(".mdx") && !file.endsWith(".json")) {
        if (source !== chinese)
          errors.push(`${file}: source component changed`);
        continue;
      }
      const project = file.endsWith(".mdx")
        ? protectedReferenceMdx
        : protectedReferenceMeta;
      if (!isDeepStrictEqual(project(source), project(chinese))) {
        errors.push(`${file}: protected translation structure changed`);
      }
    } catch (error) {
      errors.push(
        `${file}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return errors;
}
