import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");

const read = (relative: string) =>
  readFileSync(path.join(ROOT, relative), "utf8");

type Entry = { name: string; description: string };

const byName = (a: Entry, b: Entry) => a.name.localeCompare(b.name);

const cliEntries = (category: "template" | "example"): Entry[] => {
  const source = read("packages/cli/src/commands/create.ts");
  const pattern = new RegExp(
    `name:\\s*"([^"]+)",[^}]*?description:\\s*"([^"]+)",[^}]*?category:\\s*"${category}"`,
    "g",
  );
  return [...source.matchAll(pattern)]
    .map(([, name = "", description = ""]) => ({ name, description }))
    .sort(byName);
};

const docsEntries = (
  category: "template" | "example",
): (Entry & { command: string })[] => {
  const doc = read("apps/docs/content/docs/(getting-started)/cli.mdx");
  return [
    ...doc.matchAll(
      /^\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*`(npx assistant-ui(?:@latest)? create[^`]*)`\s*\|/gm,
    ),
  ]
    .map(([, name = "", description = "", command = ""]) => ({
      name,
      description,
      command,
    }))
    .filter(
      ({ command }) =>
        /\s(?:-e|--example)\s/.test(command) === (category === "example"),
    )
    .sort(byName);
};

describe("cli.mdx mirrors the CLI's project metadata", () => {
  it.each(["template", "example"] as const)(
    "documents every %s with a description and matching scaffold command",
    (category) => {
      const documented = docsEntries(category);
      expect(documented.map((entry) => entry.name)).toEqual(
        cliEntries(category).map((entry) => entry.name),
      );
      for (const entry of documented) {
        expect(entry.description.trim()).not.toBe("");
        const option =
          category === "template"
            ? /\s(?:-t|--template)\s+(\S+)/
            : /\s(?:-e|--example)\s+(\S+)/;
        const selected = entry.command.match(option)?.[1] ?? "default";
        expect(selected).toBe(entry.name);
      }
    },
  );
});
