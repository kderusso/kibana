/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import expect from '@kbn/expect';
import type { UserCommentAttachmentAttributes } from '@kbn/cases-plugin/common/types/domain';
import { AttachmentType } from '@kbn/cases-plugin/common/types/domain';
import type { FtrProviderContext } from '../../../../common/ftr_provider_context';

import { nullUser, postCaseReq, postCommentUserReq } from '../../../../common/lib/mock';
import {
  deleteCasesByESQuery,
  deleteCasesUserActions,
  deleteComments,
  createCase,
  createComment,
  updateComment,
  getAuthWithSuperUser,
} from '../../../../common/lib/api';

export default ({ getService }: FtrProviderContext): void => {
  const supertestWithoutAuth = getService('supertestWithoutAuth');
  const es = getService('es');
  const authSpace1 = getAuthWithSuperUser();

  describe('patch_comment', () => {
    afterEach(async () => {
      await deleteCasesByESQuery(es);
      await deleteComments(es);
      await deleteCasesUserActions(es);
    });

    it('should patch a comment in space1', async () => {
      const postedCase = await createCase(supertestWithoutAuth, postCaseReq, 200, authSpace1);
      const patchedCase = await createComment({
        supertest: supertestWithoutAuth,
        caseId: postedCase.id,
        params: postCommentUserReq,
        auth: authSpace1,
      });

      const newComment = 'Well I decided to update my comment. So what? Deal with it.';
      const updatedCase = await updateComment({
        supertest: supertestWithoutAuth,
        caseId: postedCase.id,
        req: {
          id: patchedCase.comments![0].id,
          version: patchedCase.comments![0].version,
          comment: newComment,
          type: AttachmentType.user,
          owner: 'securitySolutionFixture',
        },
        auth: authSpace1,
      });

      const userComment = updatedCase.comments![0] as UserCommentAttachmentAttributes;
      expect(userComment.comment).to.eql(newComment);
      expect(userComment.type).to.eql(AttachmentType.user);
      expect(updatedCase.updated_by).to.eql(nullUser);
    });

    it('should not patch a comment in a different space', async () => {
      const postedCase = await createCase(supertestWithoutAuth, postCaseReq, 200, authSpace1);
      const patchedCase = await createComment({
        supertest: supertestWithoutAuth,
        caseId: postedCase.id,
        params: postCommentUserReq,
        auth: authSpace1,
      });

      const newComment = 'Well I decided to update my comment. So what? Deal with it.';
      await updateComment({
        supertest: supertestWithoutAuth,
        caseId: postedCase.id,
        req: {
          id: patchedCase.comments![0].id,
          version: patchedCase.comments![0].version,
          comment: newComment,
          type: AttachmentType.user,
          owner: 'securitySolutionFixture',
        },
        auth: getAuthWithSuperUser('space2'),
        expectedHttpCode: 404,
      });
    });
  });
};
