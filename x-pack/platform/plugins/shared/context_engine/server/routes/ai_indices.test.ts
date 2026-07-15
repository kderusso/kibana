/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { IRouter, RequestHandler } from '@kbn/core/server';
import { httpServerMock } from '@kbn/core/server/mocks';
import { registerAiIndexRoutes } from './ai_indices';
import { aiIndexByIdPath, aiIndexPath } from '../../common/constants';
import { apiPrivileges } from '../../common/features';
import {
  InvalidAiIndexDestError,
  AiIndexConflictError,
  AiIndexNotFoundError,
} from '../ai_indices/errors';
import type { AiIndexService } from '../ai_indices/service';

interface RegisteredRoute {
  config: {
    path: string;
    access: string;
    security: { authz: { requiredPrivileges: string[] } };
  };
  handler: RequestHandler;
}

describe('ai indices routes', () => {
  let routes: Record<string, RegisteredRoute>;
  let aiIndexService: jest.Mocked<Pick<AiIndexService, 'put' | 'get' | 'list' | 'delete'>>;
  let response: ReturnType<typeof httpServerMock.createResponseFactory>;
  let featureFlagEnabled: boolean;

  const createContext = () =>
    ({
      core: Promise.resolve({
        uiSettings: {
          client: { get: jest.fn().mockImplementation(async () => featureFlagEnabled) },
        },
      }),
    } as unknown as Parameters<RequestHandler>[0]);

  const getRoute = (method: string, path: string): RegisteredRoute => {
    const route = routes[`${method}:${path}`];
    expect(route).toBeDefined();
    return route;
  };

  beforeEach(() => {
    routes = {};
    featureFlagEnabled = true;
    response = httpServerMock.createResponseFactory();
    aiIndexService = {
      put: jest.fn(),
      get: jest.fn(),
      list: jest.fn(),
      delete: jest.fn(),
    };

    const createVersionedRoute = (method: string) => (config: RegisteredRoute['config']) => ({
      addVersion: (_versionConfig: unknown, handler: RequestHandler) => {
        routes[`${method}:${config.path}`] = { config, handler };
      },
    });

    const router = {
      versioned: {
        get: jest.fn(createVersionedRoute('GET')),
        put: jest.fn(createVersionedRoute('PUT')),
        delete: jest.fn(createVersionedRoute('DELETE')),
      },
    } as unknown as IRouter;

    registerAiIndexRoutes({
      router,
      getAiIndexService: () => aiIndexService as unknown as AiIndexService,
    });
  });

  const callRoute = async (method: string, path: string, request: Record<string, unknown>) => {
    const { handler } = getRoute(method, path);
    return handler(createContext(), httpServerMock.createKibanaRequest(request), response);
  };

  it('returns 404 on every route when the context engine is disabled', async () => {
    featureFlagEnabled = false;

    await callRoute('PUT', aiIndexByIdPath, { params: { aiIndexId: 'a' }, body: {} });
    await callRoute('GET', aiIndexByIdPath, { params: { aiIndexId: 'a' } });
    await callRoute('GET', aiIndexPath, {});
    await callRoute('DELETE', aiIndexByIdPath, { params: { aiIndexId: 'a' } });

    expect(response.notFound).toHaveBeenCalledTimes(4);
    expect(aiIndexService.put).not.toHaveBeenCalled();
    expect(aiIndexService.get).not.toHaveBeenCalled();
    expect(aiIndexService.list).not.toHaveBeenCalled();
    expect(aiIndexService.delete).not.toHaveBeenCalled();
  });

  it('registers all routes as public with the expected privileges', () => {
    expect(getRoute('PUT', aiIndexByIdPath).config).toMatchObject({
      access: 'public',
      security: { authz: { requiredPrivileges: [apiPrivileges.writeContextEngine] } },
    });
    expect(getRoute('GET', aiIndexByIdPath).config).toMatchObject({
      access: 'public',
      security: { authz: { requiredPrivileges: [apiPrivileges.readContextEngine] } },
    });
    expect(getRoute('GET', aiIndexPath).config).toMatchObject({
      access: 'public',
      security: { authz: { requiredPrivileges: [apiPrivileges.readContextEngine] } },
    });
    expect(getRoute('DELETE', aiIndexByIdPath).config).toMatchObject({
      access: 'public',
      security: { authz: { requiredPrivileges: [apiPrivileges.writeContextEngine] } },
    });
  });

  describe('PUT /api/context_engine/ai_index/{aiIndexId}', () => {
    const putRequest = {
      params: { aiIndexId: 'customer_support' },
      body: {
        name: 'customer_support',
        type: 'data_stream',
        dest: { index: 'customer_support*' },
      },
    };

    it('returns 201 when the AI index is created', async () => {
      aiIndexService.put.mockResolvedValue('created');

      await callRoute('PUT', aiIndexByIdPath, putRequest);

      expect(aiIndexService.put).toHaveBeenCalledWith('customer_support', putRequest.body);
      expect(response.created).toHaveBeenCalledWith({ body: { status: 'created' } });
    });

    it('returns 200 when the AI index is updated', async () => {
      aiIndexService.put.mockResolvedValue('updated');

      await callRoute('PUT', aiIndexByIdPath, putRequest);

      expect(response.ok).toHaveBeenCalledWith({ body: { status: 'updated' } });
    });

    it('returns 400 when the dest is invalid', async () => {
      aiIndexService.put.mockRejectedValue(
        new InvalidAiIndexDestError(
          "dest.index 'customer_support*' does not match any existing index, index pattern, or data stream"
        )
      );

      await callRoute('PUT', aiIndexByIdPath, putRequest);

      expect(response.badRequest).toHaveBeenCalledWith({
        body: {
          message:
            "dest.index 'customer_support*' does not match any existing index, index pattern, or data stream",
        },
      });
    });

    it('returns 409 when the AI index is modified concurrently', async () => {
      aiIndexService.put.mockRejectedValue(new AiIndexConflictError('customer_support'));

      await callRoute('PUT', aiIndexByIdPath, putRequest);

      expect(response.conflict).toHaveBeenCalledWith({
        body: { message: "AI index 'customer_support' was modified concurrently; please retry" },
      });
    });
  });

  describe('GET /api/context_engine/ai_index/{aiIndexId}', () => {
    it('returns the AI index', async () => {
      const aiIndex = {
        id: 'customer_support',
        name: 'customer_support',
        type: 'data_stream' as const,
        dest: { index: 'customer_support*' },
        date_created: '2026-07-08T12:10:30.000Z',
        date_modified: '2026-07-08T12:10:30.000Z',
      };
      aiIndexService.get.mockResolvedValue(aiIndex);

      await callRoute('GET', aiIndexByIdPath, { params: { aiIndexId: 'customer_support' } });

      expect(response.ok).toHaveBeenCalledWith({ body: aiIndex });
    });

    it('returns 404 when the AI index does not exist', async () => {
      aiIndexService.get.mockRejectedValue(new AiIndexNotFoundError('missing'));

      await callRoute('GET', aiIndexByIdPath, { params: { aiIndexId: 'missing' } });

      expect(response.notFound).toHaveBeenCalledWith({
        body: { message: "AI index 'missing' not found" },
      });
    });

    it('rethrows unexpected errors', async () => {
      aiIndexService.get.mockRejectedValue(new Error('boom'));

      await expect(
        callRoute('GET', aiIndexByIdPath, { params: { aiIndexId: 'customer_support' } })
      ).rejects.toThrow('boom');
    });
  });

  describe('GET /api/context_engine/ai_index', () => {
    it('returns the list of AI indices', async () => {
      aiIndexService.list.mockResolvedValue([]);

      await callRoute('GET', aiIndexPath, {});

      expect(response.ok).toHaveBeenCalledWith({ body: { ai_indices: [] } });
    });
  });

  describe('DELETE /api/context_engine/ai_index/{aiIndexId}', () => {
    it('returns acknowledged when the AI index is deleted', async () => {
      aiIndexService.delete.mockResolvedValue(undefined);

      await callRoute('DELETE', aiIndexByIdPath, {
        params: { aiIndexId: 'customer_support' },
      });

      expect(aiIndexService.delete).toHaveBeenCalledWith('customer_support');
      expect(response.ok).toHaveBeenCalledWith({ body: { acknowledged: true } });
    });

    it('returns 404 when the AI index does not exist', async () => {
      aiIndexService.delete.mockRejectedValue(new AiIndexNotFoundError('missing'));

      await callRoute('DELETE', aiIndexByIdPath, { params: { aiIndexId: 'missing' } });

      expect(response.notFound).toHaveBeenCalledWith({
        body: { message: "AI index 'missing' not found" },
      });
    });
  });
});
