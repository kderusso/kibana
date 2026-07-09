/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { randomUUID } from 'crypto';
import { tags } from '@kbn/scout';
import { expect } from '@kbn/scout/api';
import type {
  FindUserPromptsResponse,
  GetUserPromptResponse,
  BulkDeleteUserPromptsResponse,
} from '../../../../common/http_api/user_prompts';
import { internalApiPath } from '../../../../common/constants';
import { apiTest } from '../fixtures';
import { COMMON_HEADERS, CHAT_USER_PROMPTS_INDEX } from '../fixtures/constants';
import { spaceUrl } from '../fixtures/space_paths';

const USER_PROMPTS_TEST_PREFIX = 'user-prompts-access-control-test';

interface KibanaRole {
  elasticsearch?: { cluster?: string[]; indices?: unknown[]; run_as?: string[] };
  kibana?: Array<{
    base?: string[];
    feature?: Record<string, string[]>;
    spaces: string[];
  }>;
}

function agentBuilderRole(spaceId: string): KibanaRole {
  return {
    elasticsearch: { cluster: [], indices: [], run_as: [] },
    kibana: [
      {
        base: [],
        feature: {
          agentBuilder: ['all'],
        },
        spaces: [spaceId],
      },
    ],
  };
}

function basicAuthHeader(username: string, password: string): Record<string, string> {
  const token = Buffer.from(`${username}:${password}`).toString('base64');
  return { Authorization: `Basic ${token}` };
}

