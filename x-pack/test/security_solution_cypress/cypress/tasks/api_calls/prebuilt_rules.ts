/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { epmRouteService } from '@kbn/fleet-plugin/common';
import {
  PerformRuleInstallationResponseBody,
  PERFORM_RULE_INSTALLATION_URL,
  BOOTSTRAP_PREBUILT_RULES_URL,
} from '@kbn/security-solution-plugin/common/api/detection_engine';
import {
  ELASTIC_SECURITY_RULE_ID,
  PREBUILT_RULES_PACKAGE_NAME,
} from '@kbn/security-solution-plugin/common/detection_engine/constants';
import type { PrePackagedRulesStatusResponse } from '@kbn/security-solution-plugin/public/detection_engine/rule_management/logic/types';
import { getPrebuiltRuleWithExceptionsMock } from '@kbn/security-solution-plugin/server/lib/detection_engine/prebuilt_rules/mocks';
import { createRuleAssetSavedObject } from '../../helpers/rules';
import { IS_SERVERLESS } from '../../env_var_names_constants';
import { refreshSavedObjectIndices, rootRequest } from './common';

export const getPrebuiltRulesStatus = () => {
  return rootRequest<PrePackagedRulesStatusResponse>({
    method: 'GET',
    url: 'api/detection_engine/rules/prepackaged/_status',
  });
};

export const SAMPLE_PREBUILT_RULE = createRuleAssetSavedObject({
  ...getPrebuiltRuleWithExceptionsMock(),
  rule_id: ELASTIC_SECURITY_RULE_ID,
  tags: ['test-tag-1'],
  enabled: true,
});

/* Install all prebuilt rules available as security-rule saved objects
 * Use in combination with `preventPrebuiltRulesPackageInstallation` and
 * `createNewRuleAsset` to create mocked prebuilt rules and install only those
 * instead of all rules available in the `security_detection_engine` package
 */
export const installAllPrebuiltRulesRequest = () =>
  rootRequest<PerformRuleInstallationResponseBody>({
    method: 'POST',
    url: PERFORM_RULE_INSTALLATION_URL,
    body: {
      mode: 'ALL_RULES',
    },
    headers: {
      'elastic-api-version': '1',
    },
  });

/* Install specific prebuilt rules. Should be available as security-rule saved objects
/* as a prerequisite for this request to succeed.
 * Use in combination with `preventPrebuiltRulesPackageInstallation` and
 * `createNewRuleAsset` to create mocked prebuilt rules and install only those
 * instead of all rules available in the `security_detection_engine` package
 */
export const installSpecificPrebuiltRulesRequest = (rules: Array<typeof SAMPLE_PREBUILT_RULE>) =>
  rootRequest<PerformRuleInstallationResponseBody>({
    method: 'POST',
    url: PERFORM_RULE_INSTALLATION_URL,
    body: {
      mode: 'SPECIFIC_RULES',
      rules: rules.map((rule) => ({
        rule_id: rule['security-rule'].rule_id,
        version: rule['security-rule'].version,
      })),
    },
    headers: {
      'elastic-api-version': '1',
    },
  });

export const getAvailablePrebuiltRulesCount = () => {
  cy.log('Get prebuilt rules count');
  return getPrebuiltRulesStatus().then(({ body }) => {
    const prebuiltRulesCount = body.rules_installed + body.rules_not_installed;

    return prebuiltRulesCount;
  });
};

export const waitTillPrebuiltRulesReadyToInstall = () => {
  cy.waitUntil(
    () => {
      return getAvailablePrebuiltRulesCount().then((availablePrebuiltRulesCount) => {
        return availablePrebuiltRulesCount > 0;
      });
    },
    { interval: 2000, timeout: 60000 }
  );
};

/**
 * Install all prebuilt rules.
 *
 * This is a heavy request and should be used with caution. Most likely you
 * don't need all prebuilt rules to be installed, crating just a few prebuilt
 * rules should be enough for most cases.
 */
