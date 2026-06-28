'use client';

import type { JSX } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useCanvasStore } from '@/stores/canvas-store';
import type { CanvasPageData } from './types';

interface PageThumbnailBarProps {
  pages: CanvasPageData[];
  onReorder: (newOrder: CanvasPageData[]) => void;
}

export function PageThumbnailBar({
  pages,
  onReorder,
}: PageThumbnailBarProps): JSX.Element {
  const { selectedPageId, selectPage } = useCanvasStore();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = pages.findIndex((p) => p.id === active.id);
      const newIndex = pages.findIndex((p) => p.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        onReorder(arrayMove(pages, oldIndex, newIndex));
      }
    }
  };

  if (pages.length === 0) return <div />;

  return (
    <div className="border-t bg-background/95 px-2 py-2 backdrop-blur">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={pages.map((p) => p.id)}
          strategy={horizontalListSortingStrategy}
        >
          <div className="flex gap-2 overflow-x-auto">
            {pages.map((page) => (
              <SortableThumbnail
                key={page.id}
                page={page}
                isSelected={selectedPageId === page.id}
                onClick={() => selectPage(page.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

interface SortableThumbnailProps {
  page: CanvasPageData;
  isSelected: boolean;
  onClick: () => void;
}

function SortableThumbnail({
  page,
  isSelected,
  onClick,
}: SortableThumbnailProps): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: page.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={`relative h-20 w-14 flex-shrink-0 cursor-pointer overflow-hidden rounded border-2 transition-colors ${
        isSelected ? 'border-primary' : 'border-transparent hover:border-muted'
      }`}
    >
      {page.compositeUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={page.compositeUrl}
          alt={`Page ${page.index + 1}`}
          className="h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-muted text-[10px] text-muted-foreground">
          {page.index + 1}
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5 text-center text-[9px] text-white">
        {page.index + 1}
      </div>
    </div>
  );
}
