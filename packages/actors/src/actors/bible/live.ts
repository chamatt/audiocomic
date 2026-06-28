import { State } from "@rivetkit/effect";
import { Effect, Layer } from "effect";
import { BibleContent } from "../../lib/schemas.ts";
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
				updatedAt: Date.now(),
			}),
		},
	},
);