export const excessivelyInstallAllPrebuiltRules = () => {
  cy.log('Install prebuilt rules (heavy request)');
  waitTillPrebuiltRulesReadyToInstall();
  installAllPrebuiltRulesRequest();
};

export const createNewRuleAsset = ({
  index = '.kibana_security_solution',
  rule = SAMPLE_PREBUILT_RULE,
}: {
  index?: string;
  rule?: typeof SAMPLE_PREBUILT_RULE;
}) => {
  const url = `${Cypress.env('ELASTICSEARCH_URL')}/${index}/_doc/security-rule:${
    rule['security-rule'].rule_id
  }?refresh`;
  cy.log('URL', url);
  cy.waitUntil(
    () => {
      return cy
        .request({
          method: 'PUT',
          url,
          headers: {
            'Content-Type': 'application/json',
          },
          body: rule,
        })
        .then((response) => response.status === 200);
    },
    { interval: 500, timeout: 12000 }
  );
};

export const bulkCreateRuleAssets = ({
  index = '.kibana_security_solution',
  rules = [SAMPLE_PREBUILT_RULE],
}: {
  index?: string;
  rules?: Array<typeof SAMPLE_PREBUILT_RULE>;
}) => {
  cy.log(
    'Bulk Install prebuilt rules',
    rules?.map((rule) => rule['security-rule'].rule_id).join(', ')
  );

  const bulkIndexRequestBody = rules.reduce((body, rule) => {
    const document = JSON.stringify(rule);
    const documentId = `security-rule:${rule['security-rule'].rule_id}`;
    const documentIdWithVersion = `${documentId}_${rule['security-rule'].version}`;

    const indexHistoricalRuleAsset = `${JSON.stringify({
      index: {
        _index: index,
        _id: documentIdWithVersion,
      },
    })}\n${document}\n`;

    return body.concat(indexHistoricalRuleAsset);
  }, '');

  cy.task('putMapping', index);
  cy.task('bulkInsert', bulkIndexRequestBody);
};

export const getRuleAssets = (index: string | undefined = '.kibana_security_solution') => {
  const url = `${Cypress.env('ELASTICSEARCH_URL')}/${index}/_search?size=10000`;
  return rootRequest({
    method: 'GET',
    url,
    headers: {
      'Content-Type': 'application/json',
    },
    body: {
      query: {
        term: { type: { value: 'security-rule' } },
      },
    },
  });
};

/* Prevent the installation of the `security_detection_engine` package from Fleet
/* by intercepting the request and returning a mock empty object as response
/* Used primarily to prevent the unwanted installation of "real" prebuilt rules
/* during e2e tests, and allow for manual installation of mock rules instead. */
export const preventPrebuiltRulesPackageInstallation = () => {
  cy.log('Prevent prebuilt rules package installation');
  cy.intercept('POST', BOOTSTRAP_PREBUILT_RULES_URL, { packages: [] });
};

const installByUploadPrebuiltRulesPackage = (packagePath: string): void => {
  cy.fixture(packagePath, 'binary')
    .then(Cypress.Blob.binaryStringToBlob)
    .then((blob) => {
      rootRequest({
        method: 'POST',
        url: '/api/fleet/epm/packages',
        headers: {
          'Content-Type': 'application/zip',
          'elastic-api-version': '2023-10-31',
          'kbn-xsrf': 'xxxx',
        },
        body: blob,
        encoding: 'binary',
      });
    });

  if (!Cypress.env(IS_SERVERLESS)) {
    refreshSavedObjectIndices();
  }
};

/**
 * Installs an empty mock prebuilt rules package `security_detection_engine`.
 * It's convenient to test functionality when no prebuilt rules are installed nor rule assets are available.
 */
export const installMockEmptyPrebuiltRulesPackage = (): void => {
  installByUploadPrebuiltRulesPackage(
    'security_detection_engine_packages/mock-empty-security_detection_engine-99.0.0.zip'
  );
};

