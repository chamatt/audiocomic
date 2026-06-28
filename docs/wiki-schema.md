# Wiki Schema — AudioComic Knowledge Base

This file governs how the LLM-wiki knowledge base is built and maintained.
It defines entity types, naming conventions, update rules, and conflict
resolution for the compiled knowledge pages.

## Entity Types

### character
- **Required fields**: name, description, role
- **Optional fields**: aliases, canonical_face_ref, canonical_body_ref, outfit_refs, palette_notes, negative_constraints
- **Page title**: Use canonical name (most frequently used across chapters)
- **Content**: Physical description, personality, role in story, first appearance

### location
- **Required fields**: name, type (indoor|outdoor|abstract|vehicle), description
- **Page title**: Use descriptive name (e.g., "The Dungeon Entrance")
- **Content**: Physical description, atmosphere, significance to plot

### object
- **Required fields**: name, description
- **Page title**: Use the name as first introduced
- **Content**: Description, significance, who uses it, first appearance

### concept
- **Required fields**: name, description
- **Content**: Explanation, related characters, relevance to plot

### event
- **Required fields**: name, description, chapter (where it occurs)
- **Page title**: Include chapter reference (e.g., "Carl enters the dungeon (Ch. 3)")
- **Content**: What happened, who was involved, consequences

### timeline
- **Required fields**: character name, chapter index, state changes
- **Content**: Ordered list of state changes (outfit, location, mood, relationships)

## Naming Conventions

- Character pages: Use the canonical name (most frequently used). Add aliases to the aliases array, don't create separate pages.
- Location pages: Use descriptive names that distinguish similar locations.
- Event pages: Include the chapter number in the title for temporal ordering.

## Update Rules

### When new info supplements existing page
- Merge the new information into the existing content
- Add provenance reference (chapter ID, quote)
- Keep confidence at 1.0

### When new info contradicts existing page
- Keep both pieces of information
- Mark the page with `confidence: 0.5`
- Add a note explaining the contradiction
- The lint pass will flag this for review

### When entity appears in multiple chapters
- Accumulate provenance references from each chapter
- Update the timeline with state changes
- Don't overwrite earlier state — append new state

## Conflict Resolution

### Outfit/appearance changes
- Treated as intentional narrative changes
- Record in CharacterState timeline (don't overwrite canonical appearance)
- The canonical appearance is the first one; subsequent changes are timeline entries

### Relationship changes
- Treated as evolving relationships
- Add new relationship state with chapter provenance
- Don't remove previous relationship states

### Character death
- Mark the character page with `status: deceased`
- Add chapter reference for when death occurred
- Don't remove the character from the bible

### Contradictions (character dead but appears alive)
- Flag with `confidence: 0.5`
- LLM resolves in next lint pass
- If unresolvable, keep both versions with notes

### New aliases
- Add to `aliases[]` array on existing CharacterProfile
- Don't create duplicate profiles
- Use fuzzy matching (name similarity) to detect potential duplicates

## Lint Rules

The lint operation checks for:
1. **Contradictions**: Pages with confidence < 1.0
2. **Orphan pages**: Pages with no cross-references to other pages
3. **Missing information**: Character pages without physical description
4. **Duplicate entities**: Multiple pages for the same character/location
5. **Broken cross-references**: References to non-existent page IDs

## Ingest Workflow

1. Read chapter transcription
2. LLM extraction: identify entities, state changes, events
3. For each entity:
   - Match to existing page by name/alias (fuzzy match)
   - If match: update content, add provenance, check for contradictions
   - If no match: create new page with template
4. Update cross-references between pages
5. Update character timeline with state changes
6. Flag any contradictions for lint pass
7. Append to chapter log