apiTest.describe(
  'Agent Builder — user prompts access-control API',
  { tag: [...tags.stateful.classic] },
  () => {
    const testRunId = randomUUID();
    const testSpaceId = `${USER_PROMPTS_TEST_PREFIX}-space-${testRunId}`;
    const userPromptsBase = `${spaceUrl(internalApiPath, testSpaceId)}/user_prompts`;

    // Two native Kibana users with the same Agent Builder privileges, distinct
    // usernames. Lets us assert per-user isolation of user prompts.
    const alice = {
      roleName: `${USER_PROMPTS_TEST_PREFIX}-alice-role-${testRunId}`,
      username: `${USER_PROMPTS_TEST_PREFIX}-alice-${testRunId}`,
      password: 'alice-password',
    };
    const bob = {
      roleName: `${USER_PROMPTS_TEST_PREFIX}-bob-role-${testRunId}`,
      username: `${USER_PROMPTS_TEST_PREFIX}-bob-${testRunId}`,
      password: 'bob-password',
    };
    const allPrincipals = [alice, bob];

    let adminCookie: Record<string, string>;

    const headersFor = (user: { username: string; password: string }) => ({
      ...COMMON_HEADERS,
      ...basicAuthHeader(user.username, user.password),
    });
    const adminInternalHeaders = () => ({
      ...COMMON_HEADERS,
      ...adminCookie,
    });

    apiTest.beforeAll(async ({ samlAuth, kbnClient }) => {
      const { cookieHeader } = await samlAuth.asInteractiveUser('admin');
      adminCookie = cookieHeader;

      await kbnClient.request({
        method: 'POST',
        path: '/api/spaces/space',
        body: { id: testSpaceId, name: testSpaceId, disabledFeatures: [] },
      });

      for (const { roleName } of allPrincipals) {
        await kbnClient.request({
          method: 'PUT',
          path: `/api/security/role/${encodeURIComponent(roleName)}`,
          body: agentBuilderRole(testSpaceId),
        });
      }

      for (const user of allPrincipals) {
        await kbnClient.request({
          method: 'POST',
          path: `/internal/security/users/${encodeURIComponent(user.username)}`,
          headers: adminInternalHeaders(),
          body: {
            username: user.username,
            password: user.password,
            roles: [user.roleName],
            full_name: user.username,
            enabled: true,
          },
        });
      }
    });

    apiTest.afterAll(async ({ esClient, kbnClient }) => {
      const deleteKibanaResourceIfPresent = async (
        path: string,
        headers?: Record<string, string>
      ) => {
        await kbnClient.request({
          method: 'DELETE',
          path,
          headers,
          ignoreErrors: [404],
        });
      };

      await esClient.deleteByQuery({
        index: CHAT_USER_PROMPTS_INDEX,
        query: { term: { space: testSpaceId } },
        wait_for_completion: true,
        refresh: true,
        conflicts: 'proceed',
        ignore_unavailable: true,
      });

      for (const user of allPrincipals) {
        await deleteKibanaResourceIfPresent(
          `/internal/security/users/${encodeURIComponent(user.username)}`,
          adminInternalHeaders()
        );
        await deleteKibanaResourceIfPresent(
          `/api/security/role/${encodeURIComponent(user.roleName)}`
        );
      }
      await deleteKibanaResourceIfPresent(`/api/spaces/space/${encodeURIComponent(testSpaceId)}`);
    });

    // ── helpers ─────────────────────────────────────────────────────────────

    const createPromptAs = async (
      apiClient: any,
      user: { username: string; password: string },
      prompt: { id: string; name: string; content: string }
    ) => {
      const response = await apiClient.post(userPromptsBase, {
        headers: headersFor(user),
        body: prompt,
        responseType: 'json',
      });
      expect(response).toHaveStatusCode(200);
      return response.body as GetUserPromptResponse;
    };

    const findPromptsAs = async (
      apiClient: any,
      user: { username: string; password: string }
    ): Promise<FindUserPromptsResponse> => {
      const response = await apiClient.get(`${userPromptsBase}/_find?per_page=100`, {
        headers: headersFor(user),
        responseType: 'json',
      });
      expect(response).toHaveStatusCode(200);
      return response.body as FindUserPromptsResponse;
    };

    // ── tests ───────────────────────────────────────────────────────────────

    apiTest('a user can manage their own prompts', async ({ apiClient }) => {
      const promptId = `alice-own-prompt-${testRunId}`;
      const created = await createPromptAs(apiClient, alice, {
        id: promptId,
        name: 'Alice prompt',
        content: 'Alice private content',
      });
      expect(created.created_by).toBe(alice.username);

      const found = await findPromptsAs(apiClient, alice);
      expect(found.data.map((prompt) => prompt.id)).toContain(promptId);

      const getResponse = await apiClient.get(
        `${userPromptsBase}/${encodeURIComponent(promptId)}`,
        { headers: headersFor(alice), responseType: 'json' }
      );
      expect(getResponse).toHaveStatusCode(200);

      const updateResponse = await apiClient.put(
        `${userPromptsBase}/${encodeURIComponent(promptId)}`,
        {
          headers: headersFor(alice),
          body: { content: 'Alice updated content' },
          responseType: 'json',
        }
      );
      expect(updateResponse).toHaveStatusCode(200);
      expect((updateResponse.body as GetUserPromptResponse).content).toBe('Alice updated content');

      const deleteResponse = await apiClient.delete(
        `${userPromptsBase}/${encodeURIComponent(promptId)}`,
        { headers: headersFor(alice), responseType: 'json' }
      );
      expect(deleteResponse).toHaveStatusCode(200);
    });

    apiTest('a user cannot list another user prompts', async ({ apiClient }) => {
      const promptId = `alice-find-prompt-${testRunId}`;
      await createPromptAs(apiClient, alice, {
        id: promptId,
        name: 'Alice prompt',
        content: 'Alice private content',
      });

      const bobResults = await findPromptsAs(apiClient, bob);
      expect(bobResults.data.map((prompt) => prompt.id)).not.toContain(promptId);
    });

    apiTest('a user cannot read another user prompt by id', async ({ apiClient }) => {
      const promptId = `alice-get-prompt-${testRunId}`;
      await createPromptAs(apiClient, alice, {
        id: promptId,
        name: 'Alice prompt',
        content: 'Alice private content',
      });

      const bobResponse = await apiClient.get(
        `${userPromptsBase}/${encodeURIComponent(promptId)}`,
        { headers: headersFor(bob), responseType: 'json' }
      );
      expect(bobResponse).toHaveStatusCode(400);
    });

    apiTest('a user cannot update another user prompt', async ({ apiClient }) => {
      const promptId = `alice-update-prompt-${testRunId}`;
      await createPromptAs(apiClient, alice, {
        id: promptId,
        name: 'Alice prompt',
        content: 'Alice private content',
      });

      const bobResponse = await apiClient.put(
        `${userPromptsBase}/${encodeURIComponent(promptId)}`,
        {
          headers: headersFor(bob),
          body: { content: '[BOB INJECTED] malicious instructions' },
          responseType: 'json',
        }
      );
      expect(bobResponse).toHaveStatusCode(400);

      const aliceGet = await apiClient.get(`${userPromptsBase}/${encodeURIComponent(promptId)}`, {
        headers: headersFor(alice),
        responseType: 'json',
      });
      expect(aliceGet).toHaveStatusCode(200);
      const alicePrompt = aliceGet.body as GetUserPromptResponse;
      expect(alicePrompt.content).toBe('Alice private content');
      expect(alicePrompt.updated_by).toBe(alice.username);
    });

    apiTest('a user cannot delete another user prompt', async ({ apiClient }) => {
      const promptId = `alice-delete-prompt-${testRunId}`;
      await createPromptAs(apiClient, alice, {
        id: promptId,
        name: 'Alice prompt',
        content: 'Alice private content',
      });

      const bobDelete = await apiClient.delete(
        `${userPromptsBase}/${encodeURIComponent(promptId)}`,
        { headers: headersFor(bob), responseType: 'json' }
      );
      expect(bobDelete).toHaveStatusCode(400);

      const bobBulkDelete = await apiClient.post(`${userPromptsBase}/_bulk_delete`, {
        headers: headersFor(bob),
        body: { ids: [promptId] },
        responseType: 'json',
      });
      expect(bobBulkDelete).toHaveStatusCode(200);
      const bulkDeleteBody = bobBulkDelete.body as BulkDeleteUserPromptsResponse;
      expect(bulkDeleteBody.results).toHaveLength(1);
      expect(bulkDeleteBody.results[0].promptId).toBe(promptId);
      expect(bulkDeleteBody.results[0].success).toBe(false);

      const aliceGet = await apiClient.get(`${userPromptsBase}/${encodeURIComponent(promptId)}`, {
        headers: headersFor(alice),
        responseType: 'json',
      });
      expect(aliceGet).toHaveStatusCode(200);
    });
  }
);
