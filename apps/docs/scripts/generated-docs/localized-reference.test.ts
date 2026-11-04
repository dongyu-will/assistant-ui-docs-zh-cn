import {
  findReferenceDrift,
  protectedReferenceMdx,
  protectedReferenceMeta,
} from "./localized-reference.mts";

const source = `---
title: Widget
description: Widget API reference.
---

import { WidgetProps } from "@/generated/typeDocs";

{/* AUTO-GENERATED PAGE by scripts/generate-api-reference.mts */}
{/* api-reference:start */}
## API Reference

### Widget

Read \`Widget\` with \`useWidget\`. See [the guide](/docs/widget#usage).

<Card title={"Widget guide"} href={"/docs/widget"}>
  {"Read the guide."}
</Card>
<Card title="Examples" href="/docs/examples">Examples</Card>

<ParametersTable
  parameters={[{ name: "enabled", type: "boolean", description: "Enable the widget.", required: true }]}
/>

<ParametersTable {...WidgetProps} />

\`\`\`tsx
const widget = createWidget({ enabled: true });
\`\`\`
{/* api-reference:end */}
`;

const translated = source
  .replace("title: Widget", "title: 组件")
  .replace("Widget API reference.", "组件 API 参考。")
  .replace("## API Reference", "## API 参考")
  .replace("Read `Widget` with `useWidget`.", "用 `useWidget` 读取 `Widget`。")
  .replace("the guide", "指南")
  .replace("Widget guide", "组件指南")
  .replace("Read the guide.", "阅读指南。")
  .replaceAll("Examples", "示例")
  .replace("Enable the widget.", "启用组件。");

describe("localized API reference structure", () => {
  it("allows Chinese prose, display strings and reordered inline identifiers", () => {
    expect(protectedReferenceMdx(translated)).toEqual(
      protectedReferenceMdx(source),
    );
  });

  it.each([
    ["imports", "@/generated/typeDocs", "@/generated/otherDocs"],
    ["bindings", "{...WidgetProps}", "{...OtherProps}"],
    ["parameter names", 'name: "enabled"', 'name: "active"'],
    ["parameter types", 'type: "boolean"', 'type: "string"'],
    ["parameter requirements", "required: true", "required: false"],
    ["card routes", 'href={"/docs/widget"}', 'href={"/docs/missing"}'],
    ["link anchors", "/docs/widget#usage", "/docs/widget#missing"],
    ["code examples", "enabled: true", "enabled: false"],
    ["inline identifiers", "`useWidget`", "`useOtherWidget`"],
    ["generation markers", "api-reference:start", "api-manual:start"],
    ["API headings", "### Widget", "### OtherWidget"],
  ])("rejects changed %s", (_name, before, after) => {
    expect(
      protectedReferenceMdx(translated.replace(before!, after!)),
    ).not.toEqual(protectedReferenceMdx(source));
  });

  it("keeps dynamic JSX expressions protected", () => {
    const dynamic = source.replace(
      'title={"Widget guide"}',
      'title={getTitle("Widget")}',
    );
    expect(
      protectedReferenceMdx(
        dynamic.replace('getTitle("Widget")', 'getTitle("Other")'),
      ),
    ).not.toEqual(protectedReferenceMdx(dynamic));
  });

  it("rejects reparenting JSX elements with the same preorder sequence", () => {
    const moved = source.replace(
      '</Card>\n<Card title="Examples" href="/docs/examples">Examples</Card>',
      '<Card title="Examples" href="/docs/examples">Examples</Card>\n</Card>',
    );
    expect(moved).not.toBe(source);
    expect(protectedReferenceMdx(moved)).not.toEqual(
      protectedReferenceMdx(source),
    );
  });

  it("allows translated headings inside authored manual slots", () => {
    const authored = source.replace(
      "{/* api-reference:end */}",
      "{/* api-manual:Widget:start */}\n### Usage\n{/* api-manual:Widget:end */}\n{/* api-reference:end */}",
    );
    expect(
      protectedReferenceMdx(authored.replace("### Usage", "### 用法")),
    ).toEqual(protectedReferenceMdx(authored));
  });

  it("permits metadata translations while keeping sidebar paths and order", () => {
    const meta = {
      title: "Tools",
      description: "Tool APIs",
      pages: ["index", "tool"],
    };
    const zh = { ...meta, title: "工具", description: "工具 API" };
    expect(protectedReferenceMeta(JSON.stringify(zh))).toEqual(
      protectedReferenceMeta(JSON.stringify(meta)),
    );
    expect(
      protectedReferenceMeta(
        JSON.stringify({ ...zh, pages: ["tool", "index"] }),
      ),
    ).not.toEqual(protectedReferenceMeta(JSON.stringify(meta)));
  });
});

describe("source and translation drift", () => {
  const englishTree = new Map([["widget.mdx", source]]);
  const chineseTree = new Map([["widget.mdx", translated]]);

  it("accepts unchanged English generation and protected Chinese content", () => {
    expect(findReferenceDrift(englishTree, englishTree, chineseTree)).toEqual(
      [],
    );
  });

  it.each([
    ["source prose", source.replace("Read `Widget`", "Create `Widget`")],
    ["signatures", source.replace("enabled: true", "enabled: false")],
  ])(
    "rejects changed generated %s even when Chinese structure matches",
    (_label, output) => {
      expect(
        findReferenceDrift(
          englishTree,
          new Map([["widget.mdx", output!]]),
          chineseTree,
        ),
      ).toContain("widget.mdx: generated English source changed");
    },
  );

  it("rejects removed generated pages", () => {
    expect(findReferenceDrift(englishTree, new Map(), chineseTree)).toContain(
      "widget.mdx: generated English source changed",
    );
  });

  it("rejects added pages without a reviewed English source", () => {
    const added = new Map([...englishTree, ["new.mdx", source]]);
    expect(findReferenceDrift(englishTree, added, chineseTree)).toContain(
      "new.mdx: generated English source changed",
    );
    expect(
      findReferenceDrift(
        englishTree,
        englishTree,
        new Map([...chineseTree, ["new.mdx", translated]]),
      ),
    ).toContain("new.mdx: localized and source file lists differ");
  });

  it("rejects replacing a Chinese page with the English output", () => {
    expect(findReferenceDrift(englishTree, englishTree, englishTree)).toContain(
      "widget.mdx: Chinese translation is missing",
    );
  });

  it("rejects edits to source components in the reference tree", () => {
    const baseline = new Map([
      ["context.tsx", "export const color = '#4a86e8';"],
    ]);
    expect(
      findReferenceDrift(
        baseline,
        baseline,
        new Map([["context.tsx", "export const color = '#000000';"]]),
      ),
    ).toContain("context.tsx: source component changed");
  });
});
