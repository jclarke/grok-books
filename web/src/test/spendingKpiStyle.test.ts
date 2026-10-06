// @ts-expect-error -- web has no @types/node; vitest runs this in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const files = ["personal.css", "components.css"];
const forbidden = /(^|[;\s])(background|border|border-left|border-color|box-shadow)\s*:|brand-soft|gradient/;

describe("Spending Spent KPI style", () => {
  for (const file of files) {
    it(`${file}: .kpi--primary does not override the plain .card surface`, () => {
      const css = readFileSync(new URL(`../styles/${file}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      // Innermost rule blocks only; @media wrappers are skipped because their body contains braces.
      for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!selector.includes("kpi--primary")) continue;
        expect(body, `${selector.trim()} in ${file}`).not.toMatch(forbidden);
      }
    });
  }
});
