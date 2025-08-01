/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useCallback, useMemo } from 'react';
import { i18n } from '@kbn/i18n';
import { FormattedMessage } from '@kbn/i18n-react';
import type { EuiInMemoryTableProps } from '@elastic/eui';
import {
  EuiInMemoryTable,
  EuiBadge,
  EuiButton,
  EuiFlexGroup,
  EuiFlexItem,
  EuiText,
  EuiIcon,
  EuiToolTip,
  EuiLink,
  EuiIconTip,
} from '@elastic/eui';

import type { AgentPolicy, InMemoryPackagePolicy, PackagePolicy } from '../../../../../types';
import {
  EuiButtonWithTooltip,
  PackageIcon,
  PackagePolicyActionsMenu,
} from '../../../../../components';
import {
  useAuthz,
  useLink,
  useIsPackagePolicyUpgradable,
  usePermissionCheck,
  useMultipleAgentPolicies,
  useGetOutputs,
  useDefaultOutput,
} from '../../../../../hooks';
import { pkgKeyFromPackageInfo } from '../../../../../services';

import { AddIntegrationFlyout } from './add_integration_flyout';

interface Props {
  packagePolicies: PackagePolicy[];
  agentPolicy: AgentPolicy;
  // Pass through props to InMemoryTable
  loading?: EuiInMemoryTableProps<InMemoryPackagePolicy>['loading'];
  message?: EuiInMemoryTableProps<InMemoryPackagePolicy>['message'];
  refreshAgentPolicy: () => void;
}

interface FilterOption {
  name: string;
  value: string;
}

const stringSortAscending = (a: string, b: string): number => a.localeCompare(b);
const toFilterOption = (value: string): FilterOption => ({ name: value, value });

