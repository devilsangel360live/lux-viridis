import { randomBytes, scryptSync } from "node:crypto";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "./index";
import { links, nodes, projects, users, type NewNode, type NodeRoot, type NodeType } from "./schema";
import { idxSequence } from "@/lib/ordering";
import { countWords, docToPlainText } from "@/lib/doc";

/**
 * Seeds a small but structurally complete novel so every view has something
 * real to render: acts with chapters and scenes, a world bible, and a planning
 * board of beats.
 */

function paragraphs(...texts: string[]) {
  return {
    type: "doc",
    content: texts.map((t) => ({
      type: "paragraph",
      content: [{ type: "text", text: t }],
    })),
  };
}

type SeedSpec = {
  type: NodeType;
  root: NodeRoot;
  title: string;
  synopsis?: string;
  body?: unknown;
  meta?: Record<string, unknown>;
  children?: SeedSpec[];
};

const manuscript: SeedSpec[] = [
  {
    type: "act",
    root: "manuscript",
    title: "Act I — The Salt Road",
    synopsis: "Kaelen leaves Varn Hollow and learns the tide is not weather.",
    meta: { status: "drafting", color: "amber" },
    children: [
      {
        type: "chapter",
        root: "manuscript",
        title: "The Rain That Would Not Stop",
        synopsis: "Three days of rain; a body in the reeds.",
        meta: { pov: "Kaelen", status: "draft", target: 2500 },
        children: [
          {
            type: "scene",
            root: "manuscript",
            title: "Reeds at first light",
            synopsis: "Kaelen finds the drowned surveyor and takes his ledger.",
            meta: { pov: "Kaelen", status: "draft", location: "Varn Hollow" },
            body: paragraphs(
              "The rain had not let up for three days, and the reeds at the water's edge had gone the colour of old pewter.",
              "Kaelen found him face-down where the current turned, one hand still closed around a surveyor's ledger, as though the numbers had been worth more than the air.",
              "He did not shout for the others. He knelt, and he read.",
            ),
          },
          {
            type: "scene",
            root: "manuscript",
            title: "What the ledger said",
            synopsis: "The tide tables are wrong — deliberately.",
            meta: { pov: "Kaelen", status: "revised", location: "Varn Hollow" },
            body: paragraphs(
              "The figures were careful, and they were wrong, and the wrongness was too regular to be error.",
              "Someone had been writing the tide a year before it arrived.",
            ),
          },
        ],
      },
      {
        type: "chapter",
        root: "manuscript",
        title: "Varn Hollow",
        synopsis: "The village closes ranks. Mira warns him off.",
        meta: { pov: "Kaelen", status: "outline", target: 3000 },
        children: [
          {
            type: "scene",
            root: "manuscript",
            title: "The long table",
            synopsis: "Nobody will name the surveyor.",
            meta: { pov: "Kaelen", status: "outline", location: "Varn Hollow" },
            body: paragraphs(
              "Twelve people at the long table and not one of them would say the man's name aloud.",
            ),
          },
        ],
      },
    ],
  },
  {
    type: "act",
    root: "manuscript",
    title: "Act II — The Cartographers' Debt",
    synopsis: "The Guild's interest turns from academic to lethal.",
    meta: { status: "outline", color: "slate" },
    children: [
      {
        type: "chapter",
        root: "manuscript",
        title: "A City Built on Corrections",
        synopsis: "Kaelen reaches Ostmere and finds the Guild expecting him.",
        meta: { pov: "Kaelen", status: "outline", target: 3200 },
        children: [
          {
            type: "scene",
            root: "manuscript",
            title: "Arrival by the salt gate",
            synopsis: "The gate clerk already has his name written down.",
            meta: { pov: "Kaelen", status: "todo", location: "Ostmere" },
            body: paragraphs(
              "The clerk did not ask his name. The clerk turned the register around so Kaelen could see it already written there, in a hand he did not know.",
            ),
          },
        ],
      },
    ],
  },
];

