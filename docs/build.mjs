import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const docsDir = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(docsDir, "dist");

const pages = [
  { file: "index.md", title: "Overview" },
  { file: "collections.md", title: "Collections" },
  { file: "fixtures.md", title: "Fixtures" },
  { file: "configuration.md", title: "Configuration" },
  { file: "isolation.md", title: "How isolation works" },
  { file: "security-review.md", title: "Security review" },
  { file: "adapters.md", title: "Adapters" },
];

const slugify = (text) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

marked.use({
  renderer: {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens);
      return `<h${depth} id="${slugify(text)}">${text}</h${depth}>\n`;
    },
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      const target = href.replace(/^([\w-]+)\.md(#.*)?$/, "$1.html$2");
      return `<a href="${target}"${title ? ` title="${title}"` : ""}>${text}</a>`;
    },
  },
});

const style = `
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.6 system-ui, -apple-system, sans-serif; color: #1a1a1a; }
  .layout { display: flex; max-width: 1100px; margin: 0 auto; }
  nav { width: 220px; flex-shrink: 0; padding: 32px 16px; position: sticky; top: 0; align-self: flex-start; }
  nav a { display: block; padding: 4px 8px; color: inherit; text-decoration: none; border-radius: 4px; }
  nav a[aria-current] { background: #eee; font-weight: 600; }
  nav .name { font-weight: 700; padding: 4px 8px 16px; }
  main { flex: 1; min-width: 0; padding: 32px 24px 64px; max-width: 800px; }
  pre { background: #f5f5f5; padding: 12px 16px; overflow-x: auto; border-radius: 4px; }
  code { font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
  :not(pre) > code { background: #f2f2f2; padding: 1px 4px; border-radius: 3px; }
  table { border-collapse: collapse; width: 100%; display: block; overflow-x: auto; }
  th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; vertical-align: top; }
  @media (max-width: 720px) { .layout { display: block; } nav { position: static; width: auto; padding-bottom: 0; } }
`;

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

for (const page of pages) {
  const markdown = await readFile(path.join(docsDir, page.file), "utf8");
  const body = marked.parse(markdown);
  const output = page.file.replace(/\.md$/, ".html");
  const nav = pages
    .map((item) => {
      const href = item.file.replace(/\.md$/, ".html");
      return `<a href="${href}"${item === page ? ' aria-current="page"' : ""}>${item.title}</a>`;
    })
    .join("\n");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${page.title} · agent-playground</title>
<style>${style}</style>
</head>
<body>
<div class="layout">
<nav><div class="name">agent-playground</div>
${nav}
<a href="https://github.com/enkind/agent-playground">GitHub</a>
</nav>
<main>
${body}
</main>
</div>
</body>
</html>
`;
  await writeFile(path.join(outDir, output), html);
}

console.log(`Built ${pages.length} pages into ${path.relative(process.cwd(), outDir) || outDir}`);
