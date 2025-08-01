/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import expect from '@kbn/expect';
import { RULE_SAVED_OBJECT_TYPE } from '@kbn/alerting-plugin/server';
import { ES_TEST_INDEX_NAME } from '@kbn/alerting-api-integration-helpers';
import { ALERT_STATUS } from '@kbn/rule-data-utils';
import { Spaces } from '../../../scenarios';
import type { FtrProviderContext } from '../../../../common/ftr_provider_context';
import type { TaskManagerDoc } from '../../../../common/lib';
import {
  AlertUtils as RuleUtils,
  checkAAD,
  getUrlPrefix,
  getTestRuleData,
  ObjectRemover,
  getEventLog,
} from '../../../../common/lib';
import { validateEvent } from './event_log';

const alertAsDataIndex = '.internal.alerts-observability.test.alerts.alerts-default-000001';

export default function createDisableRuleTests({ getService }: FtrProviderContext) {
  const es = getService('es');
  const supertestWithoutAuth = getService('supertestWithoutAuth');
  const retry = getService('retry');
  const supertest = getService('supertest');

  describe('disable', function () {
    this.tags('skipFIPS');
    const objectRemover = new ObjectRemover(supertestWithoutAuth);
    const ruleUtils = new RuleUtils({ space: Spaces.space1, supertestWithoutAuth });

    afterEach(async () => {
      await es.deleteByQuery({
        index: alertAsDataIndex,
        query: {
          match_all: {},
        },
        conflicts: 'proceed',
        ignore_unavailable: true,
      });
      await objectRemover.removeAll();
    });

    async function getScheduledTask(id: string): Promise<TaskManagerDoc> {
      const scheduledTask = await es.get<TaskManagerDoc>({
        id: `task:${id}`,
        index: '.kibana_task_manager',
      });
      return scheduledTask._source!;
    }

    it('should handle disable rule request appropriately', async () => {
      const { body: createdRule } = await supertestWithoutAuth
        .post(`${getUrlPrefix(Spaces.space1.id)}/api/alerting/rule`)
        .set('kbn-xsrf', 'foo')
        .send(getTestRuleData({ enabled: true }))
        .expect(200);
      objectRemover.add(Spaces.space1.id, createdRule.id, 'rule', 'alerting');

      await ruleUtils.disable(createdRule.id);

      // task doc should still exist but be disabled
      await retry.try(async () => {
        const taskRecord = await getScheduledTask(createdRule.scheduled_task_id);
        expect(taskRecord.type).to.eql('task');
        expect(taskRecord.task.taskType).to.eql('alerting:test.noop');
        expect(JSON.parse(taskRecord.task.params)).to.eql({
          alertId: createdRule.id,
          spaceId: Spaces.space1.id,
          consumer: 'alertsFixture',
        });
        expect(taskRecord.task.enabled).to.eql(false);
      });

      const { body: disabledRule } = await supertestWithoutAuth
        .get(`${getUrlPrefix(Spaces.space1.id)}/api/alerting/rule/${createdRule.id}`)
        .set('kbn-xsrf', 'foo')
        .expect(200);

      // Ensure revision was not updated
      expect(disabledRule.revision).to.eql(0);

      // Ensure AAD isn't broken
      await checkAAD({
        supertest: supertestWithoutAuth,
        spaceId: Spaces.space1.id,
        type: RULE_SAVED_OBJECT_TYPE,
        id: createdRule.id,
      });
    });

    it(`shouldn't disable rule from another space`, async () => {
      const { body: createdRule } = await supertestWithoutAuth
        .post(`${getUrlPrefix(Spaces.other.id)}/api/alerting/rule`)
        .set('kbn-xsrf', 'foo')
        .send(getTestRuleData({ enabled: true }))
        .expect(200);
      objectRemover.add(Spaces.other.id, createdRule.id, 'rule', 'alerting');

      await ruleUtils.getDisableRequest(createdRule.id).expect(404, {
        statusCode: 404,
        error: 'Not Found',
        message: `Saved object [alert/${createdRule.id}] not found`,
      });
    });

    it('should create untracked-instance events for all alerts', async () => {
      const { body: createdRule } = await supertest
        .post(`${getUrlPrefix(Spaces.space1.id)}/api/alerting/rule`)
        .set('kbn-xsrf', 'foo')
        .send({
          enabled: true,
          name: 'abc',
          tags: ['foo'],
          rule_type_id: 'test.cumulative-firing',
          consumer: 'alertsFixture',
          schedule: { interval: '5s' },
          throttle: '5s',
          actions: [],
          params: {},
          notify_when: 'onThrottleInterval',
        })
        .expect(200);
      objectRemover.add(Spaces.space1.id, createdRule.id, 'rule', 'alerting');

      // wait for rule to actually execute
      await retry.try(async () => {
        const response = await supertest.get(
          `${getUrlPrefix(Spaces.space1.id)}/internal/alerting/rule/${createdRule.id}/state`
        );

        expect(response.status).to.eql(200);
        expect(response.body).to.key('alerts', 'rule_type_state', 'previous_started_at');
        expect(response.body.rule_type_state.runCount).to.greaterThan(1);
      });

      await ruleUtils.getDisableRequest(createdRule.id);
      const ruleId = createdRule.id;

      // wait for the events we're expecting
      const events = await retry.try(async () => {
        return await getEventLog({
          getService,
          spaceId: Spaces.space1.id,
          type: 'alert',
          id: ruleId,
          provider: 'alerting',
          actions: new Map([
            // make sure the counts of the # of events per type are as expected
            ['untracked-instance', { equal: 2 }],
          ]),
        });
      });

      const event = events[0];
      expect(event).to.be.ok();

      validateEvent(event, {
        spaceId: Spaces.space1.id,
        savedObjects: [
          {
            type: RULE_SAVED_OBJECT_TYPE,
            id: ruleId,
            rel: 'primary',
            type_id: 'test.cumulative-firing',
          },
        ],
        message: "instance 'instance-0' has been untracked because the rule was disabled",
        shouldHaveEventEnd: false,
        shouldHaveTask: false,
        ruleTypeId: createdRule.rule_type_id,
        rule: {
          id: ruleId,
          category: createdRule.rule_type_id,
          license: 'basic',
          ruleset: 'alertsFixture',
          name: 'abc',
        },
        consumer: 'alertsFixture',
      });
    });

    it('should not untrack alerts if untrack is false', async () => {
      const { body: createdRule } = await supertestWithoutAuth
        .post(`${getUrlPrefix(Spaces.space1.id)}/api/alerting/rule`)
        .set('kbn-xsrf', 'foo')
        .send(
          getTestRuleData({
            rule_type_id: 'test.always-firing-alert-as-data',
            schedule: { interval: '24h' },
            throttle: undefined,
            notify_when: undefined,
            params: {
              index: ES_TEST_INDEX_NAME,
              reference: 'test',
            },
          })
        )
        .expect(200);

      objectRemover.add(Spaces.space1.id, createdRule.id, 'rule', 'alerting');

      await retry.try(async () => {
        const {
          hits: { hits: activeAlerts },
        } = await es.search({
          index: alertAsDataIndex,
          query: { match_all: {} },
        });

        expect(activeAlerts.length).eql(2);
        activeAlerts.forEach((activeAlert: any) => {
          expect(activeAlert._source[ALERT_STATUS]).eql('active');
        });
      });

      await ruleUtils.getDisableRequest(createdRule.id, false);

      const {
        hits: { hits: untrackedAlerts },
      } = await es.search({
        index: alertAsDataIndex,
        query: { match_all: {} },
      });
      expect(untrackedAlerts.length).eql(2);
      untrackedAlerts.forEach((untrackedAlert: any) => {
        expect(untrackedAlert._source[ALERT_STATUS]).eql('active');
      });
    });

    it('should disable rule even if associated task manager document is missing', async () => {
      const { body: createdRule } = await supertestWithoutAuth
        .post(`${getUrlPrefix(Spaces.space1.id)}/api/alerting/rule`)
        .set('kbn-xsrf', 'foo')
        .send(getTestRuleData({ enabled: true }))
        .expect(200);
      objectRemover.add(Spaces.space1.id, createdRule.id, 'rule', 'alerting');

      // manually remove scheduled task
      await es.delete({
        id: `task:${createdRule.scheduled_task_id}`,
        index: '.kibana_task_manager',
      });
      await ruleUtils.disable(createdRule.id);

      const { body: disabledRule } = await supertestWithoutAuth
        .get(`${getUrlPrefix(Spaces.space1.id)}/api/alerting/rule/${createdRule.id}`)
        .set('kbn-xsrf', 'foo')
        .expect(200);

      // Ensure revision was not updated
      expect(disabledRule.revision).to.eql(0);

      // Ensure AAD isn't broken
      await checkAAD({
        supertest: supertestWithoutAuth,
        spaceId: Spaces.space1.id,
        type: RULE_SAVED_OBJECT_TYPE,
        id: createdRule.id,
      });
    });
  });
}
