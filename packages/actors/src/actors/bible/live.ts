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
						// Upsert characters into the roster by name.
						const characters = [...current.characters];
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
								characters[idx] = {
									name: incoming.name,
									description: incoming.description,
								};
							}
						}

						// Upsert per-character state for this chapter.
						const characterStates = [...(current.characterStates ?? [])];
						for (const incoming of payload.characters) {
							if (incoming.state === undefined) continue;
							const characterId = incoming.name;
							const existing = characterStates.findIndex(
								(cs: CharacterState) =>
									cs.characterId === characterId &&
									cs.chapterId === payload.chapterId,
							);
							const entry: CharacterState = {
								characterId,
								characterName: incoming.name,
								chapterId: payload.chapterId,
								chapterIndex: 0,
								outfit: incoming.state.outfit,
								location: incoming.state.location,
								mood: incoming.state.mood,
								notes: incoming.state.notes,
							};
							if (existing === -1) {
								characterStates.push(entry);
							} else {
								characterStates[existing] = entry;
							}
						}

						// Dedupe wiki pages by title; incoming pages overwrite
						// existing ones with the same title.
						const wikiPages = [...(current.wikiPages ?? [])];
						for (const incoming of payload.wikiPages) {
							const idx = wikiPages.findIndex(
								(wp: WikiPage) => wp.title === incoming.title,
							);
							const existing = idx !== -1 ? wikiPages[idx] : undefined;
							const page = {
								id: existing?.id ?? `${incoming.type}:${incoming.title}`,
								type: incoming.type,
								title: incoming.title,
								content: incoming.content,
								confidence: existing?.confidence ?? 1,
							};
							if (idx === -1) {
								wikiPages.push(page);
							} else {
								wikiPages[idx] = page;
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
