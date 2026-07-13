/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { IRouter, RequestHandler } from '@kbn/core/server';
import { httpServerMock } from '@kbn/core/server/mocks';
import { registerNamespaceRoutes } from './namespaces';
import { namespaceByIdPath, namespacePath } from '../../common/constants';
import { apiPrivileges } from '../../common/features';
import {
  InvalidNamespaceSourceError,
  NamespaceConflictError,
  NamespaceNotFoundError,
} from '../namespaces/errors';
import type { NamespaceService } from '../namespaces/service';

interface RegisteredRoute {
  config: {
    path: string;
    access: string;
    security: { authz: { requiredPrivileges: string[] } };
  };
  handler: RequestHandler;
}

describe('namespaces routes', () => {
  let routes: Record<string, RegisteredRoute>;
  let namespaceService: jest.Mocked<Pick<NamespaceService, 'put' | 'get' | 'list' | 'delete'>>;
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
    namespaceService = {
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

    registerNamespaceRoutes({
      router,
      getNamespaceService: () => namespaceService as unknown as NamespaceService,
    });
  });

  const callRoute = async (method: string, path: string, request: Record<string, unknown>) => {
    const { handler } = getRoute(method, path);
    return handler(createContext(), httpServerMock.createKibanaRequest(request), response);
  };

  it('returns 404 on every route when the context engine is disabled', async () => {
    featureFlagEnabled = false;

    await callRoute('PUT', namespaceByIdPath, { params: { namespaceId: 'a' }, body: {} });
    await callRoute('GET', namespaceByIdPath, { params: { namespaceId: 'a' } });
    await callRoute('GET', namespacePath, {});
    await callRoute('DELETE', namespaceByIdPath, { params: { namespaceId: 'a' } });

    expect(response.notFound).toHaveBeenCalledTimes(4);
    expect(namespaceService.put).not.toHaveBeenCalled();
    expect(namespaceService.get).not.toHaveBeenCalled();
    expect(namespaceService.list).not.toHaveBeenCalled();
    expect(namespaceService.delete).not.toHaveBeenCalled();
  });

  it('registers all routes as public with the expected privileges', () => {
    expect(getRoute('PUT', namespaceByIdPath).config).toMatchObject({
      access: 'public',
      security: { authz: { requiredPrivileges: [apiPrivileges.writeContextEngine] } },
    });
    expect(getRoute('GET', namespaceByIdPath).config).toMatchObject({
      access: 'public',
      security: { authz: { requiredPrivileges: [apiPrivileges.readContextEngine] } },
    });
    expect(getRoute('GET', namespacePath).config).toMatchObject({
      access: 'public',
      security: { authz: { requiredPrivileges: [apiPrivileges.readContextEngine] } },
    });
    expect(getRoute('DELETE', namespaceByIdPath).config).toMatchObject({
      access: 'public',
      security: { authz: { requiredPrivileges: [apiPrivileges.writeContextEngine] } },
    });
  });

  describe('PUT /api/context_engine/namespace/{namespaceId}', () => {
    const putRequest = {
      params: { namespaceId: 'customer_support' },
      body: {
        name: 'customer_support',
        type: 'data_stream',
        source: 'customer_support*',
      },
    };

    it('returns 201 when the namespace is created', async () => {
      namespaceService.put.mockResolvedValue('created');

      await callRoute('PUT', namespaceByIdPath, putRequest);

      expect(namespaceService.put).toHaveBeenCalledWith('customer_support', putRequest.body);
      expect(response.created).toHaveBeenCalledWith({ body: { status: 'created' } });
    });

    it('returns 200 when the namespace is updated', async () => {
      namespaceService.put.mockResolvedValue('updated');

      await callRoute('PUT', namespaceByIdPath, putRequest);

      expect(response.ok).toHaveBeenCalledWith({ body: { status: 'updated' } });
    });

    it('returns 400 when the source is invalid', async () => {
      namespaceService.put.mockRejectedValue(
        new InvalidNamespaceSourceError(
          "Source 'customer_support*' does not match any existing index, index pattern, or data stream"
        )
      );

      await callRoute('PUT', namespaceByIdPath, putRequest);

      expect(response.badRequest).toHaveBeenCalledWith({
        body: {
          message:
            "Source 'customer_support*' does not match any existing index, index pattern, or data stream",
        },
      });
    });

    it('returns 409 when the namespace is modified concurrently', async () => {
      namespaceService.put.mockRejectedValue(new NamespaceConflictError('customer_support'));

      await callRoute('PUT', namespaceByIdPath, putRequest);

      expect(response.conflict).toHaveBeenCalledWith({
        body: { message: "Namespace 'customer_support' was modified concurrently; please retry" },
      });
    });
  });

  describe('GET /api/context_engine/namespace/{namespaceId}', () => {
    it('returns the namespace', async () => {
      const namespace = {
        id: 'customer_support',
        name: 'customer_support',
        type: 'data_stream' as const,
        source: 'customer_support*',
        date_created: '2026-07-08T12:10:30.000Z',
        date_modified: '2026-07-08T12:10:30.000Z',
      };
      namespaceService.get.mockResolvedValue(namespace);

      await callRoute('GET', namespaceByIdPath, { params: { namespaceId: 'customer_support' } });

      expect(response.ok).toHaveBeenCalledWith({ body: namespace });
    });

    it('returns 404 when the namespace does not exist', async () => {
      namespaceService.get.mockRejectedValue(new NamespaceNotFoundError('missing'));

      await callRoute('GET', namespaceByIdPath, { params: { namespaceId: 'missing' } });

      expect(response.notFound).toHaveBeenCalledWith({
        body: { message: "Namespace 'missing' not found" },
      });
    });

    it('rethrows unexpected errors', async () => {
      namespaceService.get.mockRejectedValue(new Error('boom'));

      await expect(
        callRoute('GET', namespaceByIdPath, { params: { namespaceId: 'customer_support' } })
      ).rejects.toThrow('boom');
    });
  });

  describe('GET /api/context_engine/namespace', () => {
    it('returns the list of namespaces', async () => {
      namespaceService.list.mockResolvedValue([]);

      await callRoute('GET', namespacePath, {});

      expect(response.ok).toHaveBeenCalledWith({ body: { namespaces: [] } });
    });
  });

  describe('DELETE /api/context_engine/namespace/{namespaceId}', () => {
    it('returns acknowledged when the namespace is deleted', async () => {
      namespaceService.delete.mockResolvedValue(undefined);

      await callRoute('DELETE', namespaceByIdPath, {
        params: { namespaceId: 'customer_support' },
      });

      expect(namespaceService.delete).toHaveBeenCalledWith('customer_support');
      expect(response.ok).toHaveBeenCalledWith({ body: { acknowledged: true } });
    });

    it('returns 404 when the namespace does not exist', async () => {
      namespaceService.delete.mockRejectedValue(new NamespaceNotFoundError('missing'));

      await callRoute('DELETE', namespaceByIdPath, { params: { namespaceId: 'missing' } });

      expect(response.notFound).toHaveBeenCalledWith({
        body: { message: "Namespace 'missing' not found" },
      });
    });
  });
});