const world: SeedSpec[] = [
  {
    type: "folder",
    root: "world",
    title: "Characters",
    children: [
      {
        type: "character",
        root: "world",
        title: "Kaelen Roth",
        synopsis: "Reluctant surveyor's apprentice; reads water better than people.",
        meta: { role: "Protagonist", age: 24, arc: "Obedience → authorship", color: "amber" },
        body: paragraphs(
          "Raised in Varn Hollow by an aunt who taught him to read tide tables before letters.",
          "Wants: to be told what is true. Needs: to decide what is true.",
        ),
      },
      {
        type: "character",
        root: "world",
        title: "Mira Vance",
        synopsis: "Harbourmaster. Knows exactly which records were altered.",
        meta: { role: "Ally / obstacle", age: 51, arc: "Complicity → confession", color: "teal" },
        body: paragraphs(
          "Has kept Varn Hollow solvent for two decades by not asking who corrects the tables.",
        ),
      },
      {
        type: "character",
        root: "world",
        title: "Archivist Oule",
        synopsis: "Guild cartographer. Believes an accurate map is worth a drowned village.",
        meta: { role: "Antagonist", age: 63, arc: "Certainty → zealotry", color: "rose" },
      },
    ],
  },
  {
    type: "folder",
    root: "world",
    title: "Locations",
    children: [
      {
        type: "location",
        root: "world",
        title: "Varn Hollow",
        synopsis: "Tidal village of four hundred, built below the mean high line.",
        meta: { region: "The Salt Road", climate: "Wet, cold, persistent fog" },
      },
      {
        type: "location",
        root: "world",
        title: "Ostmere",
        synopsis: "Guild city of canals and correction houses.",
        meta: { region: "Inner Reach", climate: "Temperate, brackish" },
      },
    ],
  },
  {
    type: "folder",
    root: "world",
    title: "Lore",
    children: [
      {
        type: "lore",
        root: "world",
        title: "The Cartographers' Guild",
        synopsis: "Publishes the tide tables. Publication and prophecy are the same act.",
        meta: { category: "Institution" },
        body: paragraphs(
          "The Guild's founding claim: a map is not a description of the world but a contract with it.",
        ),
      },
      {
        type: "lore",
        root: "world",
        title: "Corrections",
        synopsis: "Official alterations to published tides. Legally, the sea is wrong, not the table.",
        meta: { category: "Rule of the world" },
      },
    ],
  },
];

const planning: SeedSpec[] = [
  {
    type: "folder",
    root: "planning",
    title: "Three-Act Structure",
    children: [
      {
        type: "beat",
        root: "planning",
        title: "Inciting Incident",
        synopsis: "The drowned surveyor and his ledger.",
        meta: { slot: "Act I", tension: 3 },
      },
      {
        type: "beat",
        root: "planning",
        title: "First Threshold",
        synopsis: "Kaelen leaves for Ostmere with the ledger.",
        meta: { slot: "Act I", tension: 5 },
      },
      {
        type: "beat",
        root: "planning",
        title: "Midpoint Reversal",
        synopsis: "The corrections are not a cover-up — they are the method.",
        meta: { slot: "Act II", tension: 8 },
        // A worked example of the canvas: the causal chain behind the reversal.
        children: [
          {
            type: "card",
            root: "planning",
            title: "Kaelen decodes the ledger's second column",
            meta: { x: 60, y: 70 },
          },
          {
            type: "card",
            root: "planning",
            title: "The corrections predate the tides they 'fix'",
            meta: { x: 330, y: 70 },
          },
          {
            type: "card",
            root: "planning",
            title: "So the Guild is not hiding error — it is authoring the sea",
            meta: { x: 600, y: 70 },
          },
          {
            type: "card",
            root: "planning",
            title: "Mira knew, and stayed silent to keep the village solvent",
            meta: { x: 330, y: 210 },
          },
        ],
      },
      {
        type: "beat",
        root: "planning",
        title: "Climax",
        synopsis: "Kaelen publishes a true table and drowns the Guild's authority.",
        meta: { slot: "Act III", tension: 10 },
      },
    ],
  },
];

function insertTree(projectId: string, specs: SeedSpec[], parentId: string | null) {
  const indices = idxSequence(specs.length);
  const rows: NewNode[] = [];

  specs.forEach((spec, i) => {
    const id = nanoid();
    const plain = spec.body ? docToPlainText(spec.body) : "";

    rows.push({
      id,
      projectId,
      parentId,
      root: spec.root,
      type: spec.type,
      idx: indices[i],
      title: spec.title,
      synopsis: spec.synopsis ?? null,
      body: spec.body ?? null,
      plain,
      wordCount: countWords(plain),
      meta: spec.meta ?? {},
    });

    if (spec.children?.length) {
      // Insert the parent before its children so the FK/tree is always valid.
      db.insert(nodes).values(rows.splice(0)).run();
      insertTree(projectId, spec.children, id);
    }
  });

  if (rows.length) db.insert(nodes).values(rows).run();
}

/**
 * Wires the Midpoint Reversal cards into a causal chain, so a fresh install
 * opens on a canvas that demonstrates what the view is for.
 */
