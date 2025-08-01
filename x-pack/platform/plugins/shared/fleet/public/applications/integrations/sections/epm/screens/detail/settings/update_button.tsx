/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { i18n } from '@kbn/i18n';
import { FormattedMessage } from '@kbn/i18n-react';
import {
  EuiFlexGroup,
  EuiFlexItem,
  EuiButton,
  EuiCheckbox,
  EuiCallOut,
  EuiConfirmModal,
  EuiSpacer,
  useGeneratedHtmlId,
} from '@elastic/eui';

import { toMountPoint } from '@kbn/react-kibana-mount';

import type { FleetStartServices } from '../../../../../../../plugin';
import type {
  PackageInfo,
  UpgradePackagePolicyDryRunResponse,
  PackagePolicy,
} from '../../../../../types';
import { InstallStatus } from '../../../../../types';
import {
  useInstallPackage,
  useGetPackageInstallStatus,
  useStartServices,
  useAuthz,
  useLink,
  useUpgradePackagePoliciesMutation,
  useBulkGetAgentPoliciesQuery,
} from '../../../../../hooks';

interface UpdateButtonProps extends Pick<PackageInfo, 'name' | 'title' | 'version'> {
  dryRunData?: UpgradePackagePolicyDryRunResponse | null;
  packagePolicyIds?: string[];
  agentPolicyIds: string[];
  isUpgradingPackagePolicies?: boolean;
  setIsUpgradingPackagePolicies?: React.Dispatch<React.SetStateAction<boolean>>;
  startServices: Pick<FleetStartServices, 'analytics' | 'i18n' | 'theme'>;
  isDisabled?: boolean;
}

/*

  Updating an integration to a new version entails a bit of logic. We allow the user to choose whether they'd like to
  simultaneously upgrade any package policies that include the current version of the integration. For example, if
  a user is running four agent policies that include the `nginx-0.2.4` package and they update to `nginx-0.7.0`, they
  can elect to also deploy the new integration version to any agent running one of those four agent policies.

  If the user does not elect to upgrade their running policies, we simply install the latest version of the package and
  navigate to the new version's settings page, e.g. `/detail/nginx-0.7.0/settings`.

  If the user _does_ elect to upgrade their running policies, we display a confirmation modal. In this modal, we'll report the
  number of agents and policies that will be affected by the upgrade, and if there are any conflicts. In the case of a conflict
  between versions, an upgrade for a given package policy will be skipped and the user will need to manually recreate their policy
  to resolve any breaking changes between versions. Once the user confirms, we first install the latest version of the integration,
  then we make a call to the "upgrade policies" API endpoint with a list of all package policy ID's that include the current version
  of the integration. This API endpoint will complete the upgrade process in bulk for each package policy provided. Upon completion,
  we navigate to the new version's settings page, as above.

*/

