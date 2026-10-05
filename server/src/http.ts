import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest, RawReplyDefaultExpression, RawRequestDefaultExpression, RawServerDefault } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import Type, { type Static, type TSchema } from 'typebox';
import type { AuthContext, AuthUser } from './core/permissions.ts';
import { unauthorized } from './core/errors.ts';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext;
  }
}

export type App = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  FastifyBaseLogger,
  TypeBoxTypeProvider
>;

export type Req = FastifyRequest;
export type Reply = FastifyReply;

export function requireUser(req: FastifyRequest): AuthUser {
  if (!req.auth.user) throw unauthorized();
  return req.auth.user;
}

/* ---------------------- wiederverwendbare Schemas ---------------------- */

export const IdParam = Type.Object({ id: Type.Integer({ minimum: 1 }) });
export const KeyParam = Type.Object({ key: Type.String({ minLength: 1, maxLength: 64 }) });

export const Paging = {
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
};

/**
 * Wert oder `null`. Bewusst `nullable: true` statt `Type.Union([schema, Type.Null()])`: Mit
 * `coerceTypes` wandelt AJV `null` im ersten Zweig einer Union in `0` bzw. `""` um – aus „keine
 * verantwortliche Person“ würde Person 0, aus „Vorgabe des Bereichs“ das Intervall 0. Bei
 * `nullable` bleibt `null` erhalten, und das Schema ist gültiges OpenAPI 3.0.
 */
export const Nullable = <T extends TSchema>(schema: T) => Type.Unsafe<Static<T> | null>({ ...schema, nullable: true });

export function page<T>(items: T[], total: number, limit: number, offset: number) {
  return { items, total, limit, offset };
}
