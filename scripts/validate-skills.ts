#!/usr/bin/env bun

/**
 * Validate all skills in the skills/ directory.
 * Checks: YAML frontmatter, internal link resolution, line count.
 */

import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const SKILLS_DIR = resolve(import.meta.dir, "../skills");
const MAX_LINES = 500;

let errors = 0;

interface Frontmatter {
  name?: string;
  description?: string;
  [key: string]: string | undefined;
}

interface EvalsFile {
  evals?: unknown[];
}

function error(skill: string, msg: string): void {
  console.error(`  ✗ [${skill}] ${msg}`);
  errors++;
}

function info(skill: string, msg: string): void {
  console.log(`  ✓ [${skill}] ${msg}`);
}

function parseFrontmatter(content: string): Frontmatter | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match?.[1]) return null;

  const fm: Frontmatter = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");

    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      fm[key] = val;
    }
  }

  return fm;
}

function extractMarkdownLinks(content: string): string[] {
  const links: string[] = [];
  const re = /\[([^\]]*)\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(content)) !== null) {
    const href = m[2]?.split("#")[0];

    if (href && !href.startsWith("http") && !href.startsWith("mailto:")) {
      links.push(href);
    }
  }

  return links;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function validateSkill(skillDir: string, skillName: string): Promise<void> {
  const skillMd = join(skillDir, "SKILL.md");
  const skillFile = Bun.file(skillMd);

  if (!(await skillFile.exists())) {
    error(skillName, "Missing SKILL.md");
    return;
  }

  const content = await skillFile.text();
  const lines = content.split("\n");

  if (lines.length > MAX_LINES) {
    error(skillName, `SKILL.md is ${lines.length} lines (max ${MAX_LINES})`);
  } else {
    info(skillName, `${lines.length} lines`);
  }

  const fm = parseFrontmatter(content);
  if (!fm) {
    error(skillName, "Missing YAML frontmatter (---...---)");
    return;
  }
  if (!fm.name) {
    error(skillName, "Frontmatter missing 'name' field");
  }
  if (!fm.description) {
    error(skillName, "Frontmatter missing 'description' field");
  }
  if (fm.name && fm.name !== skillName) {
    error(
      skillName,
      `Frontmatter name '${fm.name}' does not match directory '${skillName}'`,
    );
  }

  const links = extractMarkdownLinks(content);
  for (const link of links) {
    const target = resolve(skillDir, link);
    if (!(await pathExists(target))) {
      error(skillName, `Broken link: ${link}`);
    }
  }

  const refsDir = join(skillDir, "references");
  if (await pathExists(refsDir)) {
    const refFiles = (await readdir(refsDir)).filter((f) => f.endsWith(".md"));
    info(skillName, `${refFiles.length} reference file(s)`);
  }

  const evalsJson = join(skillDir, "evals", "evals.json");
  if (await pathExists(evalsJson)) {
    try {
      const evals = (await Bun.file(evalsJson).json()) as EvalsFile;
      const count = evals.evals?.length ?? 0;
      info(skillName, `${count} eval(s)`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      error(skillName, `Invalid evals/evals.json: ${msg}`);
    }
  }
}

console.log("Validating skills...\n");

const entries = await readdir(SKILLS_DIR, { withFileTypes: true });
for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  await validateSkill(join(SKILLS_DIR, entry.name), entry.name);
}

console.log(`\n${errors === 0 ? "All checks passed." : `${errors} error(s) found.`}`);
process.exit(errors === 0 ? 0 : 1);
