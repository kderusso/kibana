/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { schema } from '@kbn/config-schema';
import type { IRouter, KibanaResponseFactory, RequestHandler } from '@kbn/core/server';
import type { RouteSecurity } from '@kbn/core-http-server';
import { CONTEXT_ENGINE_ENABLED_SETTING_ID } from '@kbn/management-settings-ids';
import {
  MAX_NAMESPACE_DESCRIPTION_LENGTH,
  MAX_NAMESPACE_ID_LENGTH,
  MAX_NAMESPACE_NAME_LENGTH,
  MAX_NAMESPACE_SOURCE_LENGTH,
  MAX_NAMESPACES,
  namespaceByIdPath,
  namespacePath,
} from '../../common/constants';
import type {
  DeleteNamespaceResponse,
  GetNamespaceResponse,
  ListNamespaceResponse,
  PutNamespaceResponse,
} from '../../common/http_api/namespaces';
import { apiPrivileges } from '../../common/features';
import {
  InvalidNamespaceSourceError,
  NamespaceConflictError,
  NamespaceNotFoundError,
} from '../namespaces/errors';
import type { NamespaceService } from '../namespaces/service';

const API_VERSION = '2023-10-31';

const READ_SECURITY: RouteSecurity = {
  authz: { requiredPrivileges: [apiPrivileges.readContextEngine] },
};

const WRITE_SECURITY: RouteSecurity = {
  authz: { requiredPrivileges: [apiPrivileges.writeContextEngine] },
};

const namespaceIdParamsSchema = schema.object({
  namespaceId: schema.string({
    minLength: 1,
    maxLength: MAX_NAMESPACE_ID_LENGTH,
    meta: { description: 'The unique identifier of the namespace.' },
  }),
});

const putNamespaceBodySchema = schema.object({
  name: schema.string({
    minLength: 1,
    maxLength: MAX_NAMESPACE_NAME_LENGTH,
    meta: {
      description:
        'Display name for the namespace. Separate from the id so it can be renamed if necessary.',
    },
  }),
  description: schema.maybe(
    schema.string({
      maxLength: MAX_NAMESPACE_DESCRIPTION_LENGTH,
      meta: { description: 'Human-readable description of the namespace.' },
    })
  ),
  type: schema.oneOf([schema.literal('data_stream'), schema.literal('index_pattern')], {
    meta: {
      description:
        'The type of the backing source. `data_stream` for a data stream, or `index_pattern` for an index pattern.',
    },
  }),
  source: schema.string({
    minLength: 1,
    maxLength: MAX_NAMESPACE_SOURCE_LENGTH,
    meta: {
      description:
        'The data stream or index pattern (e.g. `foo`, `foo,bar`, `foo*`) the namespace is attached to. Must already exist and match `type`; system indices are not allowed.',
    },
  }),
  metadata: schema.maybe(
    schema.recordOf(schema.string(), schema.any(), {
      meta: { description: 'Arbitrary metadata about the namespace, e.g. for UI purposes.' },
    })
  ),
});

const withContextEngineFeatureFlag =
  <P, Q, B>(handler: RequestHandler<P, Q, B>): RequestHandler<P, Q, B> =>
  async (ctx, request, response) => {
    const { uiSettings } = await ctx.core;
    const isEnabled = await uiSettings.client.get<boolean>(CONTEXT_ENGINE_ENABLED_SETTING_ID);
    if (!isEnabled) {
      return response.notFound();
    }
    return handler(ctx, request, response);
  };

const handleNamespaceError = (error: unknown, response: KibanaResponseFactory) => {
  if (error instanceof InvalidNamespaceSourceError) {
    return response.badRequest({ body: { message: error.message } });
  }
  if (error instanceof NamespaceNotFoundError) {
    return response.notFound({ body: { message: error.message } });
  }
  if (error instanceof NamespaceConflictError) {
    return response.conflict({ body: { message: error.message } });
  }
  throw error;
};

export const registerNamespaceRoutes = ({
  router,
  getNamespaceService,
}: {
  router: IRouter;
  getNamespaceService: () => NamespaceService;
}) => {
  // Create or update a namespace
  router.versioned
    .put({
      path: namespaceByIdPath,
      security: WRITE_SECURITY,
      access: 'public',
      summary: 'Create or update a namespace',
      description:
        'Creates or updates a namespace record attached to an existing index, index pattern, or data stream.',
      options: {
        tags: ['oas-tag:context engine'],
        availability: { stability: 'experimental' },
      },
    })
    .addVersion(
      {
        version: API_VERSION,
        validate: {
          request: {
            params: namespaceIdParamsSchema,
            body: putNamespaceBodySchema,
          },
        },
      },
      withContextEngineFeatureFlag(async (ctx, request, response) => {
        try {
          const status = await getNamespaceService().put(request.params.namespaceId, request.body);
          const body: PutNamespaceResponse = { status };
          return status === 'created' ? response.created({ body }) : response.ok({ body });
        } catch (error) {
          return handleNamespaceError(error, response);
        }
      })
    );

  // Get a namespace by id
  router.versioned
    .get({
      path: namespaceByIdPath,
      security: READ_SECURITY,
      access: 'public',
      summary: 'Get a namespace',
      description: 'Fetches a namespace by id.',
      options: {
        tags: ['oas-tag:context engine'],
        availability: { stability: 'experimental' },
      },
    })
    .addVersion(
      {
        version: API_VERSION,
        validate: {
          request: {
            params: namespaceIdParamsSchema,
          },
        },
      },
      withContextEngineFeatureFlag(async (ctx, request, response) => {
        try {
          const body: GetNamespaceResponse = await getNamespaceService().get(
            request.params.namespaceId
          );
          return response.ok({ body });
        } catch (error) {
          return handleNamespaceError(error, response);
        }
      })
    );

  // List namespaces
  router.versioned
    .get({
      path: namespacePath,
      security: READ_SECURITY,
      access: 'public',
      summary: 'List namespaces',
      description: `Lists registered namespaces, up to a limit of ${MAX_NAMESPACES}.`,
      options: {
        tags: ['oas-tag:context engine'],
        availability: { stability: 'experimental' },
      },
    })
    .addVersion(
      {
        version: API_VERSION,
        validate: false,
      },
      withContextEngineFeatureFlag(async (ctx, request, response) => {
        const body: ListNamespaceResponse = {
          namespaces: await getNamespaceService().list(),
        };
        return response.ok({ body });
      })
    );

  // Delete a namespace
  router.versioned
    .delete({
      path: namespaceByIdPath,
      security: WRITE_SECURITY,
      access: 'public',
      summary: 'Delete a namespace',
      description:
        'Deletes a namespace by id. Only the namespace entry is deleted — backing indices are left untouched and must be removed with the Delete index API if desired.',
      options: {
        tags: ['oas-tag:context engine'],
        availability: { stability: 'experimental' },
      },
    })
    .addVersion(
      {
        version: API_VERSION,
        validate: {
          request: {
            params: namespaceIdParamsSchema,
          },
        },
      },
      withContextEngineFeatureFlag(async (ctx, request, response) => {
        try {
          await getNamespaceService().delete(request.params.namespaceId);
          const body: DeleteNamespaceResponse = { acknowledged: true };
          return response.ok({ body });
        } catch (error) {
          return handleNamespaceError(error, response);
        }
      })
    );
};
