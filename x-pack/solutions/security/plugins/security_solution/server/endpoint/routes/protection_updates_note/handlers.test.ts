/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { EndpointAppContextService } from '../../endpoint_app_context_services';
import type { KibanaResponseFactory, SavedObjectsClientContract } from '@kbn/core/server';

import {
  createMockEndpointAppContext,
  createMockEndpointAppContextServiceSetupContract,
  createMockEndpointAppContextServiceStartContract,
  createRouteHandlerContext,
} from '../../mocks';
import type { ScopedClusterClientMock } from '@kbn/core/server/mocks';
import {
  elasticsearchServiceMock,
  httpServerMock,
  savedObjectsClientMock,
} from '@kbn/core/server/mocks';
import { PACKAGE_POLICY_SAVED_OBJECT_TYPE } from '@kbn/fleet-plugin/common';
import { getProtectionUpdatesNoteHandler, postProtectionUpdatesNoteHandler } from './handlers';
import { requestContextMock } from '../../../lib/detection_engine/routes/__mocks__';
import type { EndpointAppContext } from '../../types';
import type { EndpointInternalFleetServicesInterfaceMocked } from '../../services/fleet/endpoint_fleet_services_factory.mocks';

const mockedSOSuccessfulFindResponse = {
  total: 1,
  saved_objects: [
    {
      id: 'id',
      type: 'type',
      references: [
        {
          id: 'id_package_policy',
          name: 'package_policy',
          type: 'ingest-package-policies',
        },
      ],
      attributes: { note: 'note' },
      score: 1,
    },
  ],
  page: 1,
  per_page: 10,
};

const mockedSOSuccessfulFindResponseEmpty = {
  total: 0,
  saved_objects: [],
  page: 1,
  per_page: 10,
};

const createMockedSOSuccessfulCreateResponse = (note: string) => ({
  id: 'id',
  type: 'type',
  references: [],
  attributes: { note },
});

const mockedSOSuccessfulUpdateResponse = [
  'policy-settings-protection-updates-note',
  'id',
  { note: 'note2' },
  {
    references: [
      {
        id: 'id_package_policy',
        name: 'package_policy',
        type: 'ingest-package-policies',
      },
    ],
    refresh: 'wait_for',
  },
];

