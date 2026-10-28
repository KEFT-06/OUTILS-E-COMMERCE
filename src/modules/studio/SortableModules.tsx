import type { ReactNode } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

/**
 * Liste de modules réordonnables : à la souris, au doigt (appui puis glissement) et au clavier
 * (Espace pour saisir, flèches pour déplacer, Espace pour poser). Seule la poignée déplace : on
 * sélectionne toujours le texte d'un module sans le faire bouger.
 */

const rang = (ids: readonly string[], id: string | number) => ids.indexOf(String(id)) + 1;

export function SortableModules({
  ids,
  onMove,
  children,
}: {
  ids: readonly string[];
  /** Module de l'index `from` posé à l'index `to`. */
  onMove: (from: number, to: number) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(
    // Quelques pixels avant de saisir : un simple appui sur la poignée ne déplace rien.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Module ${rang(ids, active.id)} saisi.`,
    onDragOver: ({ active, over }) => (over ? `Module ${rang(ids, active.id)} au-dessus de la place ${rang(ids, over.id)}.` : undefined),
    onDragEnd: ({ active, over }) => (over ? `Module ${rang(ids, active.id)} posé à la place ${rang(ids, over.id)}.` : `Module ${rang(ids, active.id)} reposé.`),
    onDragCancel: ({ active }) => `Déplacement annulé : le module ${rang(ids, active.id)} reste à sa place.`,
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    onMove(ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: 'Pour déplacer ce module, appuyez sur Espace, utilisez les flèches haut et bas, puis Espace pour le poser, ou Échap pour annuler.',
        },
      }}
    >
      <SortableContext items={[...ids]} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

/** Un module de la liste : `handle` reçoit la poignée à placer où l'on veut dans la carte. */
export function SortableModule({ id, label, className, children }: { id: string; label: string; className?: string; children: (handle: ReactNode) => ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label={label}
      title="Glisser pour déplacer"
      className="flex size-8 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 active:cursor-grabbing"
    >
      <GripVertical className="size-4" aria-hidden="true" />
    </button>
  );
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(className, isDragging && 'relative z-10 shadow-lg ring-2 ring-primary/40')}
    >
      {children(handle)}
    </div>
  );
}