export const PackagePoliciesTable: React.FunctionComponent<Props> = ({
  packagePolicies: originalPackagePolicies,
  agentPolicy,
  refreshAgentPolicy,
  ...rest
}) => {
  const authz = useAuthz();
  const canWriteIntegrationPolicies = authz.integrations.writeIntegrationPolicies;
  const canReadAgentPolicies = authz.fleet.readAgentPolicies;
  const canReadIntegrationPolicies = authz.integrations.readIntegrationPolicies;
  const { isPackagePolicyUpgradable } = useIsPackagePolicyUpgradable();
  const { getHref } = useLink();
  const { canUseMultipleAgentPolicies } = useMultipleAgentPolicies();
  const [showAddIntegrationFlyout, setShowAddIntegrationFlyout] = React.useState(false);

  const permissionCheck = usePermissionCheck();
  const missingSecurityConfiguration =
    !permissionCheck.data?.success && permissionCheck.data?.error === 'MISSING_SECURITY';

  // With the package policies provided on input, generate the list of package policies
  // used in the InMemoryTable (flattens some values for search) as well as
  // the list of options that will be used in the filters dropdowns
  const [packagePolicies, namespaces] = useMemo((): [InMemoryPackagePolicy[], FilterOption[]] => {
    const namespacesValues: Set<string> = new Set();
    const mappedPackagePolicies = originalPackagePolicies.map<InMemoryPackagePolicy>(
      (packagePolicy) => {
        if (packagePolicy.namespace) {
          namespacesValues.add(packagePolicy.namespace);
        }
        const hasUpgrade = isPackagePolicyUpgradable(packagePolicy);

        return {
          ...packagePolicy,
          packageName: packagePolicy.package?.name ?? '',
          packageTitle: packagePolicy.package?.title ?? '',
          packageVersion: packagePolicy.package?.version ?? '',
          hasUpgrade,
        };
      }
    );

    const namespaceFilterOptions = [...namespacesValues]
      .sort(stringSortAscending)
      .map(toFilterOption);
    return [mappedPackagePolicies, namespaceFilterOptions];
  }, [originalPackagePolicies, isPackagePolicyUpgradable]);

  const getSharedPoliciesNumber = useCallback((packagePolicy: PackagePolicy) => {
    return packagePolicy.policy_ids.length || 0;
  }, []);

  const { data: outputsData, isLoading: isOutputsLoading } = useGetOutputs();
  const { output: defaultOutputData } = useDefaultOutput();
  const outputNamesById = useMemo(() => {
    const outputs = outputsData?.items ?? [];
    return outputs.reduce<Record<string, string>>((acc, output) => {
      acc[output.id] = output.name;
      return acc;
    }, {});
  }, [outputsData]);

  const columns = useMemo(
    (): EuiInMemoryTableProps<InMemoryPackagePolicy>['columns'] => [
      {
        field: 'name',
        sortable: true,
        truncateText: true,
        name: i18n.translate('xpack.fleet.policyDetails.packagePoliciesTable.nameColumnTitle', {
          defaultMessage: 'Integration policy',
        }),
        width: '35%',
        render: (value: string, packagePolicy: InMemoryPackagePolicy) => (
          <EuiFlexGroup gutterSize="s" alignItems="center">
            <EuiFlexItem data-test-subj="PackagePoliciesTableName" grow={false}>
              <EuiLink
                title={value}
                {...(canReadIntegrationPolicies
                  ? {
                      href: getHref('edit_integration', {
                        policyId: agentPolicy.id,
                        packagePolicyId: packagePolicy.id,
                      }),
                    }
                  : { disabled: true })}
              >
                <span className="eui-textTruncate">{value}</span>
                {packagePolicy.description ? (
                  <span>
                    &nbsp;
                    <EuiToolTip content={packagePolicy.description}>
                      <EuiIcon type="question" />
                    </EuiToolTip>
                  </span>
                ) : null}
              </EuiLink>
            </EuiFlexItem>
            {canUseMultipleAgentPolicies &&
              canReadAgentPolicies &&
              canReadIntegrationPolicies &&
              getSharedPoliciesNumber(packagePolicy) > 1 && (
                <EuiFlexItem grow={false}>
                  <EuiToolTip
                    content={
                      <FormattedMessage
                        id="xpack.fleet.agentPolicyList.agentsColumn.sharedTooltip"
                        defaultMessage="This integration is shared by {numberShared} agent policies"
                        values={{ numberShared: getSharedPoliciesNumber(packagePolicy) }}
                      />
                    }
                  >
                    <EuiText
                      data-test-subj="PackagePoliciesTableSharedLabel"
                      color="subdued"
                      size="xs"
                      className="eui-textNoWrap"
                    >
                      <FormattedMessage
                        id="xpack.fleet.agentPolicyList.agentsColumn.sharedText"
                        defaultMessage="Shared"
                      />{' '}
                      <EuiIcon type="info" />
                    </EuiText>
                  </EuiToolTip>
                </EuiFlexItem>
              )}
          </EuiFlexGroup>
        ),
      },
      {
        field: 'packageTitle',
        sortable: true,
        name: i18n.translate(
          'xpack.fleet.policyDetails.packagePoliciesTable.packageNameColumnTitle',
          {
            defaultMessage: 'Integration',
          }
        ),
        render(packageTitle: string, packagePolicy: InMemoryPackagePolicy) {
          return (
            <EuiFlexGroup gutterSize="s" alignItems="center">
              <EuiFlexItem data-test-subj="PackagePoliciesTableLink" grow={false}>
                <EuiLink
                  href={
                    packagePolicy.package &&
                    getHref('integration_details_overview', {
                      pkgkey: pkgKeyFromPackageInfo(packagePolicy.package),
                    })
                  }
                >
                  <EuiFlexGroup gutterSize="s" alignItems="center">
                    {packagePolicy.package && (
                      <EuiFlexItem grow={false}>
                        <PackageIcon
                          packageName={packagePolicy.package.name}
                          version={packagePolicy.package.version}
                          size="m"
                          tryApi={true}
                        />
                      </EuiFlexItem>
                    )}
                    <EuiFlexItem grow={false}>{packageTitle}</EuiFlexItem>
                    {packagePolicy.package && (
                      <EuiFlexItem grow={false}>
                        <EuiText color="subdued" size="xs" className="eui-textNoWrap">
                          <FormattedMessage
                            id="xpack.fleet.policyDetails.packagePoliciesTable.packageVersion"
                            defaultMessage="v{version}"
                            values={{ version: packagePolicy.package.version }}
                          />
                        </EuiText>
                      </EuiFlexItem>
                    )}
                  </EuiFlexGroup>
                </EuiLink>
              </EuiFlexItem>
              {packagePolicy.hasUpgrade && (
                <>
                  <EuiFlexItem grow={false}>
                    <EuiToolTip
                      content={i18n.translate(
                        'xpack.fleet.policyDetails.packagePoliciesTable.upgradeAvailable',
                        { defaultMessage: 'Upgrade Available' }
                      )}
                    >
                      <EuiIcon type="warning" color="warning" />
                    </EuiToolTip>
                  </EuiFlexItem>
                  <EuiFlexItem grow={false}>
                    <EuiButton
                      data-test-subj="PackagePoliciesTableUpgradeButton"
                      size="s"
                      minWidth="0"
                      isDisabled={!canWriteIntegrationPolicies}
                      href={`${getHref('upgrade_package_policy', {
                        policyId: agentPolicy.id,
                        packagePolicyId: packagePolicy.id,
                      })}?from=fleet-policy-list`}
                    >
                      <FormattedMessage
                        id="xpack.fleet.policyDetails.packagePoliciesTable.upgradeButton"
                        defaultMessage="Upgrade"
                      />
                    </EuiButton>
                  </EuiFlexItem>
                </>
              )}
            </EuiFlexGroup>
          );
        },
      },
      {
        field: 'namespace',
        name: i18n.translate(
          'xpack.fleet.policyDetails.packagePoliciesTable.namespaceColumnTitle',
          {
            defaultMessage: 'Namespace',
          }
        ),
        render: (namespace: InMemoryPackagePolicy['namespace']) => {
          return namespace ? (
            <EuiBadge color="hollow">{namespace}</EuiBadge>
          ) : (
            <>
              <EuiBadge color="default">{agentPolicy.namespace}</EuiBadge>
              <EuiIconTip
                content="Namespace defined in parent agent policy"
                position="right"
                type="info"
                color="subdued"
              />
            </>
          );
        },
      },
      {
        field: 'output_id',
        name: i18n.translate('xpack.fleet.policyDetails.packagePoliciesTable.outputColumnTitle', {
          defaultMessage: 'Output',
        }),
        render: (outputId: InMemoryPackagePolicy['output_id']) => {
          if (isOutputsLoading) {
            return null;
          }
          if (outputId) {
            return <EuiBadge color="hollow">{outputNamesById[outputId] || outputId}</EuiBadge>;
          }
          if (agentPolicy.data_output_id) {
            return (
              <>
                <EuiBadge color="default">
                  {outputNamesById[agentPolicy.data_output_id] || agentPolicy.data_output_id}
                </EuiBadge>
                &nbsp;
                <EuiIconTip
                  content={i18n.translate(
                    'xpack.fleet.policyDetails.packagePoliciesTable.outputFromParentPolicyText',
                    {
                      defaultMessage: 'Output defined in parent agent policy',
                    }
                  )}
                  position="right"
                  type="info"
                  color="subdued"
                />
              </>
            );
          }
          if (defaultOutputData) {
            return (
              <>
                <EuiBadge color="default">
                  {outputNamesById[defaultOutputData.id] || defaultOutputData.id}
                </EuiBadge>
                &nbsp;
                <EuiIconTip
                  content={i18n.translate(
                    'xpack.fleet.policyDetails.packagePoliciesTable.outputFromFleetSettingsText',
                    {
                      defaultMessage: 'Output defined in Fleet settings',
                    }
                  )}
                  position="right"
                  type="info"
                  color="subdued"
                />
              </>
            );
          }
        },
      },
      {
        name: i18n.translate('xpack.fleet.policyDetails.packagePoliciesTable.actionsColumnTitle', {
          defaultMessage: 'Actions',
        }),
        width: '70px',
        actions: [
          {
            render: (packagePolicy: InMemoryPackagePolicy) => {
              return canWriteIntegrationPolicies ? (
                <PackagePolicyActionsMenu
                  agentPolicies={[agentPolicy]}
                  from={'fleet-policy-list'}
                  packagePolicy={packagePolicy}
                  upgradePackagePolicyHref={`${getHref('upgrade_package_policy', {
                    policyId: agentPolicy.id,
                    packagePolicyId: packagePolicy.id,
                  })}?from=fleet-policy-list`}
                />
              ) : (
                <></>
              );
            },
          },
        ],
      },
    ],
    [
      canReadIntegrationPolicies,
      getHref,
      agentPolicy,
      canUseMultipleAgentPolicies,
      canReadAgentPolicies,
      getSharedPoliciesNumber,
      canWriteIntegrationPolicies,
      isOutputsLoading,
      defaultOutputData,
      outputNamesById,
    ]
  );

  return (
    <>
      <EuiInMemoryTable<InMemoryPackagePolicy>
        itemId="id"
        items={packagePolicies}
        columns={columns}
        sorting={{
          sort: {
            field: 'name',
            direction: 'asc',
          },
        }}
        {...rest}
        search={{
          toolsRight:
            agentPolicy.is_managed || agentPolicy.supports_agentless
              ? []
              : [
                  <EuiButtonWithTooltip
                    key="addPackagePolicyButton"
                    fill
                    isDisabled={!canWriteIntegrationPolicies}
                    iconType="plusInCircle"
                    onClick={() => {
                      setShowAddIntegrationFlyout(true);
                    }}
                    data-test-subj="addPackagePolicyButton"
                    tooltip={
                      !canWriteIntegrationPolicies
                        ? {
                            content: missingSecurityConfiguration ? (
                              <FormattedMessage
                                id="xpack.fleet.epm.addPackagePolicyButtonSecurityRequiredTooltip"
                                defaultMessage="To add Elastic Agent Integrations, you must have security enabled and have the All privilege for Fleet. Contact your administrator."
                              />
                            ) : (
                              <FormattedMessage
                                id="xpack.fleet.epm.addPackagePolicyButtonPrivilegesRequiredTooltip"
                                defaultMessage="Elastic Agent Integrations require the All privilege for Agent policies and All privilege for Integrations. Contact your administrator."
                              />
                            ),
                          }
                        : undefined
                    }
                  >
                    <FormattedMessage
                      id="xpack.fleet.policyDetails.addPackagePolicyButtonText"
                      defaultMessage="Add integration"
                    />
                  </EuiButtonWithTooltip>,
                ],
          box: {
            incremental: true,
            schema: true,
          },
          filters: [
            {
              type: 'field_value_selection',
              field: 'namespace',
              name: 'Namespace',
              options: namespaces,
              multiSelect: 'or',
              operator: 'exact',
            },
          ],
        }}
      />
      {showAddIntegrationFlyout && (
        <AddIntegrationFlyout
          onClose={() => {
            setShowAddIntegrationFlyout(false);
            refreshAgentPolicy();
          }}
          agentPolicy={agentPolicy}
        />
      )}
    </>
  );
};
