// Re-compose prompts for 4 panels using the new composePanelPrompt.
// Reads from DB, composes, writes back, then renders via the API.

const PROJECT_ID = "11bfd1c8-6d79-45e7-acf4-9fcd4b294571";
const PANEL_IDS = [
  "2f5229ff-8298-46d7-9c89-324688b43703",
  "7b3039bd-9a1f-4b28-8399-8c720fd0b8e6",
  "33549ce1-a46c-4f9b-82ab-f67a335e705b",
  "3af5b812-c31d-4a4a-86c1-6e9eab793ae0",
];

const DB_URL = "postgres://audiocomic:audiocomic@localhost:5432/audiocomic";

// Use pg to read from DB
const { Client } = await import("pg");
const client = new Client({ connectionString: DB_URL });
await client.connect();

// Fetch sections
const sectionsRes = await client.query(
  "SELECT id, project_id as \"projectId\", parent_id as \"parentId\", level, index, summary, title, emotional_tone as \"emotionalTone\", characters_present as \"charactersPresent\", objects, camera_hint as \"cameraHint\" FROM story_sections WHERE project_id = $1",
  [PROJECT_ID],
);
const sections = sectionsRes.rows;
console.log("Sections:", sections.length);

// Fetch characters
const charsRes = await client.query(
  "SELECT id, project_id as \"projectId\", name, description, palette_notes as \"paletteNotes\", negative_constraints as \"negativeConstraints\", canonical_face_ref as \"canonicalFaceRef\", outfit_refs as \"outfitRefs\" FROM character_profiles WHERE project_id = $1",
  [PROJECT_ID],
);
const characters = charsRes.rows;
console.log("Characters:", characters.length);

// Fetch world bible
const bibleRes = await client.query(
  "SELECT project_id as \"projectId\", setting, art_style as \"artStyle\", art_style_negative as \"artStyleNegative\", color_palette as \"colorPalette\", tone FROM world_bibles WHERE project_id = $1",
  [PROJECT_ID],
);
const worldBible = bibleRes.rows[0] ?? { setting: "", artStyle: "anime", artStyleNegative: [], colorPalette: [], tone: "humorous" };
console.log("World bible:", !!worldBible);

// Fetch the 4 panels with their page data
const panelsRes = await client.query(
  `SELECT p.id, p.project_id as "projectId", p.page_id as "pageId", p.index, p.story_section_id as "storySectionId",
          p.bbox, p.description, p.render_prompt as "renderPrompt", p.render_negative_prompt as "renderNegativePrompt",
          p.camera_framing as "cameraFraming", p.characters, p.dialogue_lines as "dialogueLines", p.seed
   FROM panel_specs p WHERE p.id = ANY($1)`,
  [PANEL_IDS],
);
const panels = panelsRes.rows;
console.log("Panels to re-compose:", panels.length);

// Import compose functions
const { composePanelPrompt, composeNegativePrompt } = await import("../packages/ai/src/prompt.ts");

const sectionMap = new Map(sections.map((s) => [s.id, s]));

for (const panel of panels) {
  const section = sectionMap.get(panel.storySectionId);
  if (!section) {
    console.log(`Section not found for panel ${panel.id}`);
    continue;
  }

  const panelCharacters = characters.filter((c) =>
    panel.characters?.some((pc) => pc.characterId === c.id),
  );

  const prompt = composePanelPrompt(panel, section, panelCharacters, worldBible, sections);
  const negativePrompt = composeNegativePrompt(panel, panelCharacters, worldBible);

  // Update DB
  await client.query(
    "UPDATE panel_specs SET render_prompt = $1, render_negative_prompt = $2, render_result_id = NULL WHERE id = $3",
    [prompt, negativePrompt, panel.id],
  );
  console.log(`✓ Panel ${panel.id} prompt updated (${prompt.length} chars, neg: ${negativePrompt.length} chars)`);
}

await client.end();
console.log("\nPrompts re-composed. Now rendering via API...");

// Render each panel
for (const panelId of PANEL_IDS) {
  console.log(`Rendering ${panelId}...`);
  try {
    const res = await fetch(`http://localhost:3000/api/panels/${panelId}/regenerate`, {
      method: "POST",
    });
    const data = await res.json();
    if (res.ok) {
      console.log(`  ✓ done: ${data.imageKey}`);
    } else {
      console.log(`  ✗ failed: ${data.error}`);
    }
  } catch (e) {
    console.log(`  ✗ error: ${e}`);
  }
}

console.log("\nAll done!");
