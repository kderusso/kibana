/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { FtrProviderContext } from '../../ftr_provider_context';
import { USER } from '../../../api_integration/services/ml/security_common';

export default function ({ getPageObjects, getService }: FtrProviderContext) {
  const elasticChart = getService('elasticChart');
  const esArchiver = getService('esArchiver');
  const aiops = getService('aiops');
  const browser = getService('browser');
  const retry = getService('retry');
  const ml = getService('ml');
  const selectedField = '@message';
  const totalDocCount = 14005;
  const cases = getService('cases');

  async function retrySwitchTab(tabIndex: number, seconds: number) {
    await retry.tryForTime(seconds * 1000, async () => {
      await browser.switchTab(tabIndex);
    });
  }

  describe('log pattern analysis', function () {
    let tabsCount = 1;

    afterEach(async () => {
      if (tabsCount > 1) {
        await browser.closeCurrentWindow();
        await retrySwitchTab(0, 10);
        tabsCount--;
      }
    });

    before(async () => {
      await esArchiver.loadIfNeeded('x-pack/test/functional/es_archives/logstash_functional');
      await ml.testResources.createDataViewIfNeeded('logstash-*', '@timestamp');
      await ml.testResources.setKibanaTimeZoneToUTC();
      await ml.securityUI.loginAsMlPowerUser();
    });

    after(async () => {
      await ml.testResources.deleteDataViewByTitle('logstash-*');
      await cases.api.deleteAllCases();
    });

    it(`loads the log pattern analysis page and filters in patterns in discover`, async () => {
      // Start navigation from the base of the ML app.
      await ml.navigation.navigateToMl();
      await elasticChart.setNewChartUiDebugFlag(true);
      await aiops.logPatternAnalysisPage.navigateToDataViewSelection();
      await ml.jobSourceSelection.selectSourceForLogPatternAnalysisDetection('logstash-*');
      await aiops.logPatternAnalysisPage.assertLogPatternAnalysisPageExists();

      await aiops.logPatternAnalysisPage.clickUseFullDataButton(totalDocCount);
      await aiops.logPatternAnalysisPage.setRandomSamplingOption('aiopsRandomSamplerOptionOff');
      await aiops.logPatternAnalysisPage.selectCategoryField(selectedField);
      await aiops.logPatternAnalysisPage.clickRunButton();

      await aiops.logPatternAnalysisPage.assertTotalCategoriesFound(3);
      await aiops.logPatternAnalysisPage.assertCategoryTableRows(3);

      await aiops.logPatternAnalysisPage.clickFilterInButton(0);

      await retrySwitchTab(1, 10);
      tabsCount++;

      await aiops.logPatternAnalysisPage.assertDiscoverDocCountExists();

      // ensure the discover doc count is greater than 0
      await aiops.logPatternAnalysisPage.assertDiscoverDocCountGreaterThan(0);
    });

    it(`loads the log pattern analysis page and filters out patterns in discover`, async () => {
      // Start navigation from the base of the ML app.
      await ml.navigation.navigateToMl();
      await elasticChart.setNewChartUiDebugFlag(true);
      await aiops.logPatternAnalysisPage.navigateToDataViewSelection();
      await ml.jobSourceSelection.selectSourceForLogPatternAnalysisDetection('logstash-*');
      await aiops.logPatternAnalysisPage.assertLogPatternAnalysisPageExists();

      await aiops.logPatternAnalysisPage.clickUseFullDataButton(totalDocCount);
      await aiops.logPatternAnalysisPage.setRandomSamplingOption('aiopsRandomSamplerOptionOff');
      await aiops.logPatternAnalysisPage.selectCategoryField(selectedField);
      await aiops.logPatternAnalysisPage.clickRunButton();
      await aiops.logPatternAnalysisPage.assertTotalCategoriesFound(3);
      await aiops.logPatternAnalysisPage.assertCategoryTableRows(3);

      await aiops.logPatternAnalysisPage.clickFilterOutButton(0);

      await retrySwitchTab(1, 10);
      tabsCount++;

      await aiops.logPatternAnalysisPage.assertDiscoverDocCountExists();

      // ensure the discover doc count is greater than 0
      await aiops.logPatternAnalysisPage.assertDiscoverDocCountGreaterThan(0);
    });

    it('attaches log pattern analysis table to a dashboard', async () => {
      // Start navigation from the base of the ML app.
      await ml.navigation.navigateToMl();
      await elasticChart.setNewChartUiDebugFlag(true);
      await aiops.logPatternAnalysisPage.navigateToDataViewSelection();
      await ml.jobSourceSelection.selectSourceForLogPatternAnalysisDetection('logstash-*');
      await aiops.logPatternAnalysisPage.assertLogPatternAnalysisPageExists();

      await aiops.logPatternAnalysisPage.clickUseFullDataButton(totalDocCount);
      await aiops.logPatternAnalysisPage.selectCategoryField(selectedField);
      await aiops.logPatternAnalysisPage.clickRunButton();

      await aiops.logPatternAnalysisPage.attachToDashboard();
    });

    it('attaches log pattern analysis table to a case', async () => {
      // Start navigation from the base of the ML app.
      await ml.navigation.navigateToMl();
      await elasticChart.setNewChartUiDebugFlag(true);
      await aiops.logPatternAnalysisPage.navigateToDataViewSelection();
      await ml.jobSourceSelection.selectSourceForLogPatternAnalysisDetection('logstash-*');
      await aiops.logPatternAnalysisPage.assertLogPatternAnalysisPageExists();

      await aiops.logPatternAnalysisPage.clickUseFullDataButton(totalDocCount);
      await aiops.logPatternAnalysisPage.selectCategoryField(selectedField);
      await aiops.logPatternAnalysisPage.clickRunButton();

      const caseParams = {
        title: 'ML Log pattern analysis case',
        description: 'Case with a log pattern analysis attachment',
        tag: 'ml_log_pattern_analysis',
        reporter: USER.ML_POWERUSER,
      };

      await aiops.logPatternAnalysisPage.attachToCase(caseParams);

      await ml.cases.assertCaseWithLogPatternAnalysisAttachment(caseParams);
    });
  });
}
