import { and, count, desc, eq, lt } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@server/db/client';
import { contactMessages } from '@server/db/schema';
import { env, providers } from '@server/env';
import { AppError } from '@server/middleware';
import type { RequestAuth } from '@server/middleware/auth';
import { emailSchema, nameSchema } from '@server/services/auth';
import { sendEmailInBackground } from '@server/services/email';

/**
 * Page Contact : les messages arrivent dans l'administration (et, si une boîte est
 * configurée, en copie par e-mail). Conservés 12 mois, puis effacés.
 */

export const CONTACT_TOPICS = {
  question: 'Question sur le site',
  bug: 'Problème technique',
  partnership: 'Partenariat',
  data: 'Mes données personnelles',
  other: 'Autre',
} as const;

export type ContactTopic = keyof typeof CONTACT_TOPICS;
export const CONTACT_STATUSES = ['new', 'read', 'archived'] as const;
const RETENTION_MS = 365 * 86_400_000;

export const contactSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  topic: z.enum(Object.keys(CONTACT_TOPICS) as [ContactTopic, ...ContactTopic[]]),
  message: z.string().trim().min(10, 'Votre message doit contenir au moins 10 caractères.').max(5000, '5 000 caractères au plus.'),
  /** Champ piège invisible : un robot le remplit, une personne jamais. */
  website: z.string().max(200).optional(),
});

export type ContactInput = z.infer<typeof contactSchema>;

export async function createContactMessage(input: ContactInput, auth: RequestAuth | undefined): Promise<void> {
  // Robot : même réponse qu'un envoi réussi, rien n'est gardé.
  if (input.website) return;

  const db = getDb();
  await db.insert(contactMessages).values({
    userId: auth?.account.user.id ?? null,
    name: input.name,
    email: input.email,
    topic: input.topic,
    message: input.message,
  });
  await db.delete(contactMessages).where(lt(contactMessages.createdAt, new Date(Date.now() - RETENTION_MS)));

  if (providers.email && env.CONTACT_INBOX_EMAIL) {
    const topic = CONTACT_TOPICS[input.topic];
    sendEmailInBackground(
      {
        to: env.CONTACT_INBOX_EMAIL,
        subject: `[Contact] ${topic} — ${input.name}`,
        text: `${topic}\nDe : ${input.name} <${input.email}>\n\n${input.message}`,
        html: `<p><strong>${escape(topic)}</strong><br>De : ${escape(input.name)} &lt;${escape(input.email)}&gt;</p><p style="white-space:pre-wrap">${escape(input.message)}</p>`,
      },
      'copie d’un message de contact',
    );
  }
}

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

export const contactListQuerySchema = z.object({
  status: z.enum(CONTACT_STATUSES).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(1000).catch(1),
  pageSize: z.coerce.number().int().min(5).max(100).catch(20),
});

export async function listContactMessages(query: z.infer<typeof contactListQuerySchema>) {
  const db = getDb();
  const where = query.status ? eq(contactMessages.status, query.status) : undefined;
  const [rows, [total], counts] = await Promise.all([
    db
      .select()
      .from(contactMessages)
      .where(where)
      .orderBy(desc(contactMessages.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ value: count() }).from(contactMessages).where(where),
    db.select({ status: contactMessages.status, value: count() }).from(contactMessages).groupBy(contactMessages.status),
  ]);

  const byStatus = Object.fromEntries(CONTACT_STATUSES.map((status) => [status, counts.find((entry) => entry.status === status)?.value ?? 0]));

  return {
    page: query.page,
    pageSize: query.pageSize,
    total: total?.value ?? 0,
    counts: byStatus as Record<(typeof CONTACT_STATUSES)[number], number>,
    topics: CONTACT_TOPICS,
    entries: rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      name: row.name,
      email: row.email,
      topic: row.topic,
      topicLabel: CONTACT_TOPICS[row.topic as ContactTopic] ?? row.topic,
      message: row.message,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

export const contactStatusSchema = z.object({ status: z.enum(CONTACT_STATUSES) });

export async function setContactMessageStatus(messageId: string | undefined, status: (typeof CONTACT_STATUSES)[number]): Promise<void> {
  const id = z.string().uuid().safeParse(messageId);
  if (!id.success) throw new AppError(404, 'Message introuvable.', 'CONTACT_MESSAGE_NOT_FOUND');
  const updated = await getDb()
    .update(contactMessages)
    .set({ status })
    .where(and(eq(contactMessages.id, id.data)))
    .returning({ id: contactMessages.id });
  if (updated.length === 0) throw new AppError(404, 'Message introuvable.', 'CONTACT_MESSAGE_NOT_FOUND');
}