function seedCanvasEdges(projectId: string) {
  const cards = db.select().from(nodes).all().filter((n) => n.type === "card");
  const find = (fragment: string) => cards.find((c) => c.title.includes(fragment));

  const chain: Array<[string, string]> = [
    ["decodes the ledger", "predate the tides"],
    ["predate the tides", "authoring the sea"],
    ["Mira knew", "authoring the sea"],
  ];

  for (const [from, to] of chain) {
    const source = find(from);
    const target = find(to);
    if (!source || !target) continue;
    db.insert(links)
      .values({
        id: nanoid(),
        projectId,
        sourceId: source.id,
        targetId: target.id,
        kind: "edge",
      })
      .run();
  }
}

/**
 * Rewrites a few seeded scenes so the character names in them are real
 * @mentions, and records the matching backlink rows. A fresh install then opens
 * on a world bible that already demonstrates what it is for.
 */
function seedMentions(projectId: string) {
  const all = db.select().from(nodes).all();
  const find = (title: string) => all.find((n) => n.title === title);

  const kaelen = find("Kaelen Roth");
  const mira = find("Mira Vance");
  if (!kaelen || !mira) return;

  const rewrites: Array<{ scene: string; content: unknown[]; mentions: string[] }> = [
    {
      scene: "Reeds at first light",
      mentions: [kaelen.id],
      content: [
        { type: "text", text: "The rain had not let up for three days, and the reeds at the water's edge had gone the colour of old pewter. " },
        { type: "mention", attrs: { id: kaelen.id, label: "Kaelen Roth" } },
        { type: "text", text: " found him face-down where the current turned, one hand still closed around a surveyor's ledger, as though the numbers had been worth more than the air." },
      ],
    },
    {
      scene: "The long table",
      mentions: [mira.id],
      content: [
        { type: "text", text: "Twelve people at the long table and not one of them would say the man's name aloud. " },
        { type: "mention", attrs: { id: mira.id, label: "Mira Vance" } },
        { type: "text", text: " looked at the door instead of at him, which was its own kind of answer." },
      ],
    },
  ];

  for (const rewrite of rewrites) {
    const scene = find(rewrite.scene);
    if (!scene) continue;

    const body = { type: "doc", content: [{ type: "paragraph", content: rewrite.content }] };
    const plain = docToPlainText(body);

    db.update(nodes)
      .set({ body, plain, wordCount: countWords(plain) })
      .where(eq(nodes.id, scene.id))
      .run();

    for (const targetId of rewrite.mentions) {
      db.insert(links)
        .values({
          id: nanoid(),
          projectId,
          sourceId: scene.id,
          targetId,
          kind: "mention",
        })
        .run();
    }
  }
}

function main() {
  const existing = db.select().from(projects).all();
  if (existing.length > 0) {
    console.log("database already seeded — skipping");
    return;
  }

  const projectId = nanoid();
  // The demo project needs an owner, since every query is scoped by one.
  // Password is a known dev default; the deployed instance creates its own
  // account through the first-run setup screen instead.
  const userId = nanoid();
  const salt = randomBytes(16).toString("hex");
  const key = scryptSync("password", salt, 64).toString("hex");

  // Recovery answers are hashed the same way passwords are; these match
  // "Fido" and "The Hobbit" after normalisation, so the forgot-password flow
  // can be exercised against the demo account.
  const hashAnswer = (answer: string) => {
    const s = randomBytes(16).toString("hex");
    return `${s}:${scryptSync(answer, s, 64).toString("hex")}`;
  };

  db.insert(users)
    .values({
      id: userId,
      email: "writer@example.com",
      name: "Arindam Pal",
      passwordHash: `${salt}:${key}`,
      recoveryQuestion1: "What was the name of your first pet?",
      recoveryAnswer1: hashAnswer("fido"),
      recoveryQuestion2: "What is your favourite book?",
      recoveryAnswer2: hashAnswer("the hobbit"),
    })
    .run();

  db.insert(projects)
    .values({
      id: projectId,
      ownerId: userId,
      title: "The Salt Road",
      subtitle: "Book One of the Tidewright Cycle",
      author: "Arindam Pal",
    })
    .run();

  insertTree(projectId, manuscript, null);
  insertTree(projectId, world, null);
  insertTree(projectId, planning, null);

  seedCanvasEdges(projectId);
  seedMentions(projectId);

  const count = db.select().from(nodes).all().length;
  const edgeCount = db.select().from(links).all().length;
  console.log(`seeded project "The Salt Road" with ${count} nodes, ${edgeCount} links`);
}

main();