export const UpdateButton: React.FunctionComponent<UpdateButtonProps> = ({
  dryRunData,
  isUpgradingPackagePolicies = false,
  name,
  packagePolicyIds = [],
  agentPolicyIds = [],
  setIsUpgradingPackagePolicies = () => {},
  title,
  version,
  startServices,
  isDisabled = false,
}) => {
  const modalTitleId = useGeneratedHtmlId();

  const history = useHistory();
  const { getPath } = useLink();

  const { notifications } = useStartServices();
  const canUpgradePackages = useAuthz().integrations.upgradePackages;

  const installPackage = useInstallPackage();
  const getPackageInstallStatus = useGetPackageInstallStatus();
  const { status: installationStatus } = getPackageInstallStatus(name);
  const isInstalling = installationStatus === InstallStatus.installing;

  const [isUpdateModalVisible, setIsUpdateModalVisible] = useState<boolean>(false);
  const [upgradePackagePolicies, setUpgradePackagePolicies] = useState<boolean>(true);

  const { data: agentPolicyData } = useBulkGetAgentPoliciesQuery(agentPolicyIds, { full: true });

  const packagePolicyCount = useMemo(() => packagePolicyIds.length, [packagePolicyIds]);

  function isStringArray(arr: unknown | string[]): arr is string[] {
    return Array.isArray(arr) && arr.every((p) => typeof p === 'string');
  }

  const agentCount = useMemo(() => {
    if (!agentPolicyData?.items) return 0;

    return agentPolicyData.items.reduce((acc, item) => {
      const existingPolicies = item?.package_policies
        ? isStringArray(item.package_policies)
          ? (item.package_policies as string[]).filter((p) => packagePolicyIds.includes(p))
          : (item.package_policies as PackagePolicy[]).filter((p) =>
              packagePolicyIds.includes(p.id)
            )
        : [];
      return (acc += existingPolicies.length > 0 && item?.agents ? item?.agents : 0);
    }, 0);
  }, [agentPolicyData, packagePolicyIds]);

  const conflictCount = useMemo(
    () => dryRunData?.filter((item) => item.hasErrors).length,
    [dryRunData]
  );

  const handleUpgradePackagePoliciesChange = useCallback(() => {
    setUpgradePackagePolicies((prev) => !prev);
  }, []);

  const navigateToNewSettingsPage = useCallback(() => {
    // only navigate if still on old settings page (user has not navigated away)
    if (
      !history.location.pathname.match(
        getPath('integration_details_settings', {
          pkgkey: `${name}-.*`,
        })
      )
    ) {
      return;
    }
    const settingsPath = getPath('integration_details_settings', {
      pkgkey: `${name}-${version}`,
    });
    history.push(settingsPath);
  }, [history, getPath, name, version]);

  const handleClickUpdate = useCallback(async () => {
    await installPackage({ name, version, title, isUpgrade: true });
    navigateToNewSettingsPage();
  }, [installPackage, name, title, version, navigateToNewSettingsPage]);

  const upgradePackagePoliciesMutation = useUpgradePackagePoliciesMutation();

  const handleClickUpgradePolicies = useCallback(async () => {
    if (isUpgradingPackagePolicies) {
      return;
    }

    setIsUpdateModalVisible(false);
    setIsUpgradingPackagePolicies(true);

    const hasUpgraded = await installPackage({ name, version, title, isUpgrade: true });
    //  If install package failed do not upgrade package policies
    if (!hasUpgraded) {
      setIsUpgradingPackagePolicies(false);
      return;
    }

    // Only upgrade policies that don't have conflicts
    const packagePolicyIdsToUpdate = packagePolicyIds.filter(
      (id) => !dryRunData?.find((dryRunRecord) => dryRunRecord.diff?.[0].id === id)?.hasErrors
    );

    if (!packagePolicyIdsToUpdate.length) {
      setIsUpgradingPackagePolicies(false);
      navigateToNewSettingsPage();
    }

    try {
      await upgradePackagePoliciesMutation.mutateAsync({
        packagePolicyIds: packagePolicyIdsToUpdate,
      });
      notifications.toasts.addSuccess({
        title: toMountPoint(
          <FormattedMessage
            id="xpack.fleet.integrations.packageUpdateSuccessTitle"
            defaultMessage="Updated {title} and upgraded policies"
            values={{ title }}
          />,
          startServices
        ),
        text: toMountPoint(
          <FormattedMessage
            id="xpack.fleet.integrations.packageUpdateSuccessDescription"
            defaultMessage="Successfully updated {title} and upgraded policies"
            values={{ title }}
          />,
          startServices
        ),
      });

      navigateToNewSettingsPage();
    } catch (error) {
      notifications.toasts.addError(error, {
        title: i18n.translate(
          'xpack.fleet.integrations.settings.errorUpdatingPoliciesToast.title',
          {
            defaultMessage: 'Error updating policies',
          }
        ),
        toastMessage: i18n.translate(
          'xpack.fleet.integrations.settings.errorUpdatingPoliciesToast.message',
          {
            defaultMessage: 'Integrations policies, need to be manually updated. \n Error: {error}',
            values: {
              error: error.message,
            },
          }
        ),
      });
      setIsUpgradingPackagePolicies(false);
      navigateToNewSettingsPage();
    }
  }, [
    isUpgradingPackagePolicies,
    setIsUpgradingPackagePolicies,
    installPackage,
    name,
    version,
    title,
    upgradePackagePoliciesMutation,
    packagePolicyIds,
    dryRunData,
    notifications.toasts,
    startServices,
    navigateToNewSettingsPage,
  ]);

  const updateModal = (
    <EuiConfirmModal
      isLoading={isUpgradingPackagePolicies}
      maxWidth={568}
      onCancel={() => {
        setIsUpdateModalVisible(false);
      }}
      cancelButtonText={i18n.translate(
        'xpack.fleet.integrations.settings.confirmUpdateModal.cancel',
        { defaultMessage: 'Cancel' }
      )}
      onConfirm={handleClickUpgradePolicies}
      confirmButtonText={i18n.translate(
        'xpack.fleet.integrations.settings.confirmUpdateModal.confirm',
        { defaultMessage: 'Upgrade {packageName} and policies', values: { packageName: title } }
      )}
      title={i18n.translate('xpack.fleet.integrations.settings.confirmUpdateModal.updateTitle', {
        defaultMessage: 'Upgrade {packageName} and policies',
        values: { packageName: title },
      })}
      aria-labelledby={modalTitleId}
      titleProps={{ id: modalTitleId }}
    >
      <>
        {conflictCount && conflictCount > 0 ? (
          <>
            <EuiCallOut
              color="warning"
              iconType="warning"
              title={i18n.translate(
                'xpack.fleet.integrations.settings.confirmUpdateModal.conflictCallOut.title',
                { defaultMessage: 'Some integration policies have conflicts' }
              )}
            >
              <strong>
                <FormattedMessage
                  id="xpack.fleet.integrations.settings.confirmUpdateModal.conflictCallOut.integrationPolicyCount"
                  defaultMessage="{conflictCount, plural, one { # integration policy} other { # integration policies}}"
                  values={{ conflictCount }}
                />
              </strong>{' '}
              <FormattedMessage
                id="xpack.fleet.integrations.settings.confirmUpdateModal.conflictCallOut.body"
                defaultMessage="{conflictCount, plural, one { has} other { have}} conflicts and will not be upgraded automatically.
                  You can manually resolve these conflicts via agent policy settings in Fleet after performing this upgrade."
                values={{ conflictCount }}
              />
            </EuiCallOut>

            <EuiSpacer size="l" />
          </>
        ) : null}
        <FormattedMessage
          id="xpack.fleet.integrations.settings.confirmUpdateModal.body"
          defaultMessage="This action will deploy updates to all agents which use these policies.
          Fleet has detected that {packagePolicyCountText} {packagePolicyCount, plural, one { is} other { are}} ready to be upgraded
          and {packagePolicyCount, plural, one { is} other { are}} already in use by {agentCountText}."
          values={{
            packagePolicyCount,
            packagePolicyCountText: (
              <strong>
                <FormattedMessage
                  id="xpack.fleet.integrations.confirmUpdateModal.body.policyCount"
                  defaultMessage="{packagePolicyCount, plural, one {# integration policy} other {# integration policies}}"
                  values={{ packagePolicyCount }}
                />
              </strong>
            ),
            agentCountText: (
              <strong>
                <FormattedMessage
                  id="xpack.fleet.integrations.confirmUpdateModal.body.agentCount"
                  defaultMessage="{agentCount, plural, one {# agent} other {# agents}}"
                  values={{ agentCount }}
                />
              </strong>
            ),
          }}
        />
      </>
    </EuiConfirmModal>
  );

  return (
    <>
      <EuiFlexGroup alignItems="center">
        <EuiFlexItem grow={false}>
          <EuiButton
            isLoading={isInstalling || isUpgradingPackagePolicies}
            onClick={
              upgradePackagePolicies ? () => setIsUpdateModalVisible(true) : handleClickUpdate
            }
            data-test-subj="updatePackageBtn"
            isDisabled={isDisabled || !canUpgradePackages}
          >
            <FormattedMessage
              id="xpack.fleet.integrations.updatePackage.updatePackageButtonLabel"
              defaultMessage="Upgrade to latest version"
            />
          </EuiButton>
        </EuiFlexItem>
        {packagePolicyCount > 0 && (
          <EuiFlexItem grow={false}>
            <EuiCheckbox
              labelProps={{
                style: {
                  display: 'flex',
                },
              }}
              id="upgradePoliciesCheckbox"
              data-test-subj="epmDetails.upgradePoliciesCheckbox"
              disabled={!canUpgradePackages}
              checked={upgradePackagePolicies}
              onChange={handleUpgradePackagePoliciesChange}
              label={i18n.translate(
                'xpack.fleet.integrations.updatePackage.upgradePoliciesCheckboxLabel',
                {
                  defaultMessage: 'Upgrade integration policies',
                }
              )}
            />
          </EuiFlexItem>
        )}
      </EuiFlexGroup>

      {isUpdateModalVisible && updateModal}
    </>
  );
};
