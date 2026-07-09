/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { loggerMock } from '@kbn/logging-mocks';
import { createClient, type UserPromptClient } from './client';
import type { UserPromptDocument } from './types';

const testSpace = 'default';
const testUsername = 'test-user';

interface MockEsClient {
  search: jest.Mock;
  index: jest.Mock;
  delete: jest.Mock;
}

const mockEsClient: MockEsClient = {
  search: jest.fn(),
  index: jest.fn(),
  delete: jest.fn(),
};

jest.mock('./storage', () => ({
  createStorage: jest.fn(() => ({
    getClient: jest.fn(() => mockEsClient),
  })),
}));

const ownerFilter = { term: { created_by: testUsername } };

const createUserPromptDocument = ({
  id = 'prompt-1',
  username = testUsername,
}: {
  id?: string;
  username?: string;
} = {}): UserPromptDocument => ({
  _id: `internal-${id}`,
  _source: {
    id,
    name: 'Prompt 1',
    content: 'Prompt content',
    space: testSpace,
    created_at: '2024-09-04T06:44:17.944Z',
    updated_at: '2025-08-04T06:44:19.123Z',
    created_by: username,
    updated_by: username,
  },
});

const mockSearchResponse = (hits: UserPromptDocument[]) => {
  mockEsClient.search.mockResolvedValue({
    hits: {
      hits,
      total: { value: hits.length },
    },
  });
};

const getSearchFilters = (callIndex = 0): unknown[] => {
  return mockEsClient.search.mock.calls[callIndex][0].query.bool.filter;
};

describe('UserPromptClient', () => {
  let client: UserPromptClient;

  beforeEach(() => {
    jest.clearAllMocks();

    client = createClient({
      space: testSpace,
      username: testUsername,
      logger: loggerMock.create(),
      esClient: {} as never,
    });
  });

  describe('find', () => {
    it('filters by the current user in addition to the space', async () => {
      mockSearchResponse([createUserPromptDocument()]);

      const result = await client.find();

      expect(getSearchFilters()).toEqual(expect.arrayContaining([ownerFilter]));
      expect(result.total).toBe(1);
      expect(result.data[0].id).toBe('prompt-1');
    });

    it('filters by the current user when a search query is provided', async () => {
      mockSearchResponse([]);

      await client.find({ query: 'some search' });

      expect(getSearchFilters()).toEqual(expect.arrayContaining([ownerFilter]));
    });
  });

  describe('get', () => {
    it('filters by the current user in addition to the space and id', async () => {
      mockSearchResponse([createUserPromptDocument()]);

      const prompt = await client.get('prompt-1');

      expect(getSearchFilters()).toEqual(
        expect.arrayContaining([ownerFilter, { term: { id: 'prompt-1' } }])
      );
      expect(prompt.id).toBe('prompt-1');
    });

    it('throws a not found error when the prompt is not visible to the user', async () => {
      mockSearchResponse([]);

      await expect(client.get('other-user-prompt')).rejects.toThrow(
        "User prompt with id 'other-user-prompt' not found"
      );
      expect(getSearchFilters()).toEqual(expect.arrayContaining([ownerFilter]));
    });
  });

  describe('create', () => {
    it('scopes the duplicate id check to the current user', async () => {
      mockSearchResponse([]);
      mockEsClient.index.mockResolvedValue({});
      // second search resolves the created prompt for the trailing get()
      mockEsClient.search
        .mockResolvedValueOnce({ hits: { hits: [] } })
        .mockResolvedValueOnce({ hits: { hits: [createUserPromptDocument()] } });

      await client.create({ id: 'prompt-1', name: 'Prompt 1', content: 'Prompt content' });

      expect(getSearchFilters(0)).toEqual(expect.arrayContaining([ownerFilter]));
      expect(mockEsClient.index).toHaveBeenCalledWith({
        document: expect.objectContaining({
          created_by: testUsername,
          updated_by: testUsername,
        }),
      });
    });
  });

  describe('update', () => {
    it('filters by the current user when resolving the prompt to update', async () => {
      mockSearchResponse([createUserPromptDocument()]);
      mockEsClient.index.mockResolvedValue({});

      await client.update('prompt-1', { content: 'updated content' });

      expect(getSearchFilters()).toEqual(
        expect.arrayContaining([ownerFilter, { term: { id: 'prompt-1' } }])
      );
      expect(mockEsClient.index).toHaveBeenCalledWith({
        id: 'internal-prompt-1',
        document: expect.objectContaining({
          content: 'updated content',
          updated_by: testUsername,
        }),
      });
    });

    it('throws a not found error instead of updating a prompt not visible to the user', async () => {
      mockSearchResponse([]);

      await expect(client.update('other-user-prompt', { content: 'injected' })).rejects.toThrow(
        "User prompt with id 'other-user-prompt' not found"
      );
      expect(mockEsClient.index).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('filters by the current user when resolving the prompt to delete', async () => {
      mockSearchResponse([createUserPromptDocument()]);
      mockEsClient.delete.mockResolvedValue({ result: 'deleted' });

      await expect(client.delete('prompt-1')).resolves.toBe(true);

      expect(getSearchFilters()).toEqual(
        expect.arrayContaining([ownerFilter, { term: { id: 'prompt-1' } }])
      );
      expect(mockEsClient.delete).toHaveBeenCalledWith({ id: 'internal-prompt-1' });
    });

    it('throws a not found error instead of deleting a prompt not visible to the user', async () => {
      mockSearchResponse([]);

      await expect(client.delete('other-user-prompt')).rejects.toThrow(
        "User prompt with id 'other-user-prompt' not found"
      );
      expect(mockEsClient.delete).not.toHaveBeenCalled();
    });
  });
});
