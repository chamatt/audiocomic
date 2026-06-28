import { State } from "@rivetkit/effect";
import { Effect, Layer } from "effect";
import { BibleContent, CharacterState, WikiPage } from "../../lib/schemas.ts";
import { Bible } from "./api.ts";

/**
 * Live implementation of the {@link Bible} actor.
 *
 * State is the full {@link BibleContent} document. Reads use
 * `State.get(state).pipe(Effect.orDie)` to collapse the schema-error
 * channel; mutations use `State.updateAndGet(state, fn).pipe(Effect.orDie)`
 * so each handler returns the freshly-written document. Every mutation
 * broadcasts a `bibleUpdated` event carrying the new content.
 */
export const BibleLive = Bible.toLayer(
	({ rawRivetkitContext, state }) =>
		Effect.gen(function* () {
			const getState = (): Effect.Effect<BibleContent> =>
				State.get(state).pipe(Effect.orDie);

			const update = (
				fn: (current: BibleContent) => BibleContent,
			): Effect.Effect<BibleContent> =>
				State.updateAndGet(state, fn).pipe(
					Effect.orDie,
					Effect.tap((content) =>
						Effect.sync(() =>
							rawRivetkitContext.broadcast("bibleUpdated", content),
						),
					),
				);

			return Bible.of({
				GetContent: () => getState(),

				UpdateLore: ({ payload }) =>
					update((current) => ({
						...current,
						lore: payload.lore,
						updatedAt: Date.now(),
					})),

				AddCharacter: ({ payload }) =>
					update((current) => ({
						...current,
						characters: [
							...current.characters,
							{ name: payload.name, description: payload.description },
						],
						updatedAt: Date.now(),
					})),

				AddChapter: ({ payload }) =>
					update((current) => ({
						...current,
						chapters: [
							...current.chapters,
							{
								id: payload.id,
								title: payload.title,
								summary: payload.summary,
							},
						],
						updatedAt: Date.now(),
					})),

				UpdateChapter: ({ payload }) =>
					update((current) => ({
						...current,
						chapters: current.chapters.map((chapter) =>
							chapter.id === payload.id
								? {
										...chapter,
										title: payload.title ?? chapter.title,
										summary: payload.summary ?? chapter.summary,
									}
								: chapter,
						),
						updatedAt: Date.now(),
					})),

				UpdateCharacterState: ({ payload }) =>
					update((current) => {
						const entry: CharacterState = {
							characterId: payload.characterId,
							characterName: payload.characterName,
							chapterId: payload.chapterId,
							chapterIndex: payload.chapterIndex,
							outfit: payload.outfit,
							location: payload.location,
							mood: payload.mood,
							notes: payload.notes,
						};
						const existing = (current.characterStates ?? []).findIndex(
							(cs: CharacterState) =>
								cs.characterId === payload.characterId &&
								cs.chapterId === payload.chapterId,
						);
						const characterStates =
							existing === -1
								? [...(current.characterStates ?? []), entry]
								: (current.characterStates ?? []).map((cs: CharacterState, i) =>
										i === existing ? entry : cs,
									);
						return {
							...current,
							characterStates,
							updatedAt: Date.now(),
						};
					}),

				GetCharacterTimeline: ({ payload }) =>
					getState().pipe(
						Effect.map((content) =>
							(content.characterStates ?? [])
								.filter((cs: CharacterState) => cs.characterId === payload.characterId)
								.sort((a: CharacterState, b: CharacterState) => a.chapterIndex - b.chapterIndex)
								.map((cs: CharacterState) => ({
									chapterId: cs.chapterId,
									chapterIndex: cs.chapterIndex,
									outfit: cs.outfit,
									location: cs.location,
									mood: cs.mood,
									notes: cs.notes,
								})),
						),
					),

				MergeChapterKnowledge: ({ payload }) =>
					update((current) => {
						// ── Incremental merge with conflict resolution ──
						// Rules from the wiki schema governance file:
						// 1. Outfit/appearance changes → record in timeline, don't overwrite canonical
						// 2. Relationship changes → add new state with chapter provenance
						// 3. Contradictions (e.g. dead but appears alive) → flag with confidence: 0.5
						// 4. New aliases → add to aliases array, don't create duplicates

						const characters = [...current.characters];
						const characterStates = [...(current.characterStates ?? [])];
						const wikiPages = [...(current.wikiPages ?? [])];

						for (const incoming of payload.characters) {
							const idx = characters.findIndex(
								(c) => c.name === incoming.name,
							);

							if (idx === -1) {
								characters.push({
									name: incoming.name,
									description: incoming.description,
								});
							} else {
								// Merge description — append new info, don't overwrite
								const existing = characters[idx]!;
								const existingDesc = existing.description ?? "";
								const incomingDesc = incoming.description ?? "";
								if (incomingDesc && !existingDesc.includes(incomingDesc)) {
									characters[idx] = {
										...existing,
										description: existingDesc
											? `${existingDesc} ${incomingDesc}`
											: incomingDesc,
									};
								}
							}

							// ── Temporal state tracking with conflict detection ──
							if (incoming.state === undefined) continue;
							const characterId = incoming.name;
							const stateIdx = characterStates.findIndex(
								(cs: CharacterState) =>
									cs.characterId === characterId &&
									cs.chapterId === payload.chapterId,
							);

							// Check previous chapter's state for conflict detection
							const prevState = characterStates
								.filter(
									(cs: CharacterState) =>
										cs.characterId === characterId &&
										cs.chapterId !== payload.chapterId,
								)
								.sort((a, b) => b.chapterIndex - a.chapterIndex)[0];

							let confidence = 1;
							let notes = incoming.state.notes ?? "";

							// Outfit change — record as intentional change with provenance
							if (prevState?.outfit && incoming.state.outfit &&
								prevState.outfit !== incoming.state.outfit) {
								notes = notes
									? `${notes} [outfit changed from: ${prevState.outfit}]`
									: `Outfit changed from: ${prevState.outfit}`;
							}

							// Contradiction detection — character was dead/unconscious but now active
							if (prevState?.mood && incoming.state.mood) {
								const wasIncapacitated =
									prevState.mood === "dead" || prevState.mood === "unconscious";
								const isNowActive =
									incoming.state.mood !== "dead" &&
									incoming.state.mood !== "unconscious";
								if (wasIncapacitated && isNowActive) {
									confidence = 0.5;
									notes = notes
										? `${notes} [CONTRADICTION: was ${prevState.mood} in previous chapter]`
										: `CONTRADICTION: was ${prevState.mood} in previous chapter`;
								}
							}

							const entry: CharacterState = {
								characterId,
								characterName: incoming.name,
								chapterId: payload.chapterId,
								chapterIndex: payload.chapterIndex ?? 0,
								outfit: incoming.state.outfit,
								location: incoming.state.location,
								mood: incoming.state.mood,
								notes,
								confidence,
							};

							if (stateIdx === -1) {
								characterStates.push(entry);
							} else {
								characterStates[stateIdx] = entry;
							}
						}

						// ── Wiki page merge with conflict resolution ──
						for (const incoming of payload.wikiPages) {
							const idx = wikiPages.findIndex(
								(wp: WikiPage) => wp.title === incoming.title,
							);
							const existing = idx !== -1 ? wikiPages[idx] : undefined;

							if (existing) {
								const existingContent = existing.content ?? "";
								const incomingContent = incoming.content ?? "";
								// Detect contradiction — neither content contains the other
								const isContradiction =
									existingContent.length > 0 &&
									incomingContent.length > 0 &&
									!existingContent.includes(incomingContent) &&
									!incomingContent.includes(existingContent);

								wikiPages[idx] = {
									...existing,
									content: isContradiction
										? `${existingContent}\n\n[Also from ch.${payload.chapterIndex ?? 0}: ${incomingContent}]`
										: incomingContent.includes(existingContent)
											? incomingContent
											: `${existingContent} ${incomingContent}`,
									confidence: isContradiction ? 0.5 : existing.confidence ?? 1,
								};
							} else {
								wikiPages.push({
									id: `${incoming.type}:${incoming.title}`,
									type: incoming.type,
									title: incoming.title,
									content: incoming.content,
									confidence: 1,
								});
							}
						}

						return {
							...current,
							characters,
							characterStates,
							wikiPages,
							updatedAt: Date.now(),
						};
					}),

				GetWiki: () =>
					getState().pipe(Effect.map((content) => content.wikiPages ?? [])),
			});
		}),
	{
		state: {
			schema: BibleContent,
			initialValue: () => ({
				id: "default",
				title: "",
				lore: "",
				characters: [],
				chapters: [],
				characterStates: [],
				wikiPages: [],
				updatedAt: Date.now(),
			}),
		},
	},
);
