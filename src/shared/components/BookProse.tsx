import { useMemo } from 'react';
import { parseBookText } from '@server/shared/bookText';
import { cn } from '@/shared/lib/utils';

/**
 * Texte d'ouvrage composé comme à l'impression : titres de section et sous-titres en gras,
 * paragraphes séparés, listes à puces et étapes numérotées en retrait.
 *
 * Même lecture de la structure que le PDF et le DOCX (server/shared/bookText) : ce que l'auteur
 * lit ici est ce qu'il téléchargera.
 */
export function BookProse({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseBookText(text), [text]);
  return (
    <div className={cn('space-y-3 text-[15px] leading-relaxed', className)}>
      {blocks.map((block, index) => {
        if (block.type === 'h2') {
          return (
            <h4 key={index} className="pt-3 font-display text-lg font-bold tracking-tight first:pt-0">
              {block.text}
            </h4>
          );
        }
        if (block.type === 'h3') {
          return (
            <h5 key={index} className="pt-1.5 text-base font-semibold first:pt-0">
              {block.text}
            </h5>
          );
        }
        if (block.type === 'ul') {
          return (
            <ul key={index} className="list-disc space-y-1.5 pl-5 marker:text-brand-green-text">
              {block.items.map((item, rank) => (
                <li key={rank}>{item}</li>
              ))}
            </ul>
          );
        }
        if (block.type === 'ol') {
          return (
            <ol key={index} className="list-decimal space-y-1.5 pl-5 marker:font-semibold">
              {block.items.map((item, rank) => (
                <li key={rank}>{item}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={index} className="whitespace-pre-line">
            {block.text}
          </p>
        );
      })}
    </div>
  );
}