/**
 * Installs a prepared mock prebuilt rules package `security_detection_engine`.
 * Installing it up front prevents installing the real package when making API requests.
 */
export const installMockPrebuiltRulesPackage = (): void => {
  installByUploadPrebuiltRulesPackage(
    'security_detection_engine_packages/mock-security_detection_engine-99.0.0.zip'
  );
};

export const deleteMockPrebuiltRulesPackage = (): Cypress.Chainable<Cypress.Response<unknown>> => {
  return rootRequest({
    method: 'DELETE',
    url: `/api/fleet/epm/packages/security_detection_engine/99.0.0`,
    headers: {
      'elastic-api-version': '2023-10-31',
      'kbn-xsrf': 'xxxx',
    },
  });
};

/**
 * Install prebuilt rule assets. After installing these assets become available to be installed
 * as prebuilt rules. Prebuilt rule assets can be generated via `createRuleAssetSavedObject()` helper function.
 *
 * It's also important to take into account that the business logic tries to fetch prebuilt rules Fleet package
 * and you need to add `preventPrebuiltRulesPackageInstallation()` to `beforeEach` section (before visit commands)
 * to avoid actually pulling a real Fleet package and have only the mocked prebuilt rule assets for testing.
 */
export const installPrebuiltRuleAssets = (ruleAssets: Array<typeof SAMPLE_PREBUILT_RULE>): void => {
  cy.log('Create mocked available to install prebuilt rules', ruleAssets.length);
  preventPrebuiltRulesPackageInstallation();

  bulkCreateRuleAssets({ rules: ruleAssets });
};

/**
 * Prevent the installation of the `security_detection_engine` package from Fleet.
 * The create a `security-rule` asset for each rule provided in the `rules` array.
 *
 * * @param {Array} rules - Rule assets to be created and optionally installed
 *
 */
export const createAndInstallMockedPrebuiltRules = (
  ruleAssets: Array<typeof SAMPLE_PREBUILT_RULE>
) => {
  preventPrebuiltRulesPackageInstallation();
  // Install assets into ES as `security-rule` SOs
  installPrebuiltRuleAssets(ruleAssets);

  // Install rules into Kibana as `alerts` SOs
  return installSpecificPrebuiltRulesRequest(ruleAssets);
};

const MAX_DELETE_FLEET_PACKAGE_RETRIES = 2;
const DELETE_FLEET_PACKAGE_DELAY_MS = 5000;

const deleteFleetPackage = (
  packageName: string,
  retries = MAX_DELETE_FLEET_PACKAGE_RETRIES,
  delayMs = DELETE_FLEET_PACKAGE_DELAY_MS
): Cypress.Chainable<Cypress.Response<unknown>> => {
  const deleteWithRetries = (tried = 0): Cypress.Chainable<Cypress.Response<unknown>> => {
    if (tried > retries) {
      throw new Error(`Error deleting ${packageName} package`);
    }

    return rootRequest({
      method: 'DELETE',
      url: epmRouteService.getRemovePath(packageName),
      body: JSON.stringify({ force: true }),
      failOnStatusCode: false,
    }).then((response) => {
      if (response.status === 200) {
        cy.log(`Deleted ${packageName} package (was installed)`);
        return;
      } else if (
        response.status === 400 &&
        (response.body as { message?: string }).message === `${packageName} is not installed`
      ) {
        cy.log(`Deleted ${packageName} package (was not installed)`, response.body);
        return;
      } else {
        cy.log(`Error deleting ${packageName} package`, response.body);
        cy.wait(delayMs).then(() => deleteWithRetries(tried + 1));
      }

      if (!Cypress.env(IS_SERVERLESS)) {
        refreshSavedObjectIndices();
      }
    });
  };

  return deleteWithRetries();
};

export const deletePrebuiltRulesFleetPackage = (): Cypress.Chainable<Cypress.Response<unknown>> =>
  deleteFleetPackage(PREBUILT_RULES_PACKAGE_NAME);
