import { z } from 'zod';
import { BRAND } from '../brand.js';
import { ERROR_CODES } from '../errors.js';
import { routeList, type RouteDef } from './contracts.js';

type JsonSchema = Record<string, unknown>;

const toSchema = (schema: z.ZodType, io: 'input' | 'output'): JsonSchema => {
  const json: JsonSchema = z.toJSONSchema(schema, { io, unrepresentable: 'any' });
  delete json.$schema; // OpenAPI 3.1 already implies the dialect
  return json;
};

const errorSchema: JsonSchema = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message', 'hint', 'details'],
      properties: {
        code: { type: 'string', enum: [...ERROR_CODES] },
        message: { type: 'string' },
        hint: { type: 'string', description: 'The next concrete action to fix the problem.' },
        details: { type: 'object' },
      },
    },
  },
};

function parameters(route: RouteDef): JsonSchema[] {
  const out: JsonSchema[] = [];
  const add = (where: 'path' | 'query', shape: z.ZodRawShape) => {
    for (const [name, field] of Object.entries(shape)) {
      const schema = toSchema(field as z.ZodType, 'input');
      out.push({
        name,
        in: where,
        required: where === 'path' || !(field as z.ZodType).safeParse(undefined).success,
        schema,
        ...(typeof schema.description === 'string' ? { description: schema.description } : {}),
      });
    }
  };
  if (route.params) add('path', route.params.shape);
  if (route.query) add('query', route.query.shape);
  if (route.method === 'POST' || route.method === 'PATCH') {
    out.push({
      name: 'Idempotency-Key',
      in: 'header',
      required: false,
      description:
        'Retrying with the same key returns the first response instead of repeating the action.',
      schema: { type: 'string', maxLength: 255 },
    });
  }
  return out;
}

function operation(route: RouteDef): JsonSchema {
  const responses: JsonSchema = route.redirect
    ? { '302': { description: 'Redirect' } }
    : {
        '200': {
          description: 'OK',
          content: { 'application/json': { schema: toSchema(route.response, 'output') } },
        },
      };
  const error = {
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  };
  responses['4XX'] = { description: 'Client error: read `error.hint` for the fix', ...error };
  responses['5XX'] = { description: 'Server error', ...error };
  const scope = route.auth.kind === 'staff' ? route.auth.scope : null;
  return {
    operationId: route.id,
    summary: route.summary,
    ...(route.description ? { description: route.description } : {}),
    tags: [route.tag],
    security: route.auth.kind === 'public' ? [] : [{ bearerAuth: scope ? [scope] : [] }],
    parameters: parameters(route),
    ...(route.body
      ? {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: toSchema(route.body, 'input') } },
          },
        }
      : {}),
    responses,
  };
}

/** OpenAPI 3.1 document generated from the route contracts. */
export function buildOpenApi(version: string): JsonSchema {
  const paths: Record<string, Record<string, JsonSchema>> = {};
  for (const route of routeList) {
    const path = route.path.replace(/:([a-z_]+)/g, '{$1}');
    paths[path] ??= {};
    paths[path][route.method.toLowerCase()] = operation(route);
  }
  return {
    openapi: '3.1.0',
    info: {
      title: `${BRAND.name} API`,
      version,
      description:
        'Money is always an integer in minor units (cents) plus an ISO 4217 currency. Every error has a code, a message and a hint.',
    },
    servers: [
      {
        url: `https://{project}.supabase.co/functions/v1/${BRAND.slug}-api/v1`,
        variables: { project: { default: 'your-project-ref' } },
      },
    ],
    paths,
    components: {
      schemas: { Error: errorSchema },
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: `A staff session JWT or an API token (${BRAND.tokenPrefix}…).`,
        },
      },
    },
  };
}