describe('test protection updates note handler', () => {
  let mockEndpointContext: EndpointAppContext;
  let endpointAppContextService: EndpointAppContextService;
  let mockSavedObjectClient: jest.Mocked<SavedObjectsClientContract>;
  let mockResponse: jest.Mocked<KibanaResponseFactory>;
  let mockScopedClient: ScopedClusterClientMock;

  describe('test protection updates note handler', () => {
    beforeEach(() => {
      mockEndpointContext = createMockEndpointAppContext();
      mockScopedClient = elasticsearchServiceMock.createScopedClusterClient();
      mockSavedObjectClient = savedObjectsClientMock.create();
      mockResponse = httpServerMock.createResponseFactory();
      endpointAppContextService = new EndpointAppContextService();
      endpointAppContextService.setup(createMockEndpointAppContextServiceSetupContract());
      endpointAppContextService.start(createMockEndpointAppContextServiceStartContract());

      const internalFleetServicesMock =
        mockEndpointContext.service.getInternalFleetServices() as EndpointInternalFleetServicesInterfaceMocked;

      internalFleetServicesMock.ensureInCurrentSpace.mockResolvedValue(undefined);
      internalFleetServicesMock.getSoClient.mockReturnValue(mockSavedObjectClient);
    });

    afterEach(() => endpointAppContextService.stop());

    it('should create a new note if one does not exist', async () => {
      const protectionUpdatesNoteHandler = postProtectionUpdatesNoteHandler(mockEndpointContext);
      const mockRequest = httpServerMock.createKibanaRequest({
        params: { policyId: 'id' },
        body: { note: 'note' },
      });

      mockSavedObjectClient.find.mockResolvedValueOnce(mockedSOSuccessfulFindResponseEmpty);

      mockSavedObjectClient.create.mockResolvedValueOnce(
        createMockedSOSuccessfulCreateResponse('note')
      );

      await protectionUpdatesNoteHandler(
        requestContextMock.convertContext(
          createRouteHandlerContext(mockScopedClient, mockSavedObjectClient)
        ),
        mockRequest,
        mockResponse
      );

      expect(mockResponse.ok).toBeCalled();
      expect(mockSavedObjectClient.create).toBeCalledWith(
        'policy-settings-protection-updates-note',
        { note: 'note' },
        {
          references: [
            { id: undefined, name: 'package_policy', type: PACKAGE_POLICY_SAVED_OBJECT_TYPE },
          ],
          refresh: 'wait_for',
        }
      );
    });

    it('should update an existing note on post if one exists', async () => {
      const protectionUpdatesNoteHandler = postProtectionUpdatesNoteHandler(mockEndpointContext);
      const mockRequest = httpServerMock.createKibanaRequest({
        params: { policyId: 'id' },
        body: { note: 'note2' },
      });

      mockSavedObjectClient.find.mockResolvedValueOnce(mockedSOSuccessfulFindResponse);

      mockSavedObjectClient.update.mockResolvedValueOnce(
        createMockedSOSuccessfulCreateResponse('note2')
      );

      await protectionUpdatesNoteHandler(
        requestContextMock.convertContext(
          createRouteHandlerContext(mockScopedClient, mockSavedObjectClient)
        ),
        mockRequest,
        mockResponse
      );

      expect(mockResponse.ok).toBeCalled();
      expect(mockSavedObjectClient.update).toBeCalledWith(...mockedSOSuccessfulUpdateResponse);
    });

    it('should return the note if one exists', async () => {
      const protectionUpdatesNoteHandler = getProtectionUpdatesNoteHandler(mockEndpointContext);
      const mockRequest = httpServerMock.createKibanaRequest({
        params: { policyId: 'id' },
      });

      mockSavedObjectClient.find.mockResolvedValueOnce(mockedSOSuccessfulFindResponse);

      await protectionUpdatesNoteHandler(
        requestContextMock.convertContext(
          createRouteHandlerContext(mockScopedClient, mockSavedObjectClient)
        ),
        mockRequest,
        mockResponse
      );

      expect(mockResponse.ok).toBeCalled();
      const result = mockResponse.ok.mock.calls[0][0]?.body as { note: string };
      expect(result.note).toEqual('note');
    });

    it('should return notFound if no note exists', async () => {
      const protectionUpdatesNoteHandler = getProtectionUpdatesNoteHandler(mockEndpointContext);
      const mockRequest = httpServerMock.createKibanaRequest({
        params: { policyId: 'id' },
      });

      mockSavedObjectClient.find.mockResolvedValueOnce(mockedSOSuccessfulFindResponseEmpty);

      await protectionUpdatesNoteHandler(
        requestContextMock.convertContext(
          createRouteHandlerContext(mockScopedClient, mockSavedObjectClient)
        ),
        mockRequest,
        mockResponse
      );

      expect(mockResponse.notFound).toBeCalled();
    });

    describe('with space awareness enabled', () => {
      beforeEach(() => {
        // @ts-expect-error write to readonly property
        mockEndpointContext.experimentalFeatures.endpointManagementSpaceAwarenessEnabled = true;
      });

      it('should call ensureInCurrentSpace with integration policy id', async () => {
        const mockEnsureInCurrentSpace = mockEndpointContext.service.getInternalFleetServices()
          .ensureInCurrentSpace as jest.Mock;
        const protectionUpdatesNoteHandler = postProtectionUpdatesNoteHandler(mockEndpointContext);
        const mockRequest = httpServerMock.createKibanaRequest({
          params: { package_policy_id: 'integration-policy-id' },
          body: { note: 'this is a very important note' },
        });

        const mockSOClient = mockEndpointContext.service
          .getInternalFleetServices()
          .getSoClient() as jest.Mocked<SavedObjectsClientContract>;
        mockSOClient.find.mockResolvedValueOnce(mockedSOSuccessfulFindResponseEmpty);
        mockSOClient.create.mockResolvedValueOnce(createMockedSOSuccessfulCreateResponse('note'));
        await protectionUpdatesNoteHandler(
          requestContextMock.convertContext(
            createRouteHandlerContext(mockScopedClient, mockSavedObjectClient)
          ),
          mockRequest,
          mockResponse
        );
        expect(mockEnsureInCurrentSpace).toBeCalledWith({
          integrationPolicyIds: ['integration-policy-id'],
        });
      });
    });
  });
});
